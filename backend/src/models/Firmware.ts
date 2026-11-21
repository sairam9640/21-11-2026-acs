import { Schema, model, Document, Types } from 'mongoose';

export interface IFirmware extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  vendor: string;
  modelName: string;
  hardwareVersion?: string;
  targetVersion: string;
  minVersion?: string;
  fileName: string;
  fileSize: number;
  fileMd5?: string;
  fileSha256?: string;
  filePath: string;
  fileUrl?: string;
  fileType: string;
  description?: string;
  isPublished: boolean;
  uploadedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FirmwareSchema = new Schema<IFirmware>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    vendor: { type: String, required: true, index: true },
    modelName: { type: String, required: true, index: true },
    hardwareVersion: { type: String },
    targetVersion: { type: String, required: true, index: true },
    minVersion: { type: String },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    fileMd5: { type: String },
    fileSha256: { type: String },
    filePath: { type: String, required: true },
    fileUrl: { type: String },
    fileType: { type: String, default: '1 Firmware Upgrade Image' },
    description: { type: String },
    isPublished: { type: Boolean, default: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  }
);

FirmwareSchema.index({ tenantId: 1, vendor: 1, modelName: 1, targetVersion: 1 }, { unique: true });

export const Firmware = model<IFirmware>('Firmware', FirmwareSchema);
