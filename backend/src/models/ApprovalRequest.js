import mongoose from "mongoose";

/**
 * Generic approval envelope used for PO, PI, vendor and buyer registrations.
 * (New part numbers keep their richer PartApprovalRequest model, but they also
 * push notifications through the same helpers.)
 */
const approvalRequestSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ["po", "pi", "vendor", "buyer"],
      required: true,
      index: true,
    },
    /** Id of the PO / PI / Vendor / Buyer document being approved. */
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    /** Mongoose model name so we can stamp the source document on decision. */
    entityModel: { type: String, default: "" },
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    amount: { type: Number, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    requestRemarks: { type: String, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewRemarks: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

approvalRequestSchema.index({ entityType: 1, entityId: 1, status: 1 });

export default mongoose.models.ApprovalRequest ||
  mongoose.model("ApprovalRequest", approvalRequestSchema);
