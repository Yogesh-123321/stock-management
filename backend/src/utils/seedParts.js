/*
  Seeds the parts master from the real Master Part Database
  (backend/src/data/parts.seed.json), extracted and merged from both the
  "Sheet1" (general parts) and "Vats" (mechanical/connector parts) tabs of
  MasterPartDB.xlsx, de-duplicated by TT unique part number — 361 parts.

  Usage: npm run seed:parts

  Re-running is safe: existing part numbers are left untouched (their live
  quantityInStock and alternate-part links are not overwritten). Only
  missing part numbers are inserted, each starting at quantityInStock: 0.

  To import a different/updated workbook later, use
  seedPartsFromExcel.js instead (npm run seed:parts:xlsx -- <path> [sheet]).
*/
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Part from "../models/Part.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const partsSeed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "parts.seed.json"), "utf-8")
);

const run = async () => {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const p of partsSeed) {
    try {
      const res = await Part.updateOne(
        { ttUniquePartNumber: p.ttUniquePartNumber },
        { $setOnInsert: { ...p, quantityInStock: 0 } },
        { upsert: true }
      );
      if (res.upsertedCount > 0) created += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      console.warn(`Skipped ${p.ttUniquePartNumber}: ${err.message}`);
    }
  }

  console.log(`Parts seed complete. Created: ${created}, already present (skipped): ${skipped}`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
