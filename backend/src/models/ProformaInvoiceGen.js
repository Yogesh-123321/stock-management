import mongoose from "mongoose";

/*
  A PI generated via the "Generate PI" utility (distinct from TaxInvoice /
  the PurchaseOrder "Proforma Invoice" upload — those are files a vendor
  sends TISPL; this is a PI TISPL itself issues to a buyer, built from the
  TISPL/PI/... template).
*/
const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    hsnSac: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 }, // quantity * rate, computed server-side
  },
  { _id: false }
);

const proformaInvoiceGenSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, required: true, trim: true },
    invoiceDate: { type: Date, required: true },

    buyerName: { type: String, required: true, trim: true },
    buyerAddress: { type: String, trim: true },
    buyerGSTIN: { type: String, trim: true },
    buyerContact: { type: String, trim: true },
    buyerEmail: { type: String, trim: true },
    buyerDated: { type: Date },

    specialNote: { type: String, trim: true },
    paymentTerms: { type: String, trim: true },
    bankDetails: { type: String, trim: true },

    items: { type: [lineItemSchema], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },

    taxType: { type: String, enum: ["IGST", "CGST_SGST", "NONE"], default: "IGST" },
    taxRate: { type: Number, default: 18, min: 0, max: 100 },

    subTotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    amountInWords: { type: String, required: true },

    // Lifecycle of the issued PI: "open" while the buyer hasn't settled /
    // converted it yet (these are the ones offered in the "open PI" dropdowns),
    // "closed" once it's done with.
    status: { type: String, enum: ["open", "closed"], default: "open" },
pdfUrl: { type: String, trim: true },
    // Admin sign-off gate — a PI can only be downloaded once approved.
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    createdByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ProformaInvoiceGen", proformaInvoiceGenSchema);
