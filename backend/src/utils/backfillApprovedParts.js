/*
  One-time backfill: creates the Part record for any part-approval request
  that was already approved (or approved-then-consumed) BEFORE the fix that
  makes approveRequest create the Part immediately. Those older requests
  have status "approved"/"consumed" but createdPart: null — their part
  number was never written to the `parts` collection, so it shows up in the
  "approved" list in Receive Material (which reads PartApprovalRequest) but
  never appears in the Parts master table (which reads the `parts`
  collection) until/unless someone eventually books stock against it.

  This script finds exactly those requests and creates the missing Part for
  each one, the same way approveRequest does now, then links it back via
  createdPart so nothing gets created twice later.

  Usage:
    cd backend
    node src/utils/backfillApprovedParts.js
*/
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import PartApprovalRequest from "../models/PartApprovalRequest.js";
import Part from "../models/Part.js";
import { createPartFromApprovedRequest } from "./stockBooking.js";

const run = async () => {
  await connectDB();

  const requests = await PartApprovalRequest.find({
    status: { $in: ["approved", "consumed"] },
    requestType: { $in: ["new_part_number", "alternate_part"] },
    createdPart: null,
  });

  console.log(`Found ${requests.length} approved request(s) with no part in the master yet.\n`);

  let created = 0;
  let linked = 0;
  const failed = [];

  for (const doc of requests) {
    const label =
      [doc.newPart?.itemDescription, doc.newPart?.manufacturerPartNumber].filter(Boolean).join(" · ") ||
      doc._id.toString();
    try {
      // Some of these old requests turn out to correspond to a part number
      // that already exists in the master — e.g. another approved request
      // for the same company code/category/batch no. was already backfilled
      // (in this run or a previous one), or the part was created some other
      // way in the meantime. Creating it again would either violate the
      // unique index or (worse) mint a second Part for the same number.
      // Check first and just link the request to the existing part instead
      // of trying to create a duplicate.
      const { companyCode, category, partTypeBatchNo } = doc.newPart || {};
      const ttUniquePartNumber =
        companyCode && category && partTypeBatchNo
          ? `${companyCode}${category}${partTypeBatchNo}`.toUpperCase()
          : null;

      const existingPart = ttUniquePartNumber ? await Part.findOne({ ttUniquePartNumber }) : null;

      if (existingPart) {
        doc.createdPart = existingPart._id;
        await doc.save();
        console.log(`  ${existingPart.ttUniquePartNumber} already exists — linked "${label}" to it instead of creating a duplicate`);
        linked += 1;
        continue;
      }

      const partDoc = await createPartFromApprovedRequest(doc);
      doc.createdPart = partDoc._id;
      await doc.save();
      console.log(`  Created ${partDoc.ttUniquePartNumber} for "${label}"`);
      created += 1;
    } catch (err) {
      console.error(`  Skipped "${label}": ${err.message}`);
      failed.push({ id: doc._id.toString(), label, message: err.message });
    }
  }

  console.log(`\nDone. Created ${created} part(s). Linked ${linked} to an existing part. ${failed.length} skipped.`);
  if (failed.length) {
    console.log("\nSkipped requests (fix these manually — usually a genuine part-number clash):");
    failed.forEach((f) => console.log(`  - ${f.label} (${f.id}): ${f.message}`));
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});