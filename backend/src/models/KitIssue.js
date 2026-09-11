import mongoose from "mongoose";

/*
  One KitIssue = one "issue this kit template, this many times, to this
  vendor" action. `lines` is a frozen snapshot taken at issue time (one per
  non-DNP template item, resolved against the parts master by
  ttUniquePartNumber) so the record stays meaningful even if the template
  is later edited or deleted — kitName/kitCode and every line's
  itemDescription/ttUniquePartNumber are copied in, not just referenced.

  Issuing a kit deducts stock immediately (unlike receiving, there is no
  "pending an invoice" step here), so quantityInStock always reflects
  every kit issue the moment it's created.
*/
const kitIssueLineSchema = new mongoose.Schema(
  {
    // Null when the part wasn't found in the master at all (a full
    // shortage) — everything else about the line is still recorded so the
    // gap shows up in history even though there's no Part to reference.
    part: { type: mongoose.Schema.Types.ObjectId, ref: "Part", default: null },
    ttUniquePartNumber: { type: String, trim: true, uppercase: true },
    itemDescription: { type: String, trim: true, default: "" },
    referenceDesignator: { type: String, trim: true, default: "" },
    qtyPerKit: { type: Number, required: true, min: 0 },
    qtyRequired: { type: Number, required: true, min: 0 }, // qtyPerKit * quantity issued
    qtyIssued: { type: Number, required: true, min: 0 }, // actually deducted from stock — may be less than qtyRequired
    qtyShort: { type: Number, default: 0 }, // qtyRequired - qtyIssued; >0 means this line was short
  },
  { timestamps: true }
);

const kitIssueSchema = new mongoose.Schema(
  {
    // Not populated-through for display — kept only so "view the template
    // this came from" can still work when the template still exists.
    kitTemplate: { type: mongoose.Schema.Types.ObjectId, ref: "KitTemplate", default: null },
    kitName: { type: String, required: true, trim: true }, // snapshot
    kitCode: { type: String, trim: true, default: "" }, // snapshot

    quantity: { type: Number, required: true, min: 1 }, // number of kits issued

    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true }, // recipient

    issuedBy: { type: String, trim: true, default: "" },
    issuedByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    remarks: { type: String, trim: true, default: "" },

    // True if any line in this issue had insufficient stock at the time of
    // issue (i.e. was issued short). Kept as its own flag so the issue
    // history list can flag it without re-scanning every line.
    hasShortage: { type: Boolean, default: false },

    lines: { type: [kitIssueLineSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("KitIssue", kitIssueSchema);