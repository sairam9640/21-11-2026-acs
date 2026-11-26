import { Schema, model, Document, Types } from 'mongoose';

export interface IInvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface IInvoice extends Document {
  _id: Types.ObjectId;
  invoiceId: string;
  invoiceNumber: string;
  tenantId: Types.ObjectId;
  customerId: Types.ObjectId;
  accountNumber: string;
  billingPeriod: {
    start: Date;
    end: Date;
  };
  lineItems: IInvoiceLineItem[];
  subtotal: number;
  discountAmount: number;
  taxRatePercent: number;
  taxAmount: number;
  totalPayable: number;
  status: 'ISSUED' | 'PAID' | 'CANCELLED' | 'VOID' | 'PENDING';
  issuedAt: Date;
  dueDate: Date;
  paidAt?: Date;
  paymentDetails?: {
    paymentMethod: string;
    transactionReference: string;
    amountPaid: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema = new Schema<IInvoice>(
  {
    invoiceId: { type: String, required: true, unique: true, index: true },
    invoiceNumber: { type: String, required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    accountNumber: { type: String, required: true, trim: true },
    billingPeriod: {
      start: { type: Date, required: true, default: Date.now },
      end: { type: Date, required: true },
    },
    lineItems: [
      {
        description: { type: String, required: true },
        quantity: { type: Number, required: true, default: 1 },
        unitPrice: { type: Number, required: true },
        total: { type: Number, required: true },
      },
    ],
    subtotal: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    taxRatePercent: { type: Number, default: 18.0 },
    taxAmount: { type: Number, required: true },
    totalPayable: { type: Number, required: true },
    status: {
      type: String,
      enum: ['ISSUED', 'PAID', 'CANCELLED', 'VOID', 'PENDING'],
      default: 'ISSUED',
      index: true,
    },
    issuedAt: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    paidAt: { type: Date },
    paymentDetails: {
      paymentMethod: { type: String },
      transactionReference: { type: String },
      amountPaid: { type: Number },
    },
  },
  { timestamps: true }
);

InvoiceSchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });

export const Invoice = model<IInvoice>('Invoice', InvoiceSchema);
