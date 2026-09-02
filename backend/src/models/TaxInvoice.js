import mongoose from "mongoose";

/*
  The tax invoice is the final document in the receiving flow: uploaded
  after stock entry is done for a delivery, tied back to the vendor and to
  the PO/PI (whichever was uploaded — "purchaseOrder" here means "the
  PurchaseOrder-model document that anchors this delivery", not
  specifically a Purchase Order as opposed to a Proforma Invoice).
*/
const taxInvoiceSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    // Optional: the tax invoice can arrive with no PO/PI on record.
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", default: null },

    invoiceNumber: { type: String, trim: true },
    invoiceDate: { type: Date },

    documentUrl: { type: String, required: true },
    originalFileName: { type: String },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("TaxInvoice", taxInvoiceSchema);