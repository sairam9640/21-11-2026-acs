import { Types } from 'mongoose';
import { Device, IDevice } from '../models/Device.js';
import { Customer } from '../models/Customer.js';
import { DeviceCommand } from '../models/DeviceCommand.js';
import { CwmpXmlParser } from './cwmpXmlParser.js';
import { MetricsService } from './metricsService.js';

export interface ZtpResult {
  triggered: boolean;
  type?: 'CUSTOMER_WAN_WIFI' | 'BASELINE_PERIODIC';
  customerId?: string;
  commandId?: string;
  message: string;
}

export class ZtpService {
  /**
   * Evaluates an incoming newly connected or unprovisioned device for Zero-Touch Provisioning
   */
  static async evaluateAndTriggerZtp(
    device: IDevice,
    tenantId: Types.ObjectId | string
  ): Promise<ZtpResult> {
    // Safety Policy: Automatic configuration push is strictly disabled.
    // In ISP production networks, auto-pushing WAN/VLAN settings can disrupt existing lines.
    // All provisioning must be manually reviewed and initiated by the Operator via MAC/Serial assignment.
    if (process.env.ENABLE_AUTO_ZTP !== 'true') {
      return {
        triggered: false,
        message: 'Auto-ZTP is disabled. Operator manual configuration required via MAC/Serial.',
      };
    }

    const serialAliases = CwmpXmlParser.getSerialNumberAliases(device.serialNumber);
    const macClean = device.macAddress?.replace(/[:-]/g, '').toLowerCase();

    // 1. Check if device has an assigned Customer in inventory
    let customer = await Customer.findOne({
      tenantId,
      $or: [
        { assignedDeviceId: device._id },
        { 'wanConfig.pppoeUsername': { $in: serialAliases } },
        { serviceId: { $in: serialAliases } },
      ],
    });

    // 2. Customer Match Found -> Provision WAN and Wi-Fi credentials
    if (customer) {
      if (!device.customerId) {
        device.customerId = customer._id;
        device.assigned = true;
        await device.save();
      }

      // Check if WAN config has already been queued or applied
      const existingCmd = await DeviceCommand.findOne({
        deviceId: device._id,
        action: { $in: ['SET_WAN_CONFIG', 'SET_WIFI_CONFIG'] },
        status: { $in: ['queued', 'sending', 'sent', 'applied', 'applied_pending_verification', 'verifying', 'verified'] },
      });

      if (!existingCmd) {
        const wanProfile = {
          name: 'WAN_Internet',
          connectionType: customer.wanConfig?.connectionType || 'PPPoE',
          pppoeUsername: customer.wanConfig?.pppoeUsername || '',
          pppoePassword: customer.wanConfig?.pppoePasswordEncrypted || '',
          vlanEnabled: Boolean(customer.wanConfig?.vlanId),
          vlanId: customer.wanConfig?.vlanId || 100,
          enableWan: true,
          natEnabled: true,
        };

        const cmd = await DeviceCommand.create({
          tenantId,
          deviceId: device._id,
          serialNumber: device.serialNumber,
          action: 'SET_WAN_CONFIG',
          status: 'queued',
          queuedAt: new Date(),
          parameters: {
            wanProfile,
            ztp: true,
          },
          requestedBy: {
            userId: new Types.ObjectId(),
            role: 'system_ztp',
            email: 'ztp-automation@acs.isp.net',
          },
          correlationId: `ztp-wan-${Date.now()}-${device.serialNumber}`,
          rollbackOnFailure: false,
        });

        MetricsService.recordZtpProvision();
        console.log(`[ZTP Engine] Automated ZTP WAN profile queued for customer '${customer.fullName || customer._id}' on device ${device.serialNumber}`);
        return {
          triggered: true,
          type: 'CUSTOMER_WAN_WIFI',
          customerId: customer._id.toString(),
          commandId: cmd._id.toString(),
          message: `Zero-Touch Provisioning WAN profile dispatched for customer ${customer.fullName || customer.serviceId}`,
        };
      }
    }

    // 3. Baseline ISP Auto-Configuration (Periodic Inform Interval -> 300s)
    if (!device.periodicInformConfigured) {
      const isTr181 = device.modelName?.toUpperCase().includes('TR181') ||
        (device.rawParameters && Object.keys(device.rawParameters).some(k => k.startsWith('Device.')));

      const periodicParam = isTr181
        ? 'Device.ManagementServer.PeriodicInformInterval'
        : 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval';

      const cmd = await DeviceCommand.create({
        tenantId,
        deviceId: device._id,
        serialNumber: device.serialNumber,
        action: 'SetParameterValues',
        status: 'queued',
        queuedAt: new Date(),
        parameters: {
          parameterList: [
            [periodicParam, 300, 'xsd:unsignedInt'],
            [periodicParam.replace('PeriodicInformInterval', 'PeriodicInformEnable'), true, 'xsd:boolean'],
          ],
          ztp: true,
        },
        requestedBy: {
          userId: new Types.ObjectId(),
          role: 'system_ztp',
          email: 'ztp-automation@acs.isp.net',
        },
        correlationId: `ztp-baseline-${Date.now()}-${device.serialNumber}`,
        rollbackOnFailure: false,
      });

      MetricsService.recordZtpProvision();
      device.periodicInformConfigured = true;
      await device.save();
      console.log(`[ZTP Engine] Automated ZTP PeriodicInform configured for ${device.serialNumber}`);

      return {
        triggered: true,
        type: 'BASELINE_PERIODIC',
        commandId: cmd._id.toString(),
        message: `Zero-Touch Baseline PeriodicInform configured for ${device.serialNumber}`,
      };
    }

    return {
      triggered: false,
      message: 'No pending ZTP actions required for device',
    };
  }
}
