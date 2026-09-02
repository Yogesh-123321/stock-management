/*
  Imports parts from a Master Database Excel export into MongoDB.
  Usage: npm run seed:parts -- /path/to/MasterPartDB.xlsx [SheetName]

  Expects columns matching the workbook layout:
  S NO. | TT UNIQUE PART NUMBER | Type of Part | Manufacturer Part Number |
  ITEM DESCRIPTION | COMPANY CODE | CATEGORY | PART TYPE/BATCH NO. | RUNNING SERIAL NO.
*/
import "dotenv/config";
import xlsx from "xlsx";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Part from "../models/Part.js";

const filePath = process.argv[2];
const sheetName = process.argv[3] || "Sheet1";

if (!filePath) {
  console.error("Usage: npm run seed:parts -- /path/to/MasterPartDB.xlsx [SheetName]");
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

  // Header row is row 3 in the workbook (1-indexed), data starts row 5
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, range: 2 });
  const header = rows[0];

  const col = (name) => header.findIndex((h) => (h || "").toString().trim() === name);
  const idx = {
    ttPartNumber: col("TT UNIQUE PART NUMBER"),
    typeOfPart: col("Type of Part"),
    mfrPartNumber: col("Manufacturer Part Number"),
    description: col("ITEM DESCRIPTION"),
    companyCode: col("COMPANY CODE"),
    category: col("CATEGORY"),
    partType: col("PART TYPE/BATCH NO."),
    serial: col("RUNNING SERIAL NO."),
  };

  let created = 0;
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const ttPartNumber = row[idx.ttPartNumber];
    const description = row[idx.description];
    if (!ttPartNumber || !description) continue;

    const doc = {
      ttUniquePartNumber: String(ttPartNumber).trim().toUpperCase(),
      typeOfPart: row[idx.typeOfPart] ? String(row[idx.typeOfPart]).trim() : undefined,
      manufacturerPartNumber: row[idx.mfrPartNumber] ? String(row[idx.mfrPartNumber]).trim() : undefined,
      itemDescription: String(description).trim(),
      companyCode: row[idx.companyCode] ? String(row[idx.companyCode]).trim().toUpperCase() : "TT",
      category: row[idx.category] ? String(row[idx.category]).trim().toUpperCase() : "NA",
      partTypeBatchNo: row[idx.partType] ? String(row[idx.partType]).trim().toUpperCase() : "NA",
      runningSerialNo: row[idx.serial] ? String(row[idx.serial]).trim() : "001",
    };

    try {
      await Part.updateOne(
        { ttUniquePartNumber: doc.ttUniquePartNumber },
        { $setOnInsert: doc },
        { upsert: true }
      );
      created += 1;
    } catch (err) {
      skipped += 1;
      console.warn(`Skipped ${doc.ttUniquePartNumber}: ${err.message}`);
    }
  }

  console.log(`Import complete. Upserted: ${created}, skipped: ${skipped}`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
