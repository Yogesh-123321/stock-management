/*
  Updates the Parts collection from a "Vendor Stock Management" workbook
  (the monthly stock-tracking sheet, distinct from the original
  MasterPartDB.xlsx import in seedPartsFromExcel.js).

  For every data row it:
    1. Reads the part number ("TTZ Item Code") and the current quantity
       ("Total Closing Stock" — the rightmost, most up-to-date running total
       on the sheet).
    2. MATCH — if that part number already exists in the DB, sets its
       quantityInStock to the sheet's value (this sheet is treated as the
       authoritative current count, so it overwrites rather than adds).
    3. NEW, CODED — if the row has a part number but it isn't in the DB yet,
       creates it. companyCode/category/partTypeBatchNo/runningSerialNo are
       parsed from the code itself (see splitPartNumber below) so the part
       fits the existing TT<category><type><serial> convention.
    4. NEW, UNCODED — a handful of rows on this particular sheet have no
       part number at all. Those are matched by (normalized) description
       against NO_CODE_PART_DEFAULTS below, which supplies a category +
       part type, and a proper TT part number is generated via the same
       generateNextPartNumber() used by the receiving-flow "new part" step.
       Rows with no code AND no entry in that map are skipped with a
       warning — nothing is silently guessed.

  Usage:
    cd backend
    npm run update:stock -- /path/to/Vendor_Stock_Management.xlsx [SheetName]

  Defaults (SheetName="Sheet1", header row = workbook row 6) match the
  June/July 2026 sheet. Pass a different sheet name if a future month's
  workbook uses one; if the header row ever moves, adjust HEADER_ROW_INDEX
  below (0-indexed) accordingly.
*/
import "dotenv/config";
import xlsx from "xlsx";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Part from "../models/Part.js";
import { generateNextPartNumber } from "./generatePartNumber.js";

const filePath = process.argv[2];
const sheetName = process.argv[3] || "Sheet1";
const HEADER_ROW_INDEX = 5; // 0-indexed; workbook row 6

if (!filePath) {
  console.error("Usage: npm run update:stock -- /path/to/Vendor_Stock_Management.xlsx [SheetName]");
  process.exit(1);
}

// Hand-picked category / part-type for the rows on this sheet that have no
// part number at all. Keyed by the item description, normalized (trimmed,
// collapsed whitespace, lower-cased). companyCode is always "TT" per
// convention. Extend this map if a future sheet has new uncoded rows —
// anything not listed here is skipped, not guessed.
const NO_CODE_PART_DEFAULTS = {
  "imoni cpu sub assy rev 1.01": { category: "MS", partTypeBatchNo: "CPUSA" },
  "imoni base sub assy rev 1.03": { category: "MS", partTypeBatchNo: "BASESA" },
  "sinoseen camera harness": { category: "WH", partTypeBatchNo: "SINOH" },
  "ldr harness": { category: "WH", partTypeBatchNo: "LDRH" },
  "ferool lugs (1sqmm)": { category: "CN", partTypeBatchNo: "FLUG1" },
  "o lug (6sqmm)": { category: "CN", partTypeBatchNo: "OLUG6" },
  "shrink tube 6mm": { category: "MS", partTypeBatchNo: "SHRT6" },
  "shrink tube 4mm": { category: "MS", partTypeBatchNo: "SHRT4" },
  "header, 5x2, 2,54mm, vr, th, height 5.84mm/2.54mm - shunt fitted 1-2": {
    category: "CN",
    partTypeBatchNo: "HDR52",
  },
  "header, 3x1, 2,54mm, vr, th, height 5.84mm/2.54mm - shunt fitted 1-2 by default": {
    category: "CN",
    partTypeBatchNo: "HDR31",
  },
  "3.3uh(30mohm)": { category: "LS", partTypeBatchNo: "IND33" },
  "esp32-s3-wroom-1-n16r8": { category: "IC", partTypeBatchNo: "ESP32" },
  "ap62300twu-7": { category: "IC", partTypeBatchNo: "AP623" },
  "tlv75528pdbvr": { category: "IC", partTypeBatchNo: "TLV28" },
  "tlv75515pdbvr": { category: "IC", partTypeBatchNo: "TLV15" },
  "ov5640 camera": { category: "SY", partTypeBatchNo: "OV564" },
  "imoni cam camera pcb_ rev 0.3": { category: "PCB", partTypeBatchNo: "CAMPC" },
  "imonicam assy 1.03": { category: "MS", partTypeBatchNo: "CAMAS" },
  "fragile sticker for box": { category: "MS", partTypeBatchNo: "STICK" },
};

const normalizeDesc = (d) => String(d || "").trim().replace(/\s+/g, " ").toLowerCase();

// Cleans up stray whitespace/slashes some cells on this sheet have
// (e.g. "TTSEWLO001/ \nTTSEWLE001" for a merged cell) and upper-cases.
const normalizeCode = (c) =>
  String(c)
    .trim()
    .toUpperCase();

// Best-effort split of an existing "TT<category><type><serial>" code into
// its parts, for codes found on the sheet that aren't in the DB yet.
// companyCode is always "TT". category is the next 2 letters. The
// remainder's trailing digit run becomes runningSerialNo; whatever's left
// before that becomes partTypeBatchNo. This mirrors the convention closely
// enough for the auto-increment logic to keep working for this family
// going forward — it does not need to byte-match how older codes were
// historically split, since lookups match on the full code, not the split.
const splitPartNumber = (code) => {
  const rest = code.slice(2); // after "TT"
  const category = rest.slice(0, 2) || "MS";
  const remainder = rest.slice(2);
  const match = remainder.match(/^(.*?)(\d+)$/);
  const partTypeBatchNo = (match ? match[1] : remainder) || "GEN";
  const runningSerialNo = match ? match[2] : "001";
  return { companyCode: "TT", category, partTypeBatchNo, runningSerialNo };
};

const run = async () => {
  await connectDB();

  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error(`Sheet "${sheetName}" not found. Available: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }

  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, range: HEADER_ROW_INDEX });
  const header = rows[0];
  const col = (name) => header.findIndex((h) => (h || "").toString().trim() === name);

  const idx = {
    code: col("TTZ Item Code"),
    description: col("Item Description"),
    totalClosingStock: col("Total Closing Stock"),
  };

  if (idx.code === -1 || idx.description === -1 || idx.totalClosingStock === -1) {
    console.error("Could not find expected columns. Found headers:", header);
    process.exit(1);
  }

  let updated = 0;
  let createdFromCode = 0;
  let createdFromDescription = 0;
  let skippedNoMapping = [];

  for (const row of rows.slice(1)) {
    const rawCode = row[idx.code];
    const description = row[idx.description];
    if (!description && !rawCode) continue; // fully blank row

    const closingStockRaw = row[idx.totalClosingStock];
    const quantityInStock =
      typeof closingStockRaw === "number" ? Math.max(0, Math.round(closingStockRaw)) : 0;

    if (rawCode) {
      const ttUniquePartNumber = normalizeCode(rawCode);
      // A couple of cells on this sheet contain two codes separated by a
      // newline (a merged-cell artifact) — only the first is authoritative
      // for this row.
      const firstCode = ttUniquePartNumber.split(/[\n/]/)[0].trim();
      if (!firstCode) continue;

      const existing = await Part.findOne({ ttUniquePartNumber: firstCode });
      if (existing) {
        existing.quantityInStock = quantityInStock;
        await existing.save();
        updated += 1;
      } else {
        const parsed = splitPartNumber(firstCode);
        await Part.create({
          ttUniquePartNumber: firstCode,
          ...parsed,
          itemDescription: description ? String(description).trim() : firstCode,
          quantityInStock,
        });
        createdFromCode += 1;
      }
    } else {
      const key = normalizeDesc(description);
      const mapping = NO_CODE_PART_DEFAULTS[key];
      if (!mapping) {
        skippedNoMapping.push(description);
        continue;
      }
      const { ttUniquePartNumber, runningSerialNo } = await generateNextPartNumber(
        "TT",
        mapping.category,
        mapping.partTypeBatchNo
      );
      await Part.create({
        ttUniquePartNumber,
        runningSerialNo,
        companyCode: "TT",
        category: mapping.category,
        partTypeBatchNo: mapping.partTypeBatchNo,
        itemDescription: String(description).trim(),
        quantityInStock,
      });
      createdFromDescription += 1;
    }
  }

  console.log(`\nStock update complete.`);
  console.log(`  Existing parts updated:        ${updated}`);
  console.log(`  New parts created (had a code): ${createdFromCode}`);
  console.log(`  New parts created (no code):    ${createdFromDescription}`);
  if (skippedNoMapping.length) {
    console.log(`  Skipped (no code, no mapping):  ${skippedNoMapping.length}`);
    skippedNoMapping.forEach((d) => console.log(`    - ${d}`));
    console.log(`  Add these to NO_CODE_PART_DEFAULTS in this script to include them.`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});