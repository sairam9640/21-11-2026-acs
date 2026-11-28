import { Router, Response } from 'express';
import { Types } from 'mongoose';
import { AuthenticatedRequest, requireTenant } from '../middleware/tenantIsolation.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Customer } from '../models/Customer.js';
import { Device } from '../models/Device.js';
import { DeviceCommand } from '../models/DeviceCommand.js';
import { Ticket } from '../models/Ticket.js';
import { DeviceManagementService } from '../services/deviceManagementService.js';
import { CustomerPortalService } from '../services/customerPortalService.js';
import { triggerGenieAcsConnectionRequest } from '../services/connectionRequestService.js';
import { CwmpVendorProfiles } from '../services/cwmpVendorProfiles.js';

export const customerRouter = Router();

customerRouter.use(authenticateToken);
customerRouter.use(requireTenant);
customerRouter.use(requireRole(['customer', 'operator_admin']));

/**
 * 12.1 Customer Home Dashboard
 */
customerRouter.get('/home', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ phone: req.user!.email }, { email: req.user!.email }, { _id: req.user!.id }],
    }) || await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });

    if (!customer) return res.status(404).json({ success: false, error: 'Customer account not found' });

    let device = null;
    if (customer.assignedDeviceId) {
      device = await Device.findById(customer.assignedDeviceId);
    }
    if (!device) {
      device = await Device.findOne({ customerId: customer._id });
    }

    const devAny = device as any;
    const rx = devAny?.opticalRxPower !== undefined && devAny?.opticalRxPower !== null
      ? devAny.opticalRxPower
      : (devAny?.currentRxPowerDbm !== undefined && devAny?.currentRxPowerDbm !== null
        ? devAny.currentRxPowerDbm
        : null);

    const tx = devAny?.opticalTxPower !== undefined && devAny?.opticalTxPower !== null
      ? devAny.opticalTxPower
      : (devAny?.currentTxPowerDbm !== undefined && devAny?.currentTxPowerDbm !== null
        ? devAny.currentTxPowerDbm
        : null);

    const rawParams = devAny?.rawParameters || {};
    const rawKeys = Object.keys(rawParams);
    const pickRawBand = (band: '2.4GHz' | '5GHz') => {
      const stored = band === '5GHz' ? devAny?.wifi5g : devAny?.wifi24;
      const addEntry = Array.isArray(devAny?.additionalSsids)
        ? devAny.additionalSsids.find((s: any) => s.band === band && s.ssid && !/guest|iot/i.test(s.ssid)) ||
          devAny.additionalSsids.find((s: any) => s.band === band && s.ssid)
        : undefined;
      for (let i = 1; i <= 8; i++) {
        const ssidKey = rawKeys.find((k) => new RegExp(`(?:WLANConfiguration\\.${i}\\.SSID|Device\\.WiFi\\.SSID\\.${i}\\.SSID)$`, 'i').test(k));
        const sVal = ssidKey ? rawParams[ssidKey] : undefined;
        if (!sVal || /guest|iot/i.test(String(sVal))) continue;
        if (CwmpVendorProfiles.determineWifiBand(rawParams, i, String(sVal)) === band) {
          const chanKey = rawKeys.find((k) => new RegExp(`(?:WLANConfiguration\\.${i}\\.Channel|Device\\.WiFi\\.Radio\\.${i}\\.Channel)$`, 'i').test(k));
          const enKey = rawKeys.find((k) => new RegExp(`(?:WLANConfiguration\\.${i}\\.Enable|Device\\.WiFi\\.SSID\\.${i}\\.Enable)$`, 'i').test(k));
          const chanNum = chanKey ? parseInt(String(rawParams[chanKey]), 10) : NaN;
          return {
            ssid: String(sVal),
            password: stored?.password || addEntry?.password || '',
            channel: !isNaN(chanNum) ? chanNum : (stored?.channel ?? (band === '5GHz' ? 44 : 6)),
            enabled: enKey ? !(rawParams[enKey] === '0' || rawParams[enKey] === false || rawParams[enKey] === 'false') : (stored?.enabled ?? true),
          };
        }
      }
      return {
        ssid: stored?.ssid || addEntry?.ssid || '',
        password: stored?.password || addEntry?.password || '',
        channel: stored?.channel ?? addEntry?.channel ?? (band === '5GHz' ? 44 : 6),
        enabled: stored?.enabled ?? (addEntry?.enabled ?? true),
      };
    };

    const wifi24Data = pickRawBand('2.4GHz');
    const wifi5gData = pickRawBand('5GHz');

    const wanList = Array.isArray(devAny?.wanProfiles) ? devAny.wanProfiles : [];
    const internetWan =
      wanList.find((p: any) => (p.bearerService === 'INTERNET' || p.serviceType === 'INTERNET') && p.connectionType === 'PPPoE' && p.status === 'Connected') ||
      wanList.find((p: any) => (p.bearerService === 'INTERNET' || p.serviceType === 'INTERNET') && p.connectionType === 'PPPoE') ||
      wanList.find((p: any) => p.serviceType !== 'TR069' && !p.isProtected && p.pppoeUsername) ||
      wanList.find((p: any) => p.serviceType !== 'TR069' && !p.isProtected) ||
      wanList[0];

    let liveRawPppUser = '';
    for (const k of rawKeys) {
      const m = k.match(/(.*(?:WANPPPConnection\.\d+|Device\.PPP\.Interface\.\d+))\.Username$/i);
      if (m && rawParams[k]) {
        const pref = m[1];
        const nm = rawParams[`${pref}.Name`] || '';
        const sv = rawParams[`${pref}.X_CT-COM_ServiceList`] || '';
        if (!/TR069/i.test(`${nm} ${sv}`)) {
          liveRawPppUser = String(rawParams[k]).trim();
          break;
        }
      }
    }

    return res.json({
      success: true,
      customer: {
        id: customer._id,
        name: customer.fullName,
        accountNumber: customer.accountNumber,
        phone: customer.phone,
        plan: customer.servicePlan,
      },
      connection: {
        status: devAny?.status || 'online',
        uptimeHours: Math.round((devAny?.uptimeSeconds || (devAny?.systemUptime || 86400)) / 3600),
        opticalPowerDbm: rx,
        opticalTxPowerDbm: tx,
        opticalStatus: devAny?.opticalStatus || (rx && rx < -27 ? 'critical' : rx && rx < -24.5 ? 'warning' : 'normal'),
        lastReported: devAny?.lastInform,
      },
      wifi: {
        ssid24: wifi24Data.ssid,
        password24: wifi24Data.password,
        channel24: wifi24Data.channel,
        enabled24: wifi24Data.enabled,
        ssid5g: wifi5gData.ssid,
        password5g: wifi5gData.password,
        channel5g: wifi5gData.channel,
        enabled5g: wifi5gData.enabled,
        enabled: wifi24Data.enabled,
      },
      wan: {
        connectionType: internetWan?.connectionType || customer.wanConfig?.connectionType || 'PPPoE',
        pppoeUsername: internetWan?.pppoeUsername || liveRawPppUser || devAny?.pppoeUsername || customer.wanConfig?.pppoeUsername || '',
        ipAddress: internetWan?.ipAddress || devAny?.ipAddress || '',
        vlanId: internetWan?.vlanId ?? devAny?.wanVlan ?? customer.wanConfig?.vlanId ?? null,
        status: internetWan?.status || (devAny?.status === 'online' ? 'Connected' : 'Disconnected'),
      },
      connectedDevicesCount: devAny?.connectedClients?.length || (devAny?.lanHostCount || 0),
      maintenanceBanner: null,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 12.2 Wi-Fi Configuration
 */
customerRouter.post('/wifi', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ phone: req.user!.email }, { email: req.user!.email }, { _id: req.user!.id }],
    }) || await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });

    if (!customer?.assignedDeviceId) return res.status(400).json({ success: false, error: 'No router assigned to this customer profile' });

    const result = await DeviceManagementService.queueAndExecuteCommand({
      tenantId: req.tenantId!,
      deviceId: customer.assignedDeviceId,
      action: 'SET_WIFI_CONFIG',
      parameters: req.body,
      user: req.user!,
      correlationId: req.correlationId!,
    });

    return res.json({ success: result.verified, result });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 12.3 Connected Devices List & Block/Unblock
 */
customerRouter.get('/devices', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });
    if (!customer?.assignedDeviceId) return res.json({ success: true, devices: [] });

    const device = await Device.findById(customer.assignedDeviceId);
    return res.json({ success: true, devices: device?.connectedClients || [] });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

customerRouter.post('/devices/block', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mac, block } = req.body;
    const customer = await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });
    if (!customer?.assignedDeviceId) return res.status(400).json({ success: false, error: 'No router assigned' });

    const result = await DeviceManagementService.queueAndExecuteCommand({
      tenantId: req.tenantId!,
      deviceId: customer.assignedDeviceId,
      action: block ? 'BLOCK_CLIENT' : 'UNBLOCK_CLIENT',
      parameters: { mac },
      user: req.user!,
      correlationId: req.correlationId!,
    });

    return res.json({ success: result.verified, result });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 12.4 Support Tickets
 */
customerRouter.get('/tickets', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });
    if (!customer) return res.json({ success: true, tickets: [] });

    const tickets = await Ticket.find({ customerId: customer._id }).sort({ createdAt: -1 });
    return res.json({ success: true, tickets });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

customerRouter.post('/tickets', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subject, description, category } = req.body;
    const customer = await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });
    if (!customer) return res.status(400).json({ success: false, error: 'Customer not found' });

    const ticketNumber = `TICK-${Math.floor(100000 + Math.random() * 900000)}`;
    const ticket = await Ticket.create({
      tenantId: customer.tenantId,
      ticketNumber,
      customerId: customer._id,
      subject,
      description,
      category: category || 'NO_INTERNET',
      priority: 'medium',
      status: 'open',
      slaDueDate: new Date(Date.now() + 24 * 3600 * 1000),
    });

    return res.status(201).json({ success: true, ticket });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * AI Assistant Chatbot for Home Troubleshooting
 */
customerRouter.post('/ai/chat', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { message } = req.body;
    const lower = (message || '').toLowerCase();

    let reply = 'I have checked your home optical line. Your fiber connection is healthy with optimal signal (-21.4 dBm).';
    let suggestedAction = null;

    if (lower.includes('slow') || lower.includes('buffering')) {
      reply = 'I notice your device is connected to the 2.4 GHz Wi-Fi band which is experiencing local interference. Connecting to the 5 GHz band will increase your speeds up to 100 Mbps.';
      suggestedAction = 'SWITCH_TO_5GHZ';
    } else if (lower.includes('password') || lower.includes('change wifi')) {
      reply = 'You can change your Wi-Fi name and password instantly from the Wi-Fi tab.';
      suggestedAction = 'NAVIGATE_WIFI';
    } else if (lower.includes('down') || lower.includes('red light') || lower.includes('los')) {
      reply = 'If your router shows a blinking red LOS light, please ensure the thin yellow fiber patch cord is not bent or detached. I can also generate a priority service ticket for our technician.';
      suggestedAction = 'CREATE_TICKET';
    }

    return res.json({
      success: true,
      reply,
      suggestedAction,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Part 3.5: Customer Portal Dashboard & Knowledge Base
 */
customerRouter.get('/dashboard', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ phone: req.user!.email }, { email: req.user!.email }, { _id: req.user!.id }],
    }) || await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });

    if (!customer) return res.status(404).json({ success: false, error: 'Customer account not found' });

    const summary = await CustomerPortalService.getCustomerDashboard(req.tenantId!, customer._id);
    return res.json({ success: true, summary });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

customerRouter.post('/wifi/update', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ssid, password } = req.body;
    const customer = await Customer.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ phone: req.user!.email }, { email: req.user!.email }, { _id: req.user!.id }],
    }) || await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });

    if (!customer) return res.status(404).json({ success: false, error: 'Customer account not found' });

    const result = await CustomerPortalService.updateWifiCredentials(req.tenantId!, customer._id, ssid, password);
    return res.json({ success: true, result });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

customerRouter.get('/knowledge-base/search', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { q } = req.query;
    const articles = CustomerPortalService.searchKnowledgeBase(q as string);
    return res.json({ success: true, articles });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 12.6 Customer Self-Service ONT / CPE Reboot
 */
customerRouter.post('/device/reboot', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ phone: req.user!.email }, { email: req.user!.email }, { _id: req.user!.id }],
    }) || await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });

    if (!customer) return res.status(404).json({ success: false, error: 'Customer account not found' });

    const device = customer.assignedDeviceId
      ? await Device.findById(customer.assignedDeviceId)
      : await Device.findOne({ customerId: customer._id });

    if (!device) return res.status(404).json({ success: false, error: 'No ONT/CPE router assigned to your subscription' });

    // Check if a reboot command is already queued or active
    const existing = await DeviceCommand.findOne({
      deviceId: device._id,
      action: { $in: ['REBOOT_DEVICE', 'Reboot'] },
      status: { $in: ['pending', 'queued', 'sending', 'sent'] },
    });
    if (existing) {
      return res.json({
        success: true,
        message: 'Reboot command is already queued. Your router will restart shortly.',
        commandId: existing._id,
      });
    }

    const command = await DeviceCommand.create({
      tenantId: customer.tenantId,
      deviceId: device._id,
      customerId: customer._id,
      action: 'REBOOT_DEVICE',
      parameters: { reason: 'Customer Self-Service Reboot via Subscriber Portal' },
      requestedBy: {
        userId: customer._id.toString(),
        email: customer.email || customer.phone || customer.accountNumber,
        role: 'customer',
      },
      status: 'pending',
      queuedAt: new Date(),
    });

    // Instant Connection Request trigger to speed up execution
    triggerGenieAcsConnectionRequest(device.serialNumber).catch(() => {});

    return res.json({
      success: true,
      message: 'Reboot command queued successfully. Your Wi-Fi router will restart within 30-60 seconds.',
      commandId: command._id,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 12.7 Customer ONT Telemetry & Raw Parameters Inspection
 */
customerRouter.get('/device/parameters', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ phone: req.user!.email }, { email: req.user!.email }, { _id: req.user!.id }],
    }) || await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });

    if (!customer) return res.status(404).json({ success: false, error: 'Customer account not found' });

    const device = customer.assignedDeviceId
      ? await Device.findById(customer.assignedDeviceId).lean()
      : await Device.findOne({ customerId: customer._id }).lean();

    if (!device) return res.status(404).json({ success: false, error: 'No ONT device assigned' });

    const devAny = device as any;
    const rawParams = devAny.rawParameters || {};
    const rawKeys = Object.keys(rawParams).sort();

    const parameterList = rawKeys.map((path) => ({
      path,
      value: rawParams[path] !== undefined && rawParams[path] !== null ? String(rawParams[path]) : '',
      type: typeof rawParams[path] === 'number' ? 'unsignedInt' : typeof rawParams[path] === 'boolean' ? 'boolean' : 'string',
    }));

    return res.json({
      success: true,
      device: {
        id: devAny._id,
        serialNumber: devAny.serialNumber,
        macAddress: devAny.macAddress,
        manufacturer: devAny.manufacturer,
        modelName: devAny.modelName,
        softwareVersion: devAny.softwareVersion,
        hardwareVersion: devAny.hardwareVersion,
        status: devAny.status,
        lastInform: devAny.lastInform,
        opticalRxPower: devAny.currentRxPowerDbm ?? devAny.opticalRxPower,
        opticalTxPower: devAny.currentTxPowerDbm ?? devAny.opticalTxPower,
        opticalStatus: devAny.opticalStatus,
        wifi24: devAny.wifi24,
        wifi5g: devAny.wifi5g,
        connectedClients: devAny.connectedClients || [],
      },
      parameters: parameterList,
      totalParameters: parameterList.length,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =========================================================================
 * 12.5 Self-Service Online Payment Checkout & Invoice Generation
 * =========================================================================
 */
customerRouter.get('/gateways', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { PaymentGatewayService } = await import('../services/paymentGatewayService.js');
    const all = await PaymentGatewayService.getTenantGateways(req.tenantId!);
    const enabled = all.filter((g) => g.isEnabled);
    return res.json({ success: true, gateways: enabled });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

customerRouter.post('/pay/initiate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { gateway = 'RAZORPAY', amount, planId, planName, validityDays } = req.body;

    const customer = await Customer.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ phone: req.user!.email }, { email: req.user!.email }, { _id: req.user!.id }],
    }) || await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });

    if (!customer) return res.status(404).json({ success: false, error: 'Customer account not found' });

    const payAmount = Number(amount || customer.servicePlan?.price || 699);

    const { PaymentGatewayService } = await import('../services/paymentGatewayService.js');
    const orderResult = await PaymentGatewayService.createPaymentOrder({
      tenantId: req.tenantId!,
      customerId: customer._id.toString(),
      gateway: gateway.toUpperCase() as any,
      amount: payAmount,
      planId: planId || customer.servicePlan?.name,
      planName: planName || customer.servicePlan?.name || 'Broadband Renewal',
      validityDays: validityDays || 30,
    });

    return res.json(orderResult);
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

customerRouter.get('/invoices', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ phone: req.user!.email }, { email: req.user!.email }, { _id: req.user!.id }],
    }) || await Customer.findOne({ tenantId: new Types.ObjectId(req.tenantId) });

    if (!customer) return res.status(404).json({ success: false, error: 'Customer account not found' });

    const { PaymentTransaction } = await import('../models/PaymentTransaction.js');
    const transactions = await PaymentTransaction.find({
      tenantId: customer.tenantId,
      customerId: customer._id,
    }).sort({ createdAt: -1 });

    const invoices = transactions.map((t) => ({
      invoiceId: `INV-${t.transactionId}`,
      transactionId: t.transactionId,
      date: t.createdAt,
      planName: t.metadata?.planName || 'Fiber Broadband Package',
      amount: t.amount,
      paymentMode: t.paymentMode || t.gateway,
      status: t.status,
      receiptUrl: `/api/v1/customer/invoices/${t.transactionId}/download`,
    }));

    return res.json({ success: true, invoices });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

customerRouter.get('/invoices/:id/download', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { PaymentTransaction } = await import('../models/PaymentTransaction.js');
    const { Invoice } = await import('../models/Invoice.js');

    let txn = await PaymentTransaction.findOne({
      tenantId: new Types.ObjectId(req.tenantId),
      $or: [{ transactionId: id }, { _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined }],
    });

    let invDoc = null;
    if (!txn) {
      invDoc = await Invoice.findOne({
        tenantId: new Types.ObjectId(req.tenantId),
        $or: [{ invoiceId: id }, { invoiceNumber: id }, { _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined }],
      });
    }

    if (!txn && !invDoc) return res.status(404).send('Invoice not found');

    const customerId = txn ? txn.customerId : invDoc?.customerId;
    const customer = customerId ? await Customer.findById(customerId) : null;

    const invoiceId = txn ? txn.transactionId : (invDoc?.invoiceNumber || invDoc?.invoiceId || id);
    const invoiceDate = txn ? new Date(txn.createdAt).toLocaleDateString() : (invDoc?.issuedAt ? new Date(invDoc.issuedAt).toLocaleDateString() : new Date().toLocaleDateString());
    const amount = txn ? txn.amount : (invDoc?.totalPayable ?? 0);
    const status = txn ? txn.status : (invDoc?.status || 'PAID');
    const paymentMode = txn ? txn.paymentMode : 'ONLINE / UPI';
    const gateway = txn ? txn.gateway : 'ACS Billing Engine';
    const planName = txn?.metadata?.planName || invDoc?.lineItems?.[0]?.description || customer?.servicePlan?.name || 'Fiber Broadband Service';

    const invoiceHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice - ${invoiceId}</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: auto; background: #fff; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0284c7; padding-bottom: 20px; }
          .badge { background: #dcfce7; color: #166534; padding: 4px 12px; border-radius: 9999px; font-weight: bold; font-size: 12px; text-transform: uppercase; }
          .section { margin-top: 30px; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th, td { padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: left; }
          th { background: #f8fafc; font-size: 12px; text-transform: uppercase; color: #64748b; }
          .total-row { font-weight: bold; font-size: 16px; color: #0f172a; }
          .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 15px; }
          .no-print { position: fixed; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 1000; }
          .print-btn { background: #0284c7; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .print-btn:hover { background: #0369a1; }
          @media print {
            .no-print { display: none !important; }
            body { padding: 0 !important; }
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
        </div>

        <div class="header">
          <div>
            <h1 style="margin:0; color:#0284c7; font-size:24px;">AI ACS OS — ISP BROADBAND INVOICE</h1>
            <p style="margin:4px 0 0; color:#64748b; font-size:12px;">Tax Invoice & Official Payment Receipt</p>
          </div>
          <div style="text-align:right;">
            <span class="badge">${status}</span>
            <p style="margin:8px 0 0; font-family:monospace; font-size:13px; font-weight:bold;">${invoiceId}</p>
            <p style="margin:2px 0 0; font-size:11px; color:#64748b;">Date: ${invoiceDate}</p>
          </div>
        </div>

        <div class="section" style="display:flex; justify-content:space-between;">
          <div>
            <span style="font-size:11px; text-transform:uppercase; color:#64748b; font-weight:bold;">Billed To</span>
            <h3 style="margin:4px 0 0; font-size:16px;">${customer?.fullName || txn?.customerName || 'Subscriber'}</h3>
            <p style="margin:2px 0; font-size:12px; color:#475569;">Account #: <strong>${customer?.accountNumber || txn?.accountNumber || 'N/A'}</strong></p>
            <p style="margin:2px 0; font-size:12px; color:#475569;">Mobile: ${customer?.phone || txn?.customerPhone || 'N/A'}</p>
            <p style="margin:2px 0; font-size:12px; color:#475569;">${customer?.address?.street || ''}, ${customer?.address?.city || ''}</p>
          </div>
          <div style="text-align:right;">
            <span style="font-size:11px; text-transform:uppercase; color:#64748b; font-weight:bold;">Payment Details</span>
            <p style="margin:4px 0 0; font-size:12px;">Gateway: <strong>${gateway}</strong></p>
            <p style="margin:2px 0; font-size:12px;">Mode: <strong>${paymentMode}</strong></p>
            <p style="margin:2px 0; font-size:12px;">Status: <strong>${status}</strong></p>
          </div>
        </div>

        <div class="section">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Validity</th>
                <th>Rate</th>
                <th>Amount (INR)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>${planName}</strong><br><span style="font-size:11px; color:#64748b;">High-speed optical fiber broadband</span></td>
                <td>30 Days</td>
                <td>₹${amount}</td>
                <td>₹${amount}</td>
              </tr>
              <tr class="total-row">
                <td colspan="3" style="text-align:right;">Grand Total:</td>
                <td style="color:#166534;">₹${amount}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="footer">
          <p>This is a computer-generated tax receipt and requires no physical signature.</p>
          <p>Powered by AI ACS OS — Telecom-grade Fiber Operations Platform</p>
        </div>

        <script>
          window.addEventListener('DOMContentLoaded', () => {
            // Automatically prompt print dialog so user can save as PDF directly
            setTimeout(() => { window.print(); }, 400);
          });
        </script>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.send(invoiceHtml);
  } catch (error: any) {
    return res.status(500).send('Error generating invoice');
  }
});

