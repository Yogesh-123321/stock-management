import mongoose from "mongoose";

/**
 * One row per recipient. An approval raised by a user fans out to every admin
 * (one notification each); the decision fans back to the requester.
 */
const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["approval_requested", "approval_approved", "approval_rejected", "info"],
      default: "info",
      index: true,
    },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    /** Client-side route to open when the notification is clicked. */
    link: { type: String, default: "" },
    entityType: {
      type: String,
      enum: ["po", "pi", "part", "vendor", "buyer", "other"],
      default: "other",
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    approvalRequest: { type: mongoose.Schema.Types.ObjectId, ref: "ApprovalRequest", default: null },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

export default mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
