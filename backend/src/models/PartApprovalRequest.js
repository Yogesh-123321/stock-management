import mongoose from "mongoose";

/**
 * A request to add a brand-new part number (or an alternate of an existing
 * part) to the master database.
 *
 * Only the ADMIN (or a user holding `part.approve`, which is admin-only by
 * config) can approve or reject. Users raise the request and get notified of
 * the decision.
 *
 * Lifecycle:  pending -> approved -> consumed   (or  pending -> rejected)
 */
const partApprovalRequestSchema = new mongoose.Schema(
  {
    requestType: {
      type: String,
      enum: ["new_part_number", "alternate_part"],
      required: true,
    },

    newPart: {
      typeOfPart: { type: String, trim: true, default: "" },
      manufacturerPartNumber: { type: String, trim: true, default: "" },
      itemDescription: { type: String, trim: true, required: true },
      companyCode: { type: String, trim: true, required: true },
      category: { type: String, trim: true, required: true },
      partTypeBatchNo: { type: String, trim: true, required: true },
    },

    alternateOfPart: { type: mongoose.Schema.Types.ObjectId, ref: "Part", default: null },

    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", default: null },
    searchTerm: { type: String, trim: true, default: "" },
    proposedQuantity: { type: Number, default: null },

    /** Free-text name kept for older rows / offline entries. */
    requestedBy: { type: String, trim: true, default: "" },
    /** The signed-in account that raised it — used to notify them back. */
    requestedByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    requestRemarks: { type: String, trim: true, default: "" },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "consumed"],
      default: "pending",
      index: true,
    },
    reviewedBy: { type: String, trim: true, default: "" },
    reviewedByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewRemarks: { type: String, trim: true, default: "" },

    createdPart: { type: mongoose.Schema.Types.ObjectId, ref: "Part", default: null },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

partApprovalRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.PartApprovalRequest ||
  mongoose.model("PartApprovalRequest", partApprovalRequestSchema);
