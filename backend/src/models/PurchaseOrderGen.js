import mongoose from "mongoose";

/* A purchase order raised by us on a supplier, generated in the Technotrendz PO
   format. Kept separate from the PurchaseOrder model (which stores PO documents
   *received/uploaded* during material receiving) exactly the way the generated
   PI (ProformaInvoiceGen) is kept separate from uploaded PIs. */
const poGenItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    partNo: { type: String, trim: true }, // manufacturer part no., printed under the description
    hsnSac: { type: String, trim: true },
    dueOn: { type: Date },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, trim: true, default: "NOS" },
    rate: { type: Number, required: true, min: 0 },
    per: { type: String, trim: true, default: "NOS" },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseOrderGenSchema = new mongoose.Schema(
  {
    voucherNo: { type: String, required: true, trim: true, unique: true },
    voucherDate: { type: Date, required: true },

    paymentTerms: { type: String, trim: true },
    referenceNo: { type: String, trim: true },
    otherReferences: { type: String, trim: true },
    dispatchedThrough: { type: String, trim: true },
    destination: { type: String, trim: true },
    termsOfDelivery: { type: String, trim: true },

    // Supplier (bill from) — pulled from the vendor/buyer records, still editable
    supplierName: { type: String, required: true, trim: true },
    supplierAddress: { type: String, trim: true },
    supplierGSTIN: { type: String, trim: true },
    supplierStateName: { type: String, trim: true },
    supplierStateCode: { type: String, trim: true },

    // Consignee (ship to) — defaults to our own works address
    consigneeName: { type: String, trim: true },
    consigneeAddress: { type: String, trim: true },
    consigneeEmail: { type: String, trim: true },
    consigneeGSTIN: { type: String, trim: true },
    consigneeStateName: { type: String, trim: true },
    consigneeStateCode: { type: String, trim: true },

    items: { type: [poGenItemSchema], required: true },

    taxType: { type: String, enum: ["IGST", "CGST_SGST", "NONE"], default: "IGST" },
    taxRate: { type: Number, default: 0 },
    subTotal: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    totalQuantity: { type: Number, default: 0 },
    amountInWords: { type: String, trim: true },
    declaration: { type: String, trim: true },

    // Permanent Cloudinary URL of the archived PDF (set when the PO is created)
    pdfUrl: { type: String, trim: true },

    // Same open/closed lifecycle the other documents use
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model("PurchaseOrderGen", purchaseOrderGenSchema);
