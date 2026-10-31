/*
  Backfill seededStock WITHOUT the original stock workbook.

  Reads a "Stock summary" Excel report downloaded from this app, takes the
  parts marked MISMATCH, and treats the extra stock the ledger cannot explain
  as that part's seeded (already-in-store) quantity.

  The report is only used to choose WHICH parts to fix. The amount is
  recomputed from the live database when the script runs, so a slightly old
  report is fine:
    gap = (main + R&D) - (applied inward - kits) - current seededStock
  Only positive gaps (extra stock) are turned into seeded stock. Parts whose
  stock is LOWER than the entries explain are listed and left alone — seeded
  stock cannot fix those.

  Every positive gap is assumed to be seeded stock. If some gaps are really
  manual corrections, either delete those rows from a copy of the report first,
  or use --min to ignore small gaps.

  Usage (dry run — prints the plan, writes nothing):
    cd backend
    npm run backfill:seeded-from-report -- "C:\path\to\stock-summary.xlsx"
    npm run backfill:seeded-from-report -- "C:\path\to\stock-summary.xlsx" --min 10

  Write the changes:
    npm run backfill:seeded-from-report -- "C:\path\to\stock-summary.xlsx" --apply
*/
import "dotenv/config";
import xlsx from "xlsx";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Part from "../models/Part.js";
import { ledgerFor, r3 } from "./seededStock.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const minIdx = args.indexOf("--min");
const minGap = minIdx !== -1 ? Number(args[minIdx + 1]) || 0 : 0;
const filePath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--min");

if (!filePath) {
  console.error('Usage: npm run backfill:seeded-from-report -- "C:\\path\\to\\stock-summary.xlsx" [--min N] [--apply]');
  process.exit(1);
}

const run = async () => {
  await connectDB();

  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets["Stock summary"] || wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
  const header = rows[0] || [];
  const col = (name) => header.findIndex((h) => String(h || "").trim() === name);
  const idx = { code: col("TT part number"), status: col("Stock check") };
  if (idx.code === -1 || idx.status === -1) {
    console.error('This is not a Stock summary report (need "TT part number" and "Stock check" columns). Found:', header);
    process.exit(1);
  }

  const toSeed = [];
  const lower = [];
  const skippedSmall = [];
  const noGap = [];
  let notFound = 0;

  for (const row of rows.slice(1)) {
    if (String(row[idx.status] || "").trim() !== "MISMATCH") continue;
    const code = String(row[idx.code] || "").trim().toUpperCase();
    if (!code || code === "TOTAL") continue;

    const part = await Part.findOne({ ttUniquePartNumber: code });
    if (!part) {
      notFound += 1;
      continue;
    }

    const { appliedIn, kits } = await ledgerFor(part);
    const gap = r3((part.quantityInStock || 0) + (part.rndStock || 0) - (appliedIn - kits) - (part.seededStock || 0));

    if (Math.abs(gap) <= 0.0005) noGap.push(code);
    else if (gap < 0) lower.push({ code, gap });
    else if (gap < minGap) skippedSmall.push({ code, gap });
    else toSeed.push({ part, code, gap, newSeeded: r3((part.seededStock || 0) + gap) });
  }

  for (const t of toSeed) {
    console.log(`${apply ? "SET      " : "WOULD SET"} ${t.code}: seededStock ${t.part.seededStock || 0} -> ${t.newSeeded}  (+${t.gap})`);
    if (apply) {
      t.part.seededStock = t.newSeeded;
      await t.part.save();
    }
  }

  console.log(`\n${apply ? "Backfill applied" : "DRY RUN — nothing written (add --apply to write)"}.`);
  console.log(`  Parts ${apply ? "updated" : "to update"}:                 ${toSeed.length}`);
  console.log(`  Skipped, gap below --min ${minGap}:   ${skippedSmall.length}`);
  console.log(`  Already fine in the database:      ${noGap.length}`);
  console.log(`  Not found in the database:         ${notFound}`);
  if (skippedSmall.length) {
    console.log(`\nSmall gaps left alone:`);
    skippedSmall.forEach((p) => console.log(`  - ${p.code}: +${p.gap}`));
  }
  if (lower.length) {
    console.log(`\n${lower.length} part(s) have LESS stock than the entries explain — seeded stock cannot fix these:`);
    lower.forEach((p) => console.log(`  - ${p.code}: ${p.gap}`));
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});