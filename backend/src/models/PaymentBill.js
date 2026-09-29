import mongoose from "mongoose";

/**
 * A bill that has to be paid out.
 *
 *   pending_approval  --admin approves-->  approved  --cashier pays-->  paid (closed)
 *          |
 *          +--admin rejects-->  rejected  --uploader edits & resubmits--> pending_approval
 */
export const PAYMENT_STATUSES = ["pending_approval", "approved", "rejected", "paid"];
export const PAYMENT_MODES = ["UPI", "NEFT", "RTGS", "IMPS", "Cheque", "Cash", "Card", "Other"];

const historySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["submitted", "approved", "rejected", "resubmitted", "paid"],
      required: true,
    },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Denormalised so the trail stays readable if an account is renamed/removed.
    byName: { type: String, default: "" },
    remarks: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const paymentBillSchema = new mongoose.Schema(
  {
    /** Human reference, e.g. PAY-2026-0001 */
    refNo: { type: String, required: true, unique: true },

    // ---- the bill itself ----
    /** The registered vendor being paid (picked from the vendor master). */
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", index: true },
    /** Vendor name as it was when the bill was uploaded — keeps old bills readable. */
    payeeName: { type: String, required: true, trim: true },
    billNo: { type: String, required: true, trim: true },
    billDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    category: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    documentUrl: { type: String, required: true },
    documentName: { type: String, default: "" },

    // ---- workflow ----
    status: { type: String, enum: PAYMENT_STATUSES, default: "pending_approval", index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    /** Admin who approved or rejected. */
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewRemarks: { type: String, default: "" },

    // ---- payment (filled in by the cashier) ----
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /** When the cashier recorded it in the system. */
    paidAt: { type: Date, default: null },
    /** Date the money actually went out (entered by the cashier). */
    paymentDate: { type: Date, default: null },
    transactionId: { type: String, trim: true, default: "", index: true },
    paymentMode: { type: String, enum: [...PAYMENT_MODES, ""], default: "" },
    paymentRemarks: { type: String, default: "" },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

paymentBillSchema.index({ payeeName: 1, billNo: 1 });
paymentBillSchema.index({ status: 1, createdAt: -1 });

// Yearly running number kept in its own tiny collection so two people
// uploading at the same moment can never get the same reference.
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter =
  mongoose.models.PaymentBillCounter || mongoose.model("PaymentBillCounter", counterSchema);

paymentBillSchema.statics.nextRefNo = async function nextRefNo() {
  const year = new Date().getFullYear();
  const c = await Counter.findOneAndUpdate(
    { _id: `payment-bill-${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `PAY-${year}-${String(c.seq).padStart(4, "0")}`;
};

export default mongoose.models.PaymentBill || mongoose.model("PaymentBill", paymentBillSchema);