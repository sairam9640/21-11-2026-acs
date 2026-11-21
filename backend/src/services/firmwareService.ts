import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Response } from 'express';
import { Types } from 'mongoose';
import { Firmware, IFirmware } from '../models/Firmware.js';
import { Device, IDevice } from '../models/Device.js';
import { DeviceCommand, IDeviceCommand } from '../models/DeviceCommand.js';
import { triggerGenieAcsConnectionRequest } from './connectionRequestService.js';
import { MetricsService } from './metricsService.js';

export interface FirmwareUpgradeValidationResult {
  allowed: boolean;
  reason?: string;
  device?: IDevice;
  firmware?: IFirmware;
}

export class FirmwareService {
  /**
   * Calculates MD5 and SHA256 checksums for a file on disk
   */
  static async computeFileChecksums(filePath: string): Promise<{ md5: string; sha256: string; size: number }> {
    return new Promise((resolve, reject) => {
      const hashMd5 = crypto.createHash('md5');
      const hashSha256 = crypto.createHash('sha256');
      let size = 0;

      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => {
        size += chunk.length;
        hashMd5.update(chunk);
        hashSha256.update(chunk);
      });

      stream.on('end', () => {
        resolve({
          md5: hashMd5.digest('hex'),
          sha256: hashSha256.digest('hex'),
          size,
        });
      });

      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Validates device health and hardware compatibility before allowing firmware upgrade
   */
  static async validateUpgradeSafety(
    deviceId: string | Types.ObjectId,
    firmwareId: string | Types.ObjectId
  ): Promise<FirmwareUpgradeValidationResult> {
    const device = await Device.findById(deviceId);
    if (!device) {
      return { allowed: false, reason: 'Device not found in inventory' };
    }

    const firmware = await Firmware.findById(firmwareId);
    if (!firmware) {
      return { allowed: false, reason: 'Firmware package not found' };
    }

    // 1. Device Offline / LOS Check
    if (device.status === 'offline' || device.opticalStatus === 'loss_of_signal') {
      return {
        allowed: false,
        reason: `Device is currently ${device.status} (Optical Status: ${device.opticalStatus}). Cannot flash firmware while unreachable.`,
        device,
        firmware,
      };
    }

    // 2. Optical Power Brick Protection
    // Optical Rx below -27.0 dBm has extreme packet drop rates which could corrupt flash write
    if (device.currentRxPowerDbm !== undefined && device.currentRxPowerDbm < -27.0) {
      return {
        allowed: false,
        reason: `Optical Rx Power is critically degraded (${device.currentRxPowerDbm} dBm). Refusing firmware push to prevent hardware bricking.`,
        device,
        firmware,
      };
    }

    // 3. Model Compatibility Check
    const devModel = (device.modelName || '').toLowerCase().trim();
    const fwModel = (firmware.modelName || '').toLowerCase().trim();
    if (devModel && fwModel && !devModel.includes(fwModel) && !fwModel.includes(devModel)) {
      return {
        allowed: false,
        reason: `Model mismatch: Device is '${device.modelName}' but firmware is targeted for '${firmware.modelName}'`,
        device,
        firmware,
      };
    }

    // 4. Hardware Version Compatibility Check (if specified)
    if (firmware.hardwareVersion && device.hardwareVersion) {
      const devHw = device.hardwareVersion.toLowerCase().trim();
      const fwHw = firmware.hardwareVersion.toLowerCase().trim();
      if (!devHw.includes(fwHw) && !fwHw.includes(devHw)) {
        return {
          allowed: false,
          reason: `Hardware version mismatch: Device HW is '${device.hardwareVersion}', firmware requires '${firmware.hardwareVersion}'`,
          device,
          firmware,
        };
      }
    }

    // 5. Redundant Flash Check (Already on target version)
    if (device.softwareVersion && device.softwareVersion.trim() === firmware.targetVersion.trim()) {
      return {
        allowed: false,
        reason: `Device is already running target firmware version ${firmware.targetVersion}`,
        device,
        firmware,
      };
    }

    // 6. Check if firmware file exists on disk
    if (!fs.existsSync(firmware.filePath)) {
      return {
        allowed: false,
        reason: `Firmware binary file missing on ACS storage: ${firmware.filePath}`,
        device,
        firmware,
      };
    }

    return { allowed: true, device, firmware };
  }

  /**
   * Dispatches a firmware upgrade command for a device
   */
  static async queueFirmwareUpgrade(
    deviceId: string | Types.ObjectId,
    firmwareId: string | Types.ObjectId,
    operatorId?: string | Types.ObjectId,
    acsDownloadBaseUrl?: string
  ): Promise<{ success: boolean; command?: IDeviceCommand; message: string }> {
    const validation = await this.validateUpgradeSafety(deviceId, firmwareId);
    if (!validation.allowed || !validation.device || !validation.firmware) {
      return { success: false, message: validation.reason || 'Upgrade safety check failed' };
    }

    const { device, firmware } = validation;
    const commandKey = `FW-UPG-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Construct download URL accessible by the CPE
    const baseUrl = acsDownloadBaseUrl || process.env.ACS_FIRMWARE_BASE_URL || 'http://127.0.0.1:7547';
    const downloadUrl = `${baseUrl.replace(/\/$/, '')}/firmware/download/${firmware._id}`;

    // Create DeviceCommand
    const cmd = await DeviceCommand.create({
      tenantId: device.tenantId,
      deviceId: device._id,
      serialNumber: device.serialNumber,
      action: 'FIRMWARE_UPGRADE',
      status: 'queued',
      queuedAt: new Date(),
      commandKey,
      parameters: {
        firmwareId: firmware._id.toString(),
        firmwareUrl: downloadUrl,
        fileSize: firmware.fileSize,
        targetVersion: firmware.targetVersion,
        fileName: firmware.fileName,
        fileType: firmware.fileType || '1 Firmware Upgrade Image',
        commandKey,
      },
      requestedBy: {
        userId: (operatorId as any) || new Types.ObjectId(),
        role: 'operator_admin',
        email: 'operator@acs.isp.net',
      },
      correlationId: `corr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      rollbackOnFailure: false,
    });

    MetricsService.recordFirmwareUpgrade();
    console.log(
      `[FirmwareService] Queued firmware upgrade for ${device.serialNumber} -> Target: ${firmware.targetVersion} (CommandKey: ${commandKey})`
    );

    // Trigger on-demand Connection Request so ONT checks in immediately
    triggerGenieAcsConnectionRequest(device.serialNumber).catch((err) => {
      console.warn(`[FirmwareService] Connection Request wakeup notice:`, err.message);
    });

    return {
      success: true,
      command: cmd,
      message: `Firmware upgrade queued for ${device.serialNumber} to ${firmware.targetVersion}. Triggered connection request.`,
    };
  }

  /**
   * Safe chunked streaming of firmware binary to CPE with Range request support
   */
  static streamFirmwareBinary(reqRangeHeader: string | undefined, firmware: IFirmware, res: Response): void {
    const filePath = firmware.filePath;
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${firmware.fileName}"`);

    if (reqRangeHeader) {
      const parts = reqRangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', end - start + 1);

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      res.status(200);
      res.setHeader('Content-Length', fileSize);
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    }
  }
}
