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

    // FIFO breakdown of which batch(es) qtyIssued was actually drawn
    // from, oldest batch first — e.g. 10 from batch "0124", then 2 from
    // "0224" once the first ran out (see utils/batchAllocation.js).
    // batchCode: null means stock that isn't tied to any batch (a legacy
    // receipt from before batch codes existed, or a manual stock
    // correction) — only ever reached once every real batch is
    // exhausted. Empty when nothing was actually issued for this line.
    batchBreakdown: {
      type: [
        {
          batchCode: { type: String, default: null },
          quantity: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

const kitIssueSchema = new mongoose.Schema(
  {
    // "draft" = saved progress, stock untouched, freely editable in place.
    // "issued" = the real thing — stock has been deducted and, from here
    // on, this document is only ever superseded by a new one (see
    // rootIssue/editedFrom below), never rewritten. Issuing a kit can take
    // 10-14 days in practice, so a draft lets the same in-progress kit be
    // saved and revisited any number of times before it's finally issued.
    status: { type: String, enum: ["draft", "issued"], default: "issued" },

    // Not populated-through for display — kept only so "view the template
    // this came from" can still work when the template still exists.
    kitTemplate: { type: mongoose.Schema.Types.ObjectId, ref: "KitTemplate", default: null },
    kitName: { type: String, required: true, trim: true }, // snapshot
    kitCode: { type: String, trim: true, default: "" }, // snapshot

    // Display code for THIS issue action specifically — defaults to the
    // kit's own code (or its name, if it has none) at the moment this
    // issue was created. Grows a letter suffix each time it's "edited"
    // (see rootIssue/editIndex below): ABC11 -> ABC11A -> ABC11B -> ...
    // Left blank while status is "draft" — it's only assigned the moment
    // the draft is actually issued.
    issueCode: { type: String, trim: true, default: "" },

    // Edit lineage. The original issue in a chain has rootIssue: null and
    // editIndex: 0. Every edit points rootIssue at that ORIGINAL (never at
    // its immediate parent, so the letter suffix always counts from the
    // start of the chain no matter which entry "Edit" was clicked on) and
    // editedFrom at whichever entry it was actually created from, for a
    // full trail. Editing never modifies the entry it was created from —
    // it only ever creates a new document alongside it.
    rootIssue: { type: mongoose.Schema.Types.ObjectId, ref: "KitIssue", default: null },
    editedFrom: { type: mongoose.Schema.Types.ObjectId, ref: "KitIssue", default: null },
    editIndex: { type: Number, default: 0 },

    // Not `required` at the schema level (a fresh draft may not have these
    // filled in yet) — the controllers enforce both being present the
    // moment a kit actually gets issued.
    quantity: { type: Number, default: 1, min: 0 }, // number of kits issued

    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null }, // recipient

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