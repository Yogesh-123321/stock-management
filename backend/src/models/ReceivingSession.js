import mongoose from "mongoose";

// A receiving session is one physical delivery being walked through the
// "Receive material" wizard. Because the paperwork for a delivery often
// arrives on different days (PI today, stock next week, tax invoice later),
// the session is persisted after every step so it can be saved, exited and
// resumed at exactly the step it was left on.
const receivingSessionSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },

    purchaseOrderDoc: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", default: null },
    proformaInvoiceDoc: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", default: null },

    // 1 Vendor · 2 PO · 3 PI · 4 Stock entry · 5 Tax invoice
    currentStep: { type: Number, default: 2, min: 1, max: 5 },

    poSkipped: { type: Boolean, default: false },
    piSkipped: { type: Boolean, default: false },
    stockEntryDone: { type: Boolean, default: false },
    // Total quantity actually booked into stock for this delivery, kept so a
    // resumed session can still reconcile against the PO/PI and tax invoice.
    stockQuantity: { type: Number, default: 0 },
    taxInvoiceDone: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned"],
      default: "in_progress",
    },

    notes: { type: String, trim: true },
    lastSavedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ReceivingSession", receivingSessionSchema);