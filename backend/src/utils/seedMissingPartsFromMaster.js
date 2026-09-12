/*
  Seeds ONLY the parts from the Master Database Excel file that are not
  already in MongoDB — every part already present is left completely
  untouched (never updated, never overwritten), matched strictly by
  TT UNIQUE PART NUMBER (nothing else — not description, not manufacturer
  part number).

  Usage:
    npm run seed:parts:missing -- /path/to/MasterPartDB.xlsx [SheetName]

  SheetName defaults to "Sheet1" (the workbook's "Master Database" tab).
  If your file has more than one sheet with real part data (e.g. this
  file also has a "Vats" tab), run the script again with that sheet name
  to seed it separately — it's deliberately NOT auto-included, since
  that tab in the current file has the same TT number repeated with
  different descriptions on more than one row, which looks like a
  scratch/working sheet rather than the master list.

  Expects the same column layout as the existing seed:parts:xlsx import
  (S NO. | TT UNIQUE PART NUMBER | Type of Part | Manufacturer Part
  Number | ITEM DESCRIPTION | COMPANY CODE | CATEGORY | PART TYPE/BATCH
  NO. | RUNNING SERIAL NO.), header on row 3.

  Why this is a separate script from seedPartsFromExcel.js:
  that one silently upserts with a placeholder-free doc and miscounts
  "created" even for rows that already existed. This one instead:
    - never touches an existing TT part number at all (no $setOnInsert
      upsert — an explicit findOne check first, so there is no risk of
      ever quietly overwriting a field on a part someone has since
      edited on the website)
    - never silently drops a row just because one field is blank in the
      sheet — a part is still created, with a clearly-labelled
      placeholder standing in for whatever was missing, so the part
      itself is never missing from the website even if some of its
      information is
    - ends with a full, explicit report: how many already existed, how
      many were newly seeded, which of those needed a placeholder (and
      for which field), which rows couldn't be identified at all
      (no TT number to match on), and which rows share a TT number with
      an earlier row in the same file
*/
import "dotenv/config";
import xlsx from "xlsx";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Part from "../models/Part.js";

const filePath = process.argv[2];
const sheetName = process.argv[3] || "Sheet1";

// Used for any required Part field that's simply blank in the source
// sheet. Deliberately obvious rather than a guess dressed up as real
// data — the point is that it never overwrites, but also never
// pretends something exists that doesn't.
const MISSING = "UNSPECIFIED — check master DB";

if (!filePath) {
  console.error("Usage: npm run seed:parts:missing -- /path/to/MasterPartDB.xlsx [SheetName]");
  process.exit(1);
}

const clean = (v) => (v === undefined || v === null ? "" : String(v).trim());

const run = async () => {
  await connectDB();

  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error(`Sheet "${sheetName}" not found. Available: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }

  // Header row is row 3 in the workbook (1-indexed); data starts row 5.
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, range: 2 });
  const header = rows[0];
  const col = (name) => header.findIndex((h) => clean(h) === name);
  const idx = {
    sNo: col("S NO."),
    ttPartNumber: col("TT UNIQUE PART NUMBER"),
    typeOfPart: col("Type of Part"),
    mfrPartNumber: col("Manufacturer Part Number"),
    description: col("ITEM DESCRIPTION"),
    companyCode: col("COMPANY CODE"),
    category: col("CATEGORY"),
    partType: col("PART TYPE/BATCH NO."),
    serial: col("RUNNING SERIAL NO."),
  };

  const seenInFile = new Map(); // ttUniquePartNumber -> S NO. of the row that "won"
  const noTtNumber = []; // rows we can't match/identify at all
  const duplicateInFile = []; // same TT number appears more than once in the sheet
  const alreadyInDb = []; // left completely untouched
  const newlySeeded = []; // { ttUniquePartNumber, sNo }
  const seededWithPlaceholders = []; // { ttUniquePartNumber, sNo, fields: [...] }
  const failedInserts = []; // { ttUniquePartNumber, sNo, reason }

  for (const row of rows.slice(1)) {
    const sNo = idx.sNo >= 0 ? clean(row[idx.sNo]) : "";
    const rawTt = clean(row[idx.ttPartNumber]);

    if (!rawTt) {
      // The workbook has a sub-header row under the real header ("PART 1
      // (FIXED)" / "PART 2 (PREDEFINED LIST ONLY)" ...) with no S No., no
      // TT number and no description at all — that's formatting, not a
      // part that went missing, so it's skipped quietly rather than
      // reported as a problem. A row that has SOME data (an S No. and/or
      // a description) but no TT number is a real gap worth flagging.
      const description = clean(row[idx.description]);
      if (sNo || description) {
        noTtNumber.push({ sNo, description });
      }
      continue;
    }

    const ttUniquePartNumber = rawTt.toUpperCase();

    if (seenInFile.has(ttUniquePartNumber)) {
      duplicateInFile.push({ sNo, ttUniquePartNumber, keptSNo: seenInFile.get(ttUniquePartNumber) });
      continue;
    }
    seenInFile.set(ttUniquePartNumber, sNo);

    // Match strictly by TT UNIQUE PART NUMBER, as instructed — nothing
    // else about this row is used to decide whether it already exists.
    const existing = await Part.findOne({ ttUniquePartNumber }).select("_id");
    if (existing) {
      alreadyInDb.push(ttUniquePartNumber);
      continue;
    }

    const placeholderFields = [];
    const withPlaceholder = (value, fieldLabel) => {
      const v = clean(value);
      if (v) return v;
      placeholderFields.push(fieldLabel);
      return MISSING;
    };

    const description = withPlaceholder(row[idx.description], "Item description");
    const companyCode = withPlaceholder(row[idx.companyCode], "Company code").toUpperCase();
    const category = withPlaceholder(row[idx.category], "Category").toUpperCase();
    const partTypeBatchNo = withPlaceholder(row[idx.partType], "Part type / batch no.").toUpperCase();

    // Genuinely optional fields on the Part model — left blank rather
    // than placeholder'd, exactly as asked ("leave it blank on the
    // website too").
    const typeOfPart = clean(row[idx.typeOfPart]);
    const manufacturerPartNumber = clean(row[idx.mfrPartNumber]);
    const runningSerialNo = clean(row[idx.serial]);

    const doc = {
      ttUniquePartNumber,
      itemDescription: description,
      companyCode,
      category,
      partTypeBatchNo,
      ...(typeOfPart && { typeOfPart }),
      ...(manufacturerPartNumber && { manufacturerPartNumber }),
      ...(runningSerialNo && { runningSerialNo }),
    };

    try {
      await Part.create(doc);
      newlySeeded.push({ sNo, ttUniquePartNumber });
      if (placeholderFields.length) {
        seededWithPlaceholders.push({ sNo, ttUniquePartNumber, fields: placeholderFields });
      }
    } catch (err) {
      failedInserts.push({ sNo, ttUniquePartNumber, reason: err.message });
    }
  }

  console.log("\n=== Master DB seed — missing parts only ===");
  console.log(`Source rows read: ${rows.length - 1}`);
  console.log(`Already in the database (left untouched): ${alreadyInDb.length}`);
  console.log(`Newly seeded: ${newlySeeded.length}`);

  if (seededWithPlaceholders.length) {
    console.log(
      `\n⚠ ${seededWithPlaceholders.length} newly-seeded part(s) had missing data in the master DB — ` +
        `the part was still added, but the field(s) below were filled with "${MISSING}" so nothing was ` +
        `invented. Fix these from the Parts admin edit screen when you get a chance:`
    );
    seededWithPlaceholders.forEach((p) =>
      console.log(`   S.No ${p.sNo || "?"} — ${p.ttUniquePartNumber}: ${p.fields.join(", ")}`)
    );
  }

  if (duplicateInFile.length) {
    console.log(
      `\n⚠ ${duplicateInFile.length} row(s) in the source sheet reuse a TT number already seen earlier ` +
        `in the same file — only the first occurrence of each was considered, these were skipped:`
    );
    duplicateInFile.forEach((d) =>
      console.log(`   S.No ${d.sNo || "?"} — ${d.ttUniquePartNumber} (kept S.No ${d.keptSNo || "?"} instead)`)
    );
  }

  if (noTtNumber.length) {
    console.log(
      `\n⚠ ${noTtNumber.length} row(s) had no TT UNIQUE PART NUMBER at all, so there was nothing to ` +
        `match or seed them by — they were skipped entirely:`
    );
    noTtNumber.forEach((n) => console.log(`   S.No ${n.sNo || "?"} — "${n.description || "(no description either)"}"`));
  }

  if (failedInserts.length) {
    console.log(`\n✗ ${failedInserts.length} row(s) failed to insert:`);
    failedInserts.forEach((f) => console.log(`   S.No ${f.sNo || "?"} — ${f.ttUniquePartNumber}: ${f.reason}`));
  }

  console.log("\nDone.\n");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});