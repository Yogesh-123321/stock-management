/*
  Seeds the vendor list from the real TISPL / PLC vendor registration form
  (backend/src/data/vendors.seed.json), which was extracted from every
  completed registration block in that .docx.

  Usage: npm run seed:vendors

  Every vendor is inserted as status "approved" (they were already
  registered on paper), so they immediately pass the vendor-check step of
  the receiving flow. Re-running is safe — matching is by companyName and
  existing vendors are left alone (their live status/approvals are not
  overwritten).
*/
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Vendor from "../models/Vendor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorsSeed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "vendors.seed.json"), "utf-8")
);

const ALLOWED_NATURE = ["Manufacturer", "Supplier", "Service Provider", "Distributor", "Other"];
const normalizeNature = (v) => (ALLOWED_NATURE.includes(v) ? v : "Other");

// A handful of the source registrations had a blank "Vendor Registration No."
// field on the form itself. Rather than leave that field blank on two+
// vendors (which can collide on a pre-existing unique index — see note
// below), synthesize the same placeholder format the app uses for
// vendors registered through the UI.
const placeholderRegNo = (companyName) =>
  `TISPL/PLC/Vendor/${companyName.replace(/\s+/g, "").toUpperCase()}/SEED-${Date.now()}-${Math.floor(
    Math.random() * 1000
  )}`;

const run = async () => {
  await connectDB();

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const v of vendorsSeed) {
    try {
      const existing = await Vendor.findOne({ companyName: { $regex: `^${escapeRegex(v.companyName)}$`, $options: "i" } });
      if (existing) {
        skipped += 1;
        continue;
      }

      await Vendor.create({
        vendorRegistrationNo: v.vendorRegistrationNo?.trim() || placeholderRegNo(v.companyName),
        companyName: v.companyName,
        address: v.address,
        phone: v.phone,
        email: v.email,
        contactPersonName: v.contactPersonName,
        natureOfCompany: normalizeNature(v.natureOfCompany),
        natureOfBusiness: v.natureOfBusiness,
        taxRegistrationNo: v.taxRegistrationNo,
        bankDetails: v.bankDetails,
        principleCustomers: v.principleCustomers,
        signatoryName: v.signatoryName,
        signatoryDesignation: v.signatoryDesignation,
        status: "approved",
        approvedBy: "Imported from existing vendor registration records",
      });
      created += 1;
    } catch (err) {
      // Never let one bad record abort the whole run (or the parts seed
      // that's chained after this script).
      failed += 1;
      console.warn(`Skipped vendor "${v.companyName}": ${err.message}`);
    }
  }

  console.log(
    `Vendor seed complete. Created: ${created}, already present (skipped): ${skipped}, failed: ${failed}`
  );
  await mongoose.disconnect();
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

run().catch((err) => {
  console.error(err);
  process.exit(1);
});