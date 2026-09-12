/*
  Seeds the predefined part-category list (backend/src/data/partCategories.seed.json)
  into the PartCategory collection.

  Usage: npm run seed:part-categories

  Re-running is safe — matching is by code (case-insensitive) and existing
  categories are left alone, so any description an admin has since edited,
  or any category an admin has added on top of the defaults, is never
  touched or removed by this script.

  `ensureDefaultPartCategories()` is the same logic exposed as a plain
  function (no process.exit / no own DB connection) so it can also be
  called once from server.js on startup — that way a fresh database gets
  the default list automatically, without anyone having to remember to run
  the npm script first.
*/
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import PartCategory from "../models/PartCategory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const categoriesSeed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "partCategories.seed.json"), "utf-8")
);

export async function ensureDefaultPartCategories() {
  for (const { code, description } of categoriesSeed) {
    const exists = await PartCategory.findOne({
      code: { $regex: `^${code}$`, $options: "i" },
    });
    if (!exists) {
      await PartCategory.create({ code, description, addedBy: "seed" });
    }
  }
}

const run = async () => {
  await connectDB();
  await ensureDefaultPartCategories();
  const count = await PartCategory.countDocuments();
  console.log(`Part categories ready — ${count} in the database.`);
  await mongoose.disconnect();
  process.exit(0);
};

// Only auto-run when this file is executed directly (`npm run seed:part-categories`),
// not when ensureDefaultPartCategories is imported elsewhere (e.g. server.js).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error("Seeding part categories failed:", err);
    process.exit(1);
  });
}