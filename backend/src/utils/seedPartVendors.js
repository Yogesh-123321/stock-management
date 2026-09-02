/*
  Backfills Part.vendors for parts that were already in the master database
  before vendor-tracking existed, using the "PARTY NAME" column from
  Vendor_Stock_Management_June_July_2026.xlsx
  (backend/src/data/partVendors.seed.json — 72 TT part number → vendor
  name pairs extracted from that sheet).

  Usage: npm run seed:part-vendors

  For each pair:
    1. Resolve the vendor name to a Vendor document.
       - A handful of the sheet's short-form names are known aliases of a
         vendor already seeded from the formal registration form (e.g.
         "TADASHII" -> "TADASHII ELECTRONICS PVT LTD") — matched via
         VENDOR_ALIASES below.
       - Otherwise matched case-insensitively by exact companyName.
       - If still no match, a new Vendor is created with status "approved"
         (per instruction — these were real, already-transacted vendors,
         just never run through the formal registration form) and only the
         fields we actually have: companyName + a note in `remarks`
         recording where it came from.
    2. addToSet the vendor's _id onto the matching Part's `vendors` array
       (matched by ttUniquePartNumber). No-op if already linked.

  Idempotent — safe to re-run. Existing vendors/parts are never overwritten,
  only the Part.vendors link is added if missing.
*/
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Part from "../models/Part.js";
import Vendor from "../models/Vendor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pairs = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "partVendors.seed.json"), "utf-8")
);

// Short-form names used in the stock sheet that refer to an already-seeded
// vendor (from vendors.seed.json / the formal registration form) under a
// longer/different official name.
const VENDOR_ALIASES = {
  ECLAIRAAS: "ECLAIRAAS AUTOMATION",
  FINEX: "Finex Electronics (India)",
  "LAYBEL NETWORK": "Laybel Networks",
  TADASHII: "TADASHII ELECTRONICS PVT LTD",
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findOrCreateVendor = async (rawName, cache) => {
  const name = rawName.trim();
  const cacheKey = name.toUpperCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const lookupName = VENDOR_ALIASES[name.toUpperCase()] || name;

  let vendor = await Vendor.findOne({
    companyName: { $regex: `^${escapeRegex(lookupName)}$`, $options: "i" },
  });
  let created = false;

  if (!vendor) {
    vendor = await Vendor.create({
      companyName: name,
      natureOfCompany: "Supplier",
      status: "approved",
      approvedBy: "Backfilled from Vendor Stock Management sheet (Jun–Jul 2026)",
      remarks:
        "Auto-created during part-vendor backfill — no formal registration form on file yet. " +
        "Review and fill in full vendor details when convenient.",
    });
    created = true;
  }

  const result = { vendor, created };
  cache.set(cacheKey, result);
  return result;
};

const run = async () => {
  await connectDB();

  const vendorCache = new Map();
  let linked = 0;
  let alreadyLinked = 0;
  let vendorsCreated = 0;
  let partsNotFound = 0;

  for (const { ttUniquePartNumber, vendorName } of pairs) {
    const part = await Part.findOne({ ttUniquePartNumber: ttUniquePartNumber.toUpperCase() });
    if (!part) {
      partsNotFound += 1;
      console.warn(`Part not found, skipped: ${ttUniquePartNumber} (vendor "${vendorName}")`);
      continue;
    }

    const { vendor, created } = await findOrCreateVendor(vendorName, vendorCache);
    if (created) vendorsCreated += 1;

    const already = part.vendors.some((v) => v.equals(vendor._id));
    if (already) {
      alreadyLinked += 1;
      continue;
    }

    part.vendors.addToSet(vendor._id);
    await part.save();
    linked += 1;
  }

  console.log(
    `Part-vendor backfill complete. Links added: ${linked}, already linked: ${alreadyLinked}, ` +
      `new vendors auto-created: ${vendorsCreated}, parts not found: ${partsNotFound}`
  );
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});