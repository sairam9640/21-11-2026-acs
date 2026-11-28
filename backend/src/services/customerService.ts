import { Types } from 'mongoose';
import { Customer, ICustomer, ICustomerDocument } from '../models/Customer.js';
import { Device, IDevice } from '../models/Device.js';
import { DeviceCommand } from '../models/DeviceCommand.js';
import { Ticket } from '../models/Ticket.js';
import { TechnicianJob } from '../models/TechnicianJob.js';
import { AuditLog } from '../models/AuditLog.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { WarehouseStockItem } from '../models/WarehouseStockItem.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { FiberGisService } from './fiberGisService.js';
import { DeviceManagementService } from './deviceManagementService.js';
import { CwmpVendorProfiles } from './cwmpVendorProfiles.js';

export interface ICustomerAssignedAssets {
  ont: {
    deviceId?: string;
    serialNumber?: string;
    brand?: string;
    model?: string;
    macAddress?: string;
    hardwareVersion?: string;
    softwareVersion?: string;
    status?: string;
    warrantyExpiry?: Date;
  } | null;
  secondaryRouter: {
    itemCode?: string;
    serialNumber?: string;
    brand?: string;
    model?: string;
    warrantyExpiry?: Date;
  } | null;
  sfpModule: {
    itemCode?: string;
    serialNumber?: string;
    brand?: string;
    model?: string;
  } | null;
  fiberTermination: {
    fatBoxName?: string;
    fatPortNumber?: number;
    dropCableLengthMeters?: number;
    splitterName?: string;
    ponPortName?: string;
    oltName?: string;
  };
  warehouseItems: any[];
}

export interface ICustomerTimelineEvent {
  id: string;
  timestamp: Date;
  type: 'BILLING' | 'WHATSAPP' | 'TICKET' | 'FIELD_JOB' | 'TR069_COMMAND' | 'SECURITY_AUDIT';
  title: string;
  subtitle: string;
  status?: string;
  severity?: 'info' | 'success' | 'warning' | 'danger';
  actor?: string;
  metadata?: any;
}

export interface ICustomerOperationalReports {
  lifetimeValue: number;
  totalPaymentsCount: number;
  averageMonthlyRevenue: number;
  totalTicketsCount: number;
  openTicketsCount: number;
  slaBreachCount: number;
  averageResolutionHours: number;
  technicianVisitsCount: number;
}

export interface ICustomer360View {
  customer: ICustomer;
  device: IDevice | null;
  capabilities: any;
  fiberRoute: any;
  assignedAssets: ICustomerAssignedAssets;
  documents: any[];
  timeline: ICustomerTimelineEvent[];
  openTickets: any[];
  pastJobs: any[];
  commandHistory: any[];
  auditHistory: any[];
  messageHistory: any[];
  billingHistory: any[];
  operationalReports: ICustomerOperationalReports;
  aiDiagnosticBrief: {
    healthScore: number;
    connectionState: string;
    opticalHealth: string;
    wifiHealth: string;
    insights: string[];
    suggestedActions: string[];
  };
}

export class CustomerService {
  /**
   * Aggregates the complete Customer Operations Workspace experience
   */
  static async getCustomer360(customerId: string): Promise<ICustomer360View> {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new Error(`Customer not found with ID ${customerId}`);
    }

    const deviceDoc = customer.assignedDeviceId
      ? await Device.findById(customer.assignedDeviceId)
      : await Device.findOne({ customerId: customer._id });

    const capabilities = deviceDoc ? await DeviceManagementService.getDeviceCapabilities(deviceDoc) : null;
    const device: any = deviceDoc ? deviceDoc.toObject() : null;

    if (device) {
      const rawParams = device.rawParameters || {};
      const rawKeys = Object.keys(rawParams);

      // Resolve 2.4G Wi-Fi password if missing or masked
      if (!device.wifi24?.password || !device.wifi24.password.trim() || /^\*+$/.test(device.wifi24.password.trim())) {
        const key24 = rawKeys.find((k) => /WLANConfiguration\.1\..*(KeyPassphrase|PreSharedKey)|AccessPoint\.1\.Security\..*(KeyPassphrase|PreSharedKey)/i.test(k));
        const rawPass24 = key24 && rawParams[key24] && !/^\*+$/.test(String(rawParams[key24]).trim()) ? String(rawParams[key24]).trim() : null;
        const pass24 = rawPass24 || device.pendingConfig?.wifi24?.password || null;
        if (pass24) {
          if (!device.wifi24) device.wifi24 = { ssid: 'Home-WiFi-2.4G', enabled: true, channel: 6, bandwidthMhz: 20, securityMode: 'WPA2-PSK', txPowerPercent: 100 };
          device.wifi24.password = pass24;
          device.wifi24.passwordConfigured = true;
        }
      } else {
        if (!device.wifi24) device.wifi24 = {} as any;
        device.wifi24.passwordConfigured = true;
      }

      // Determine if device actually has a 5GHz Wi-Fi radio / hardware
      const has5gRadio = Boolean(
        (device.wifi5g?.ssid && device.wifi5g.ssid.trim()) ||
        (device.wifi5g?.channel && device.wifi5g.channel >= 36) ||
        (Array.isArray(device.additionalSsids) && device.additionalSsids.some((a: any) => a.band === '5GHz' && a.ssid)) ||
        (rawKeys.some((k) => /WLANConfiguration\.(2|5)\.SSID|Device\.WiFi\.Radio\.2\./i.test(k)))
      );

      device.isDualBand = has5gRadio;

      if (has5gRadio) {
        // Resolve 5G Wi-Fi password if missing or masked
        if (!device.wifi5g?.password || !device.wifi5g.password.trim() || /^\*+$/.test(device.wifi5g.password.trim())) {
          const key5g = rawKeys.find((k) => /WLANConfiguration\.(2|3|4|5|6)\..*(KeyPassphrase|PreSharedKey)|AccessPoint\.2\.Security\..*(KeyPassphrase|PreSharedKey)/i.test(k));
          const rawPass5g = key5g && rawParams[key5g] && !/^\*+$/.test(String(rawParams[key5g]).trim()) ? String(rawParams[key5g]).trim() : null;
          const pass5g = rawPass5g || device.pendingConfig?.wifi5g?.password || null;
          if (pass5g) {
            if (!device.wifi5g) device.wifi5g = { ssid: 'Home-WiFi-5G', enabled: true, channel: 44, bandwidthMhz: 80, securityMode: 'WPA2-PSK', txPowerPercent: 100 };
            device.wifi5g.password = pass5g;
            device.wifi5g.passwordConfigured = true;
          }
        } else {
          if (!device.wifi5g) device.wifi5g = {} as any;
          device.wifi5g.passwordConfigured = true;
        }
      } else {
        // Single-band 2.4GHz router: remove wifi5g so UI strictly hides 5GHz box
        delete device.wifi5g;
      }

      // Extract Authoritative Internet WAN / PPPoE Configuration
      if (!device.wanProfiles || device.wanProfiles.length === 0) {
        const pppoeUserKey = rawKeys.find((k) => /(?:WANPPPConnection\.\d+|Device\.PPP\.Interface\.\d+)\.Username$/i.test(k));
        const pppoeIpKey = rawKeys.find((k) => /(?:WAN(?:PPP|IP)Connection\.\d+\.ExternalIPAddress|Device\.(?:PPP|IP)\.Interface\.\d+\..*IPAddress)$/i.test(k));
        const vlanKey = rawKeys.find((k) => /(?:VLANID|VLAN|X_CT-COM_VlanId|X_HW_VLANID|X_ZTE-COM_VLANID)$/i.test(k) && !/TR069|VOIP/i.test(k));
        const dnsKey = rawKeys.find((k) => /(?:WAN(?:PPP|IP)Connection\.\d+\.DNSServers|Device\.DNS\.Client\.Server\.\d+\.DNSServer)$/i.test(k));

        const extractedUser = (pppoeUserKey && rawParams[pppoeUserKey]) || customer.wanConfig?.pppoeUsername || (device as any).pppoeUsername || `${customer.accountNumber.toLowerCase()}@isp`;
        const extractedIp = (pppoeIpKey && rawParams[pppoeIpKey] && rawParams[pppoeIpKey] !== '0.0.0.0') ? rawParams[pppoeIpKey] : (device.externalIpAddress || device.ipAddress || null);
        const extractedVlan = vlanKey && rawParams[vlanKey] ? parseInt(String(rawParams[vlanKey]), 10) : (customer.wanConfig?.vlanId || (device as any).wanVlan || 100);
        const dnsList = dnsKey && rawParams[dnsKey] ? String(rawParams[dnsKey]).split(',') : [];

        device.wanProfiles = [
          {
            name: 'INTERNET_PPPoE',
            bearerService: 'INTERNET',
            serviceType: 'INTERNET',
            connectionType: 'PPPoE',
            pppoeUsername: extractedUser,
            ipAddress: extractedIp || '100.64.12.84',
            vlanId: !isNaN(extractedVlan) ? extractedVlan : 100,
            status: device.status === 'online' ? 'Connected' : 'Disconnected',
            primaryDns: dnsList[0]?.trim() || customer.wanConfig?.dnsPrimary || '8.8.8.8',
            secondaryDns: dnsList[1]?.trim() || customer.wanConfig?.dnsSecondary || '8.8.4.4',
          } as any,
        ];
      }

      // Extract Live Connected Devices from TR-069 Host & Associated Device Tables
      if (!Array.isArray(device.connectedClients) || device.connectedClients.length === 0) {
        const clientMap = new Map<string, any>();

        // A. Scan LANDevice.1.Hosts.Host.* (DHCP Leases & Active LAN/WiFi hosts)
        const hostIndices = Array.from(new Set(
          rawKeys.map(k => {
            const m = k.match(/(?:LANDevice\.\d+\.Hosts\.Host|Device\.Hosts\.Host)\.(\d+)\./i);
            return m ? parseInt(m[1], 10) : null;
          }).filter((v): v is number => v !== null)
        )).sort((a, b) => a - b);

        for (const idx of hostIndices) {
          const macKey = rawKeys.find(k => new RegExp(`Hosts\\.Host\\.${idx}\\.(MACAddress|PhysAddress)$`, 'i').test(k));
          const ipKey = rawKeys.find(k => new RegExp(`Hosts\\.Host\\.${idx}\\.(IPAddress|IPv4Address\\.1\\.IPAddress)$`, 'i').test(k));
          const nameKey = rawKeys.find(k => new RegExp(`Hosts\\.Host\\.${idx}\\.(HostName|UserHostName|DeviceName)$`, 'i').test(k));
          const ifaceKey = rawKeys.find(k => new RegExp(`Hosts\\.Host\\.${idx}\\.(InterfaceType|Layer1Interface)$`, 'i').test(k));
          const activeKey = rawKeys.find(k => new RegExp(`Hosts\\.Host\\.${idx}\\.Active$`, 'i').test(k));

          const rawMac = macKey ? rawParams[macKey] : null;
          const rawIp = ipKey ? rawParams[ipKey] : null;
          const rawName = nameKey ? rawParams[nameKey] : null;
          const rawIface = ifaceKey ? rawParams[ifaceKey] : null;
          const isActive = activeKey ? (rawParams[activeKey] === '1' || String(rawParams[activeKey]).toLowerCase() === 'true') : true;

          if (rawMac && rawMac !== '00:00:00:00:00:00') {
            const macClean = String(rawMac).toUpperCase().trim();
            const friendly = CwmpVendorProfiles.resolveFriendlyDeviceName(rawName, macClean, rawIface);
            const isWireless = CwmpVendorProfiles.isWirelessClient(macClean, friendly, rawIface);
            let finalIface: '2.4GHz' | '5GHz' | 'Ethernet' = '2.4GHz';
            if (rawIface === '5GHz' || /5g/i.test(String(rawIface))) {
              finalIface = '5GHz';
            } else if (isWireless) {
              finalIface = '2.4GHz';
            } else {
              finalIface = 'Ethernet';
            }

            clientMap.set(macClean, {
              mac: macClean,
              ip: rawIp || '192.168.1.x',
              hostname: friendly,
              interfaceType: finalIface,
              connected: isActive,
              isBlocked: false,
              lastSeen: new Date(),
            });
          }
        }

        // B. Scan WLANConfiguration.*.AssociatedDevice.* (Active WiFi Associations)
        const assocKeys = rawKeys.filter(k => /(?:WLANConfiguration\.\d+\.AssociatedDevice|AccessPoint\.\d+\.AssociatedDevice)\.\d+\./i.test(k));
        const assocIndices = Array.from(new Set(
          assocKeys.map(k => {
            const m = k.match(/(?:WLANConfiguration\.(\d+)\.AssociatedDevice|AccessPoint\.(\d+)\.AssociatedDevice)\.(\d+)\./i);
            return m ? `${m[1] || m[2]}_${m[3]}` : null;
          }).filter((v): v is string => v !== null)
        ));

        for (const key of assocIndices) {
          const [bandNum, devNum] = key.split('_');
          const macKey = assocKeys.find(k => new RegExp(`(?:WLANConfiguration\\.${bandNum}\\.AssociatedDevice|AccessPoint\\.${bandNum}\\.AssociatedDevice)\\.${devNum}\\.(?:AssociatedDeviceMACAddress|MACAddress)$`, 'i').test(k));
          const ipKey = assocKeys.find(k => new RegExp(`(?:WLANConfiguration\\.${bandNum}\\.AssociatedDevice|AccessPoint\\.${bandNum}\\.AssociatedDevice)\\.${devNum}\\.(?:AssociatedDeviceIPAddress|IPAddress)$`, 'i').test(k));
          const nameKey = assocKeys.find(k => new RegExp(`(?:WLANConfiguration\\.${bandNum}\\.AssociatedDevice|AccessPoint\\.${bandNum}\\.AssociatedDevice)\\.${devNum}\\.(?:AssociatedDeviceHostName|HostName)$`, 'i').test(k));
          const stateKey = assocKeys.find(k => new RegExp(`(?:WLANConfiguration\\.${bandNum}\\.AssociatedDevice|AccessPoint\\.${bandNum}\\.AssociatedDevice)\\.${devNum}\\.AssociatedDeviceAuthenticationState$`, 'i').test(k));

          const rawMac = macKey ? rawParams[macKey] : null;
          if (rawMac && rawMac !== '00:00:00:00:00:00') {
            const macClean = String(rawMac).toUpperCase().trim();
            const rawIp = ipKey ? rawParams[ipKey] : null;
            const rawName = nameKey ? rawParams[nameKey] : null;
            const is5g = Number(bandNum) >= 2;
            const iface = is5g ? '5GHz' : '2.4GHz';
            const friendly = CwmpVendorProfiles.resolveFriendlyDeviceName(rawName, macClean, iface);
            const isAuth = stateKey ? (rawParams[stateKey] === '1' || /true|authenticated/i.test(String(rawParams[stateKey]))) : true;

            if (clientMap.has(macClean)) {
              const existing = clientMap.get(macClean);
              if (rawIp && !existing.ip) existing.ip = rawIp;
              if (friendly && (!existing.hostname || existing.hostname.startsWith('Device'))) existing.hostname = friendly;
              existing.interfaceType = iface;
            } else {
              clientMap.set(macClean, {
                mac: macClean,
                ip: rawIp || '192.168.1.x',
                hostname: friendly,
                interfaceType: iface,
                connected: isAuth,
                isBlocked: false,
                lastSeen: new Date(),
              });
            }
          }
        }

        device.connectedClients = Array.from(clientMap.values());
      }
    }

    const phoneClean = customer.phone ? customer.phone.replace(/[^0-9]/g, '') : '';
    const phoneFilter = phoneClean.length >= 10 ? new RegExp(phoneClean.slice(-10), 'i') : customer.phone;

    // Concurrently fetch all related datasets
    const [
      fiberRoute,
      openTickets,
      pastJobs,
      commands,
      auditLogs,
      messageLogs,
      warehouseItems,
      transactions,
    ] = await Promise.all([
      FiberGisService.traceCustomerRoute(customer._id.toString()).catch(() => null),
      Ticket.find({ customerId: customer._id })
        .populate('assignedToUserId', 'fullName email phone')
        .sort({ createdAt: -1 })
        .limit(25),
      TechnicianJob.find({ customerId: customer._id }).sort({ createdAt: -1 }).limit(15),
      DeviceCommand.find({ customerId: customer._id }).sort({ queuedAt: -1 }).limit(25),
      AuditLog.find({
        $or: [
          { targetId: customer._id.toString() },
          ...(device ? [{ targetId: device._id.toString() }] : []),
        ],
      })
        .sort({ timestamp: -1 })
        .limit(30),
      NotificationLog.find({
        tenantId: customer.tenantId,
        $or: [
          ...(phoneFilter ? [{ 'recipient.identifier': phoneFilter }] : []),
          ...(customer.email ? [{ 'recipient.identifier': new RegExp(customer.email, 'i') }] : []),
          { correlationId: new RegExp(customer._id.toString(), 'i') },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(35),
      WarehouseStockItem.find({
        tenantId: customer.tenantId,
        $or: [
          { 'assignedTo.targetIdentifier': customer.accountNumber },
          { 'assignedTo.targetId': customer._id },
        ],
      }).sort({ updatedAt: -1 }),
      PaymentTransaction.find({
        tenantId: customer.tenantId,
        $or: [{ customerId: customer._id }, { accountNumber: customer.accountNumber }],
      }).sort({ createdAt: -1 }),
    ]);

    // 1. Documents Aggregator with backward compatibility
    const documents: ICustomerDocument[] = [...(customer.documents || [])];
    if (documents.length === 0 && customer.kyc) {
      if (customer.kyc.idProofFrontUrl) {
        documents.push({
          documentId: `DOC-KYC-ID-${customer.accountNumber}`,
          name: `${customer.kyc.documentType.toUpperCase()} Front Document`,
          category: 'AADHAAR_FRONT',
          url: customer.kyc.idProofFrontUrl,
          uploadedAt: customer.kyc.verifiedAt || customer.createdAt,
          isVerified: customer.kyc.status === 'verified',
        });
      }
      if (customer.kyc.idProofBackUrl) {
        documents.push({
          documentId: `DOC-KYC-BACK-${customer.accountNumber}`,
          name: `${customer.kyc.documentType.toUpperCase()} Back Document`,
          category: 'AADHAAR_BACK',
          url: customer.kyc.idProofBackUrl,
          uploadedAt: customer.kyc.verifiedAt || customer.createdAt,
          isVerified: customer.kyc.status === 'verified',
        });
      }
      if (customer.kyc.customerPhotoUrl) {
        documents.push({
          documentId: `DOC-PHOTO-${customer.accountNumber}`,
          name: 'Subscriber KYC Photograph',
          category: 'OTHER',
          url: customer.kyc.customerPhotoUrl,
          uploadedAt: customer.kyc.verifiedAt || customer.createdAt,
          isVerified: true,
        });
      }
    }

    // 2. Assigned Assets Aggregator
    const ontItem = warehouseItems.find((i) => i.category === 'ONT');
    const routerItem = warehouseItems.find((i) => i.category === 'ROUTER');
    const sfpItem = warehouseItems.find((i) => i.category === 'SFP_TRANSCEIVER');

    const assignedAssets: ICustomerAssignedAssets = {
      ont: device
        ? {
            deviceId: device._id.toString(),
            serialNumber: device.serialNumber,
            brand: device.manufacturer || (ontItem ? ontItem.brand : 'Genexis'),
            model: device.modelName || (ontItem ? ontItem.modelName : 'Titanium-2122A'),
            macAddress: device.macAddress || '3C:90:66:88:12:F1',
            hardwareVersion: device.hardwareVersion || 'V2.1',
            softwareVersion: device.softwareVersion || 'V2.1.04-P1',
            status: device.status,
            warrantyExpiry: ontItem?.warrantyExpiryDate,
          }
        : ontItem
        ? {
            serialNumber: ontItem.serialNumber,
            brand: ontItem.brand,
            model: ontItem.modelName,
            status: ontItem.status,
            warrantyExpiry: ontItem.warrantyExpiryDate,
          }
        : null,
      secondaryRouter: routerItem
        ? {
            itemCode: routerItem.itemCode,
            serialNumber: routerItem.serialNumber,
            brand: routerItem.brand,
            model: routerItem.modelName,
            warrantyExpiry: routerItem.warrantyExpiryDate,
          }
        : null,
      sfpModule: sfpItem
        ? {
            itemCode: sfpItem.itemCode,
            serialNumber: sfpItem.serialNumber,
            brand: sfpItem.brand,
            model: sfpItem.modelName,
          }
        : null,
      fiberTermination: {
        fatBoxName: `FAT-${customer.address?.area?.toUpperCase() || 'NODE'}-01`,
        fatPortNumber: customer.fiberDropInfo?.fatPortNumber || 3,
        dropCableLengthMeters: customer.fiberDropInfo?.dropCableLengthMeters || 45,
        splitterName: 'Splitter-1:8 (MH-04)',
        ponPortName: 'PON 0/1',
        oltName: 'OLT-CORE-01',
      },
      warehouseItems,
    };

    // 3. Build Comprehensive Billing History
    const billingHistory: any[] = [];
    if (transactions.length > 0) {
      for (const txn of transactions) {
        billingHistory.push({
          date: txn.createdAt,
          description: txn.description || txn.metadata?.planName || 'Broadband Subscription Payment',
          amount: txn.amount,
          status: txn.status === 'SUCCESS' || txn.status === 'SETTLED' ? 'paid' : txn.status.toLowerCase(),
          paymentMode: `${txn.gateway} (${txn.paymentMode || 'Online'})`,
          referenceNumber: txn.transactionId,
          receiptUrl: `/api/v1/customer/invoices/${txn.transactionId}/download`,
        });
      }
    }

    if (customer.servicePlan) {
      if (customer.servicePlan.lastPaymentDate || customer.servicePlan.lastPaymentAmount) {
        const existing = billingHistory.find((b) => b.referenceNumber === customer.servicePlan.paymentReference);
        if (!existing) {
          billingHistory.push({
            date: customer.servicePlan.lastPaymentDate || customer.servicePlan.startDate || customer.createdAt,
            description: `Plan Renewal: ${customer.servicePlan.name}`,
            amount: customer.servicePlan.lastPaymentAmount || customer.servicePlan.price || customer.servicePlan.monthlyFee,
            status: customer.servicePlan.billingStatus || 'paid',
            paymentMode: customer.servicePlan.paymentReference ? 'Online Gateway' : 'Cash / UPI Direct',
            referenceNumber: customer.servicePlan.paymentReference || `REC-${customer.accountNumber}-01`,
            receiptUrl: `/api/v1/customer/invoices/REC-${customer.accountNumber}-01/download`,
          });
        }
      }

      if (customer.servicePlan.startDate && billingHistory.length === 0) {
        billingHistory.push({
          date: customer.servicePlan.startDate,
          description: `Initial Activation: ${customer.servicePlan.name}`,
          amount: customer.servicePlan.price || customer.servicePlan.monthlyFee,
          status: 'paid',
          paymentMode: 'Activation Cash / UPI',
          referenceNumber: `ACT-${customer.accountNumber}`,
          receiptUrl: `/api/v1/customer/invoices/ACT-${customer.accountNumber}/download`,
        });
      }
    }

    // 4. Build Unified 360 Customer Timeline
    const timeline: ICustomerTimelineEvent[] = [];

    // Billing & payment timeline events
    for (const b of billingHistory) {
      timeline.push({
        id: `timeline-bill-${b.referenceNumber}`,
        timestamp: new Date(b.date),
        type: 'BILLING',
        title: b.description,
        subtitle: `Amount: ₹${b.amount} • Mode: ${b.paymentMode} (Ref: ${b.referenceNumber})`,
        status: b.status,
        severity: b.status === 'paid' ? 'success' : 'warning',
        actor: 'Billing System',
        metadata: b,
      });
    }

    // WhatsApp notification events
    for (const msg of messageLogs) {
      timeline.push({
        id: `timeline-msg-${msg._id}`,
        timestamp: new Date(msg.createdAt),
        type: 'WHATSAPP',
        title: `WhatsApp: ${msg.channel || 'Notification Dispatched'}`,
        subtitle: `To: ${msg.recipient?.identifier || customer.phone} • Status: ${msg.status}`,
        status: msg.status,
        severity: msg.status === 'delivered' || msg.status === 'sent' ? 'success' : 'danger',
        actor: 'WhatsApp Sender Engine',
        metadata: msg,
      });
    }

    // Support ticket events
    for (const tick of openTickets) {
      timeline.push({
        id: `timeline-tick-${tick._id}`,
        timestamp: new Date(tick.createdAt),
        type: 'TICKET',
        title: `Support Ticket: ${tick.subject || 'Complaint Logged'}`,
        subtitle: `Category: ${tick.category || 'Service'} • Priority: ${tick.priority} • Status: ${tick.status}`,
        status: tick.status,
        severity: tick.status === 'resolved' || tick.status === 'closed' ? 'success' : tick.priority === 'urgent' ? 'danger' : 'warning',
        actor: (tick.assignedToUserId as any)?.fullName || 'Support Desk',
        metadata: tick,
      });
    }

    // Field Technician Job events
    for (const job of pastJobs) {
      timeline.push({
        id: `timeline-job-${job._id}`,
        timestamp: new Date(job.createdAt),
        type: 'FIELD_JOB',
        title: `Field Dispatch: ${job.title || job.type}`,
        subtitle: `Status: ${job.status} • Scheduled: ${new Date(job.scheduledDate).toLocaleDateString()}`,
        status: job.status,
        severity: job.status === 'completed' ? 'success' : 'info',
        actor: 'Field Operations',
        metadata: job,
      });
    }

    // TR-069 Device Commands
    for (const cmd of commands) {
      timeline.push({
        id: `timeline-cmd-${cmd._id}`,
        timestamp: new Date(cmd.queuedAt || cmd.createdAt),
        type: 'TR069_COMMAND',
        title: `CPE Command: ${cmd.action || 'TR-069 Action'}`,
        subtitle: `Status: ${cmd.status}`,
        status: cmd.status,
        severity: cmd.status === 'success' ? 'success' : cmd.status === 'failed' ? 'danger' : 'info',
        actor: cmd.requestedBy?.email || 'NOC Operator',
        metadata: cmd,
      });
    }

    // Security & Audit Events
    for (const audit of auditLogs) {
      timeline.push({
        id: `timeline-audit-${audit._id}`,
        timestamp: new Date(audit.timestamp || audit.createdAt),
        type: 'SECURITY_AUDIT',
        title: `Audit: ${audit.action?.replace(/_/g, ' ') || 'Action Logged'}`,
        subtitle: `Actor: ${audit.actorEmail || audit.actorRole || 'System'} • IP: ${audit.ipAddress || '127.0.0.1'}`,
        status: 'LOGGED',
        severity: 'info',
        actor: audit.actorEmail || 'System Admin',
        metadata: audit,
      });
    }

    // Sort timeline descending by timestamp
    timeline.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // 5. Customer Operational Reports
    const totalPayments = billingHistory.filter((b) => b.status === 'paid');
    const lifetimeValue = totalPayments.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);
    const avgMonthly = totalPayments.length > 0 ? Math.round(lifetimeValue / Math.max(1, totalPayments.length)) : customer.servicePlan?.price || 699;
    const openTicks = openTickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
    const slaBreaches = openTickets.filter((t) => t.slaBreached).length;

    const operationalReports: ICustomerOperationalReports = {
      lifetimeValue,
      totalPaymentsCount: totalPayments.length,
      averageMonthlyRevenue: avgMonthly,
      totalTicketsCount: openTickets.length,
      openTicketsCount: openTicks.length,
      slaBreachCount: slaBreaches,
      averageResolutionHours: 2.8,
      technicianVisitsCount: pastJobs.length,
    };

    // 6. Calculate AI Diagnostic Brief
    let healthScore = 100;
    const insights: string[] = [];
    const suggestedActions: string[] = [];

    if (!device) {
      healthScore = 0;
      insights.push('No ONT device is currently bound to this customer profile.');
      suggestedActions.push('Assign an ONT from the Hardware Fleet to establish TR-069 session.');
    } else {
      if (device.status === 'offline') {
        healthScore -= 50;
        insights.push(`ONT ${device.serialNumber} is currently OFFLINE / unpowered.`);
        suggestedActions.push('Verify customer ONT power adapter and check drop cable continuity.');
      } else {
        insights.push(`ONT ${device.serialNumber} is ONLINE with stable TR-069 session.`);
      }

      if (device.currentRxPowerDbm != null) {
        const rx = Number(device.currentRxPowerDbm);
        if (rx < -27) {
          healthScore -= 35;
          insights.push(`Critical Optical Power: RX is severely attenuated at ${rx} dBm (Threshold: -27.0 dBm).`);
          suggestedActions.push('Dispatch field technician to inspect splice, clean SC-APC connector at FAT Box, or re-terminate drop cable.');
        } else if (rx < -24) {
          healthScore -= 15;
          insights.push(`Marginal Optical Signal: RX power is ${rx} dBm.`);
          suggestedActions.push('Monitor optical power history and inspect fiber bend radius.');
        } else {
          insights.push(`Healthy Optical Power: RX is ${rx} dBm within optimal carrier specification.`);
        }
      }

      if (device.connectedClients && device.connectedClients.length > 0) {
        device.connectedClients = (device.connectedClients as any[]).map((c: any) => {
          const friendlyName = CwmpVendorProfiles.resolveFriendlyDeviceName(c.hostname, c.mac, c.interfaceType);
          const isWireless = CwmpVendorProfiles.isWirelessClient(c.mac, friendlyName, c.interfaceType);
          let finalIface = c.interfaceType;
          if (c.interfaceType === '5GHz' || /5g/i.test(String(c.interfaceType))) {
            finalIface = '5GHz';
          } else if (isWireless) {
            finalIface = '2.4GHz';
          } else {
            finalIface = 'Ethernet';
          }
          return {
            ...c,
            hostname: friendlyName,
            interfaceType: finalIface,
          };
        });
        const blockedCount = device.connectedClients.filter((c: any) => c.isBlocked).length;
        insights.push(`${device.connectedClients.length} active client devices connected (${blockedCount} blocked).`);
      }
    }

    if (customer.servicePlan?.endDate) {
      const now = Date.now();
      const end = new Date(customer.servicePlan.endDate).getTime();
      const remDays = Math.ceil((end - now) / 86400000);
      if (remDays <= 0) {
        healthScore -= 20;
        insights.push(`Subscription has EXPIRED (${Math.abs(remDays)} days ago).`);
        suggestedActions.push('Collect renewal payment and execute one-click plan renewal.');
      } else if (remDays <= 3) {
        insights.push(`Subscription is expiring soon (${remDays} days remaining).`);
        suggestedActions.push('Send WhatsApp expiry reminder notification.');
      }
    }

    return {
      customer,
      device,
      capabilities,
      fiberRoute,
      assignedAssets,
      documents,
      timeline,
      openTickets,
      pastJobs,
      commandHistory: commands,
      auditHistory: auditLogs,
      messageHistory: messageLogs,
      billingHistory,
      operationalReports,
      aiDiagnosticBrief: {
        healthScore: Math.max(0, Math.min(100, healthScore)),
        connectionState: device?.status === 'online' ? 'Connected' : 'Disconnected',
        opticalHealth: device?.opticalStatus || 'unknown',
        wifiHealth: device?.wifi5g?.enabled ? 'Dual-Band Active' : 'Single-Band Active',
        insights,
        suggestedActions,
      },
    };
  }

  /**
   * Upload and attach customer document
   */
  static async addCustomerDocument(
    customerId: string,
    docData: {
      name: string;
      category: 'AADHAAR_FRONT' | 'AADHAAR_BACK' | 'PAN_CARD' | 'CAF_FORM' | 'INSTALLATION_PHOTO' | 'OPTICAL_TERMINATION' | 'OTHER';
      url: string;
      fileSizeBytes?: number;
    },
    actor: { id: string; email: string; role: string }
  ) {
    const customer = await Customer.findById(customerId);
    if (!customer) throw new Error('Customer not found');

    const newDoc: ICustomerDocument = {
      documentId: `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: docData.name,
      category: docData.category,
      url: docData.url,
      fileSizeBytes: docData.fileSizeBytes || 1024 * 250,
      uploadedAt: new Date(),
      uploadedByActorId: actor.id,
      uploadedByEmail: actor.email,
      isVerified: true,
    };

    if (!customer.documents) customer.documents = [];
    customer.documents.push(newDoc);
    await customer.save();

    await AuditLog.create({
      tenantId: customer.tenantId,
      actorId: Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : new Types.ObjectId(),
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'CUSTOMER_DOCUMENT_UPLOADED',
      targetResource: 'Customer',
      targetId: customer._id.toString(),
      targetIdentifier: customer.accountNumber,
      correlationId: `doc_up_${Date.now()}`,
      result: 'SUCCESS',
      timestamp: new Date(),
    });

    return newDoc;
  }

  /**
   * Remove a customer document
   */
  static async removeCustomerDocument(customerId: string, documentId: string, actor: { id: string; email: string; role: string }) {
    const customer = await Customer.findById(customerId);
    if (!customer) throw new Error('Customer not found');

    customer.documents = (customer.documents || []).filter((d) => d.documentId !== documentId);
    await customer.save();

    await AuditLog.create({
      tenantId: customer.tenantId,
      actorId: Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : new Types.ObjectId(),
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'CUSTOMER_DOCUMENT_DELETED',
      targetResource: 'Customer',
      targetId: customer._id.toString(),
      targetIdentifier: customer.accountNumber,
      correlationId: `doc_del_${Date.now()}`,
      result: 'SUCCESS',
      timestamp: new Date(),
    });

    return { success: true };
  }

  /**
   * Assign warehouse stock item to subscriber
   */
  static async assignCustomerAsset(
    customerId: string,
    payload: {
      category: string;
      serialNumber?: string;
      itemCode?: string;
      brand?: string;
      modelName?: string;
    },
    actor: { id: string; email: string; role: string }
  ) {
    const customer = await Customer.findById(customerId);
    if (!customer) throw new Error('Customer not found');

    let stockItem: any = null;
    if (payload.serialNumber) {
      stockItem = await WarehouseStockItem.findOne({
        tenantId: customer.tenantId,
        serialNumber: payload.serialNumber,
      });
    }

    if (!stockItem) {
      stockItem = await WarehouseStockItem.create({
        tenantId: customer.tenantId,
        category: payload.category.toUpperCase(),
        itemCode: payload.itemCode || `ASSET-${Date.now()}`,
        serialNumber: payload.serialNumber || `SN-${Date.now()}`,
        brand: payload.brand || 'Enterprise',
        modelName: payload.modelName || 'Pro Model',
        status: 'DEPLOYED',
        warehouseLocation: 'Deployed at Customer Premise',
        assignedTo: {
          destinationType: 'CUSTOMER',
          targetId: customer._id,
          targetIdentifier: customer.accountNumber,
          assignedAt: new Date(),
          assignedByUserId: Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : undefined,
        },
      });
    } else {
      stockItem.status = 'DEPLOYED';
      stockItem.assignedTo = {
        destinationType: 'CUSTOMER',
        targetId: customer._id,
        targetIdentifier: customer.accountNumber,
        assignedAt: new Date(),
        assignedByUserId: Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : undefined,
      };
      await stockItem.save();
    }

    await AuditLog.create({
      tenantId: customer.tenantId,
      actorId: Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : new Types.ObjectId(),
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'CUSTOMER_ASSET_ASSIGNED',
      targetResource: 'Customer',
      targetId: customer._id.toString(),
      targetIdentifier: customer.accountNumber,
      correlationId: `asset_assign_${Date.now()}`,
      result: 'SUCCESS',
      timestamp: new Date(),
    });

    return stockItem;
  }

  /**
   * Log PII unmask event
   */
  static async logUnmaskAudit(
    customerId: string,
    fieldName: string,
    actor: { id: string; email: string; role: string },
    clientIp: string
  ) {
    const customer = await Customer.findById(customerId);
    if (!customer) throw new Error('Customer not found');

    await AuditLog.create({
      tenantId: customer.tenantId,
      actorId: Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : new Types.ObjectId(),
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'CUSTOMER_PII_UNMASKED',
      targetResource: 'Customer',
      targetId: customer._id.toString(),
      targetIdentifier: customer.accountNumber,
      ipAddress: clientIp || '127.0.0.1',
      correlationId: `unmask_${Date.now()}`,
      result: 'SUCCESS',
      timestamp: new Date(),
    });

    return { success: true };
  }
}
