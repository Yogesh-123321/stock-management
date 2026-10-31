/*
  One-time backfill: fills in Part.unit for parts whose unit is empty, using the
  unit that was entered on their most recent stock entry (Receive material).

  Before the fix in utils/stockBooking.js, the unit typed at stock entry was kept
  only on the StockEntry line and never copied to the parts master, so the Parts
  page (and kit templates) showed no unit. New entries now sync automatically;
  this script repairs the parts entered before that.

  Only parts with an EMPTY unit are touched — a unit already set on a part is
  never overwritten.

  Usage:
    cd backend
    node src/utils/backfillPartUnits.js          # preview only, changes nothing
    node src/utils/backfillPartUnits.js --apply  # write the units
*/
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Part from "../models/Part.js";
import StockEntry from "../models/StockEntry.js";

const apply = process.argv.includes("--apply");

const run = async () => {
  await connectDB();

  // Latest non-empty unit per part, from the stock entries.
  const latest = await StockEntry.aggregate([
    { $match: { unit: { $type: "string", $ne: "" } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$part", unit: { $first: "$unit" } } },
  ]);

  const byPart = new Map(latest.map((r) => [String(r._id), String(r.unit).trim()]).filter(([, u]) => u));
  const parts = await Part.find(
    { _id: { $in: [...byPart.keys()] }, $or: [{ unit: "" }, { unit: null }, { unit: { $exists: false } }] },
    "ttUniquePartNumber unit"
  ).lean();

  console.log(`${parts.length} part(s) have no unit but have a unit on a stock entry.\n`);

  let updated = 0;
  for (const p of parts) {
    const unit = byPart.get(String(p._id));
    console.log(`${p.ttUniquePartNumber}  ->  ${unit}`);
    if (apply) {
      // updateOne (not save) so older part documents are never re-validated.
      await Part.updateOne({ _id: p._id }, { $set: { unit } });
      updated += 1;
    }
  }

  console.log(apply ? `\nUpdated ${updated} part(s).` : "\nPreview only — run again with --apply to save these.");
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});