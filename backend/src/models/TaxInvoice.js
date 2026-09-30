import mongoose from "mongoose";

// How a supplier invoice was settled. "Cash purchase" is the only method with
// no UTR / bank reference — every other method must carry one.
export const CASH_METHOD = "Cash purchase";
export const PAYMENT_METHODS = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Card", "Other", CASH_METHOD];

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
          // 1-based page of the invoice PDF this row was read from. Absent on
          // extractions cached before page tracking — "Regenerate extraction"
          // fills it in.
          page: { type: Number, default: null },
        },
      ],
      default: undefined,
    },
    lineExtractionModel: { type: String, default: null },
    lineExtractedAt: { type: Date, default: null },

    // Billing: every tax invoice uploaded at stock entry lands in the Billing
    // page as UNPAID and is marked paid there. Invoices saved before this
    // field existed have no payment.status at all — treat "not paid" as unpaid.
    payment: {
      status: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
      method: { type: String, enum: [...PAYMENT_METHODS, ""], default: "" },
      // Required for every method except a cash purchase, where it stays null.
      utrNumber: { type: String, trim: true, default: null },
      // Date the money actually went out (entered by the person paying).
      paymentDate: { type: Date, default: null },
      // When it was recorded in the system, and by whom.
      paidAt: { type: Date, default: null },
      paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      paidByName: { type: String, default: "" },
      remarks: { type: String, trim: true, default: "" },
    },
  },
  { timestamps: true }
);

taxInvoiceSchema.index({ "payment.status": 1, createdAt: -1 });

export default mongoose.model("TaxInvoice", taxInvoiceSchema);