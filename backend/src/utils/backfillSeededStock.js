/*
  One-off backfill for parts that were loaded from the stock workbook
  BEFORE the seededStock field existed.

  The workbook import overwrote quantityInStock and kept no record of how
  much was "already in the store", so the Stock report flags those parts as
  mismatches (stock with no inward entry). This re-reads the same workbook
  and records each part's "Total Closing Stock" as its seeded quantity.

  Usage (dry run — prints what would change, writes nothing):
    cd backend
    npm run backfill:seeded-stock -- /path/to/Vendor_Stock_Management.xlsx [SheetName]

  Write the changes:
    npm run backfill:seeded-stock -- /path/to/Vendor_Stock_Management.xlsx [SheetName] --apply

  Parts that already have a non-zero seededStock are skipped. quantityInStock
  is never changed by this script. After running, the Stock report should show
  OK for the parts the seeded quantity explains; any part still listed as
  "still mismatched" below has some other cause (manual adjustment, etc.).
*/
import "dotenv/config";
import xlsx from "xlsx";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Part from "../models/Part.js";
import { ledgerFor, r3 } from "./seededStock.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [filePath, sheetArg] = args.filter((a) => !a.startsWith("--"));
const sheetName = sheetArg || "Sheet1";
const HEADER_ROW_INDEX = 5; // 0-indexed; workbook row 6 (same as updateStockFromWorkbook.js)

if (!filePath) {
  console.error("Usage: npm run backfill:seeded-stock -- /path/to/Vendor_Stock_Management.xlsx [SheetName] [--apply]");
  process.exit(1);
}

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
  const idx = { code: col("TTZ Item Code"), qty: col("Total Closing Stock") };
  if (idx.code === -1 || idx.qty === -1) {
    console.error("Could not find expected columns. Found headers:", header);
    process.exit(1);
  }

  let toSet = 0;
  let alreadySet = 0;
  let notFound = 0;
  const stillMismatched = [];

  for (const row of rows.slice(1)) {
    const rawCode = row[idx.code];
    const qtyRaw = row[idx.qty];
    if (!rawCode || typeof qtyRaw !== "number") continue;
    const code = String(rawCode).trim().toUpperCase().split(/[\n/]/)[0].trim();
    if (!code) continue;

    const part = await Part.findOne({ ttUniquePartNumber: code });
    if (!part) {
      notFound += 1;
      continue;
    }
    if ((part.seededStock || 0) !== 0) {
      alreadySet += 1;
      continue;
    }

    const seeded = Math.max(0, Math.round(qtyRaw));
    if (seeded === 0) continue;

    // Total difference = (main + R&D) - (applied inward - kits) - seeded.
    const { appliedIn, kits } = await ledgerFor(part);
    const diffAfter = r3((part.quantityInStock || 0) + (part.rndStock || 0) - (appliedIn - kits) - seeded);

    toSet += 1;
    if (Math.abs(diffAfter) > 0.0005) stillMismatched.push({ code, seeded, diffAfter });
    console.log(`${apply ? "SET " : "WOULD SET"} ${code}: seededStock = ${seeded}`);
    if (apply) {
      part.seededStock = seeded;
      await part.save();
    }
  }

  console.log(`\n${apply ? "Backfill applied" : "DRY RUN — nothing written (add --apply to write)"}.`);
  console.log(`  Parts ${apply ? "updated" : "to update"}:       ${toSet}`);
  console.log(`  Already had seeded qty:   ${alreadySet}`);
  console.log(`  Not found in the DB:      ${notFound}`);
  if (stillMismatched.length) {
    console.log(`\n${stillMismatched.length} part(s) would STILL be mismatched after seeding (other cause):`);
    stillMismatched.forEach((p) => console.log(`  - ${p.code}: seeded ${p.seeded}, remaining difference ${p.diffAfter}`));
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});