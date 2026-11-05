import mongoose from "mongoose";

/*
  One SampleIssue = one "these parts went out to this buyer as SAMPLES" action.

  Samples are NOT kit stock. Issuing one moves quantity out of the part's main
  stock (Part.quantityInStock) into Part.sampleStock — the same pattern R&D
  stock uses — so a kit can never draw on it: kit issuing only ever reads
  quantityInStock. When the buyer sends samples back they are "received back":
  Part.sampleStock goes down and Part.quantityInStock goes up again.

  `lines` and `buyerName` are snapshots, so the record stays readable even if
  the buyer or part is later renamed. Outstanding quantity per line is stored
  (qtyOutstanding) so a return can be applied with one atomic conditional
  update — two people receiving the same samples back at once can never take
  back more than was issued.
*/

const documentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    fileName: { type: String, trim: true, default: "" },
    uploadedBy: { type: String, trim: true, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const sampleLineSchema = new mongoose.Schema({
  part: { type: mongoose.Schema.Types.ObjectId, ref: "Part", required: true },
  ttUniquePartNumber: { type: String, trim: true, uppercase: true },
  itemDescription: { type: String, trim: true, default: "" },
  unit: { type: String, trim: true, default: "" },
  qtyIssued: { type: Number, required: true, min: 0.001 },
  qtyReturned: { type: Number, default: 0, min: 0 },
  // qtyIssued - qtyReturned. Kept as a real field so returns can be applied
  // atomically (see receiveBack in sampleController.js).
  qtyOutstanding: { type: Number, required: true, min: 0 },
});

// One "samples received back" event (a buyer may return a few units at a time).
const returnEventSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: String, trim: true, default: "" },
  byUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  remarks: { type: String, trim: true, default: "" },
  // Optional return challan / gate pass / photos of what came back.
  documents: { type: [documentSchema], default: [] },
  lines: {
    type: [
      {
        line: { type: mongoose.Schema.Types.ObjectId, required: true },
        part: { type: mongoose.Schema.Types.ObjectId, ref: "Part", required: true },
        ttUniquePartNumber: { type: String, trim: true, uppercase: true },
        quantity: { type: Number, required: true, min: 0.001 },
        _id: false,
      },
    ],
    default: [],
  },
});

const sampleIssueSchema = new mongoose.Schema(
  {
    // Display code, e.g. SMP-0001 (assigned from an atomic counter).
    issueCode: { type: String, trim: true, unique: true, sparse: true },

    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "Buyer", required: true },
    buyerName: { type: String, trim: true, default: "" }, // snapshot

    // The buyer's / our delivery challan number as written on the document
    // (free text) — the scanned files themselves are in `challans`.
    challanNumber: { type: String, trim: true, default: "" },
    // Uploaded challan(s) — required (at least one) to issue samples.
    challans: { type: [documentSchema], default: [] },

    remarks: { type: String, trim: true, default: "" },
    issuedBy: { type: String, trim: true, default: "" },
    issuedByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    lines: { type: [sampleLineSchema], default: [] },
    returns: { type: [returnEventSchema], default: [] },

    // issued            - nothing has come back yet
    // partially_returned - some, but not all, units are back
    // returned          - every unit is back in main stock
    status: {
      type: String,
      enum: ["issued", "partially_returned", "returned"],
      default: "issued",
      index: true,
    },
    returnedAt: { type: Date, default: null }, // when the last unit came back
  },
  { timestamps: true }
);

sampleIssueSchema.index({ buyer: 1, createdAt: -1 });
sampleIssueSchema.index({ "lines.part": 1, status: 1 });

/* -------- atomic code counter (SMP-0001, SMP-0002 …) -------- */
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter =
  mongoose.models.SampleIssueCounter || mongoose.model("SampleIssueCounter", counterSchema);

export async function nextSampleIssueCode() {
  const c = await Counter.findOneAndUpdate(
    { _id: "sample-issue" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `SMP-${String(c.seq).padStart(4, "0")}`;
}

export default mongoose.models.SampleIssue || mongoose.model("SampleIssue", sampleIssueSchema);