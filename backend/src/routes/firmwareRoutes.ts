import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Firmware } from '../models/Firmware.js';
import { Device } from '../models/Device.js';
import { DeviceCommand } from '../models/DeviceCommand.js';
import { FirmwareService } from '../services/firmwareService.js';

export const firmwareRouter = Router();

// Firmware binary streaming download endpoint for CPEs (Unauthenticated or Basic/Digest authed)
firmwareRouter.get('/firmware/download/:firmwareId', async (req: Request, res: Response) => {
  try {
    const { firmwareId } = req.params;
    const firmware = await Firmware.findById(firmwareId);
    if (!firmware) {
      return res.status(404).send('Firmware image not found');
    }
    FirmwareService.streamFirmwareBinary(req.headers.range, firmware, res);
  } catch (err: any) {
    console.error('[Firmware Download Error]:', err.message);
    res.status(500).send('Internal error downloading firmware binary');
  }
});

/**
 * GET /api/v1/operator/firmware
 * List firmware images for tenant
 */
firmwareRouter.get(
  '/api/v1/operator/firmware',
  authenticateToken as any,
  requireRole(['operator_admin', 'noc_operator']) as any,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const tenantId = user.tenantId;

      const query: any = {};
      if (user.role !== 'super_admin' && tenantId) {
        query.tenantId = tenantId;
      }

      if (req.query.vendor) {
        query.vendor = new RegExp(`^${(req.query.vendor as string).trim()}$`, 'i');
      }
      if (req.query.modelName) {
        query.modelName = new RegExp(`^${(req.query.modelName as string).trim()}$`, 'i');
      }

      const firmwares = await Firmware.find(query).sort({ createdAt: -1 });
      return res.json({
        success: true,
        count: firmwares.length,
        firmwares,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/operator/firmware/register
 * Register firmware image package with file checksums
 */
firmwareRouter.post(
  '/api/v1/operator/firmware/register',
  authenticateToken as any,
  requireRole(['operator_admin', 'noc_operator']) as any,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const tenantId = user.tenantId;
      const {
        vendor,
        modelName,
        hardwareVersion,
        targetVersion,
        minVersion,
        fileName,
        fileSize,
        filePath,
        fileMd5,
        fileSha256,
        description,
      } = req.body;

      if (!vendor || !modelName || !targetVersion || !fileName || !fileSize || !filePath) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: vendor, modelName, targetVersion, fileName, fileSize, filePath',
        });
      }

      const firmware = await Firmware.create({
        tenantId,
        vendor,
        modelName,
        hardwareVersion,
        targetVersion,
        minVersion,
        fileName,
        fileSize,
        filePath,
        fileMd5,
        fileSha256,
        description,
        isPublished: true,
        uploadedBy: user._id,
      });

      return res.status(201).json({
        success: true,
        message: `Firmware ${targetVersion} for ${vendor} ${modelName} registered successfully.`,
        firmware,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/operator/firmware/deploy
 * Deploy firmware upgrade to a specific device with pre-flight safety checks
 */
firmwareRouter.post(
  '/api/v1/operator/firmware/deploy',
  authenticateToken as any,
  requireRole(['operator_admin', 'noc_operator']) as any,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { deviceId, firmwareId } = req.body;

      if (!deviceId || !firmwareId) {
        return res.status(400).json({
          success: false,
          error: 'Both deviceId and firmwareId are required for deployment',
        });
      }

      // Base URL from request or environment
      const host = req.get('host');
      const protocol = req.protocol;
      const baseUrl = process.env.ACS_FIRMWARE_BASE_URL || `${protocol}://${host}`;

      const result = await FirmwareService.queueFirmwareUpgrade(
        deviceId,
        firmwareId,
        user._id,
        baseUrl
      );

      if (!result.success) {
        return res.status(422).json({
          success: false,
          error: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
        command: result.command,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v1/operator/firmware/batch-deploy
 * Deploy firmware upgrade to all eligible devices matching vendor and model
 */
firmwareRouter.post(
  '/api/v1/operator/firmware/batch-deploy',
  authenticateToken as any,
  requireRole(['operator_admin', 'noc_operator']) as any,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const tenantId = user.tenantId;
      const { firmwareId } = req.body;

      if (!firmwareId) {
        return res.status(400).json({ success: false, error: 'firmwareId is required' });
      }

      const firmware = await Firmware.findById(firmwareId);
      if (!firmware) {
        return res.status(404).json({ success: false, error: 'Firmware not found' });
      }

      // Query online devices for this tenant and model that are not yet on target version
      const devices = await Device.find({
        tenantId,
        modelName: new RegExp(firmware.modelName, 'i'),
        status: 'online',
        softwareVersion: { $ne: firmware.targetVersion },
        opticalStatus: { $ne: 'loss_of_signal' },
      });

      const host = req.get('host');
      const protocol = req.protocol;
      const baseUrl = process.env.ACS_FIRMWARE_BASE_URL || `${protocol}://${host}`;

      const deployed: string[] = [];
      const skipped: { serialNumber: string; reason: string }[] = [];

      for (const dev of devices) {
        const queueRes = await FirmwareService.queueFirmwareUpgrade(
          dev._id,
          firmware._id,
          user._id,
          baseUrl
        );

        if (queueRes.success) {
          deployed.push(dev.serialNumber);
        } else {
          skipped.push({ serialNumber: dev.serialNumber, reason: queueRes.message });
        }
      }

      return res.json({
        success: true,
        message: `Batch deployment processed for ${firmware.vendor} ${firmware.modelName}`,
        deployedCount: deployed.length,
        skippedCount: skipped.length,
        deployed,
        skipped,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * GET /api/v1/operator/firmware/device/:deviceId/status
 * Check firmware upgrade status for a specific device
 */
firmwareRouter.get(
  '/api/v1/operator/firmware/device/:deviceId/status',
  authenticateToken as any,
  requireRole(['operator_admin', 'noc_operator']) as any,
  async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const device = await Device.findById(deviceId);
      if (!device) {
        return res.status(404).json({ success: false, error: 'Device not found' });
      }

      const recentCommands = await DeviceCommand.find({
        deviceId: device._id,
        action: 'FIRMWARE_UPGRADE',
      })
        .sort({ queuedAt: -1, createdAt: -1 })
        .limit(5);

      return res.json({
        success: true,
        currentVersion: device.softwareVersion,
        hardwareVersion: device.hardwareVersion,
        lastSyncStatus: device.lastParameterSyncStatus,
        recentUpgradeCommands: recentCommands,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);
