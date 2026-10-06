import mongoose from "mongoose";

// GST on a bill: intra-state supply = CGST + SGST, inter-state = IGST, or none.
export const GST_TYPES = ["cgst_sgst", "igst", "none"];

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

    // Bill amounts, captured at stock entry (Receive material, step 5).
    // Recorded for later use under Payments — nothing reads them for payment
    // yet. totalBill is always computed server-side (see computeBillAmounts in
    // controllers/taxInvoiceController.js), never trusted from the client:
    //   totalBill = paymentAmount + GST (CGST + SGST, or IGST)
    // Freight is stored separately and is NOT part of totalBill / grandTotal.
    // All of these are optional; invoices saved before they existed have none.
    //
    // paymentAmount = the invoice's taxable value, i.e. the amount before GST
    // and before freight.
    paymentAmount: { type: Number, min: 0, default: null },
    // Which GST applies: intra-state = CGST + SGST, inter-state = IGST.
    gstType: { type: String, enum: [...GST_TYPES, null], default: null },
    cgstAmount: { type: Number, min: 0, default: 0 },
    sgstAmount: { type: Number, min: 0, default: 0 },
    igstAmount: { type: Number, min: 0, default: 0 },
    // Optional, kept separate from the GST figures.
    freightCharges: { type: Number, min: 0, default: 0 },
    totalBill: { type: Number, min: 0, default: null },
    // The invoice's own final total (as printed, so it can differ from totalBill
    // by a round-off). Entered or read off the invoice at step 5; when nothing
    // is entered it defaults to totalBill.
    grandTotal: { type: Number, min: 0, default: null },

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