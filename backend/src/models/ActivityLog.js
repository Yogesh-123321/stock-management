import mongoose from "mongoose";

/**
 * One row per user action. Written by the activityLogger middleware for every
 * mutating API call, and by logActivity() wherever a controller wants to record
 * something richer (approval decisions, downloads, logins, ...).
 *
 * Logs are append-only — nothing in the app deletes or edits them.
 */
const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    // Denormalised so the log stays readable even if the account is renamed/removed.
    userName: { type: String, default: "" },
    userRole: { type: String, default: "" },

    /** Machine key, e.g. "po.create", "part.approve", "auth.login". */
    action: { type: String, required: true, index: true },
    /** Human sentence shown in the log table. */
    description: { type: String, default: "" },

    entityType: {
      type: String,
      enum: [
        "po",
        "pi",
        "part",
        "vendor",
        "buyer",
        "stock",
        "kit",
        "receiving",
        "invoice",
        "user",
        "auth",
        "other",
      ],
      default: "other",
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /** Readable reference (PO no, part no, vendor name, ...). */
    entityLabel: { type: String, default: "" },

    method: { type: String, default: "" },
    path: { type: String, default: "" },
    statusCode: { type: Number, default: null },
    /** ms taken by the request — handy to spot slow / stuck operations. */
    durationMs: { type: Number, default: null },
    success: { type: Boolean, default: true, index: true },

    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },

    /** Small, PII-safe extract of the request body / result. */
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ entityType: 1, createdAt: -1 });

export default mongoose.models.ActivityLog || mongoose.model("ActivityLog", activityLogSchema);