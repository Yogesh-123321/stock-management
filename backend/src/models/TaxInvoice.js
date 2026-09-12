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

    // Cache of the AI line-item read of documentUrl, keyed to the
    // "invoice vs. material entered" comparison dialog (see
    // getTaxInvoiceLineMatch in controllers/taxInvoiceController.js).
    // Populated lazily on first view of that dialog, not on upload — kept
    // here so re-opening the dialog doesn't re-run the AI extraction
    // every time, only when the person explicitly asks to re-run it.
    extractedLines: {
      type: [
        {
          partNumber: { type: String, default: null },
          description: { type: String, default: "" },
          quantity: { type: Number, default: null },
          unitPrice: { type: Number, default: null },
          amount: { type: Number, default: null },
        },
      ],
      default: undefined,
    },
    lineExtractionModel: { type: String, default: null },
    lineExtractedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("TaxInvoice", taxInvoiceSchema);