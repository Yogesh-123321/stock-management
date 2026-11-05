/*
  Who is currently holding issued samples?

  Part.sampleStock is just the total. This re-reads the SampleIssue ledger to
  answer "which buyer holds how much of this part, under which issue?" — the
  same approach batchAllocation.js takes, so nothing is stored twice.
*/
import mongoose from "mongoose";
import SampleIssue from "../models/SampleIssue.js";

/**
 * Map(partId -> [{ issueId, issueCode, buyer, buyerName, quantity, issuedAt }])
 * of samples still outstanding. Pass `partIds` to limit it, or omit for all.
 */
export async function sampleHoldersByPart(partIds = null) {
  const match = { status: { $in: ["issued", "partially_returned"] } };
  const lineMatch = { "lines.qtyOutstanding": { $gt: 0.0005 } };
  if (Array.isArray(partIds)) {
    if (!partIds.length) return new Map();
    lineMatch["lines.part"] = { $in: partIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  }

  const rows = await SampleIssue.aggregate([
    { $match: match },
    { $unwind: "$lines" },
    { $match: lineMatch },
    {
      $project: {
        part: "$lines.part",
        issueId: "$_id",
        issueCode: 1,
        buyer: 1,
        buyerName: 1,
        quantity: "$lines.qtyOutstanding",
        issuedAt: "$createdAt",
      },
    },
    { $sort: { issuedAt: -1 } },
  ]);

  const map = new Map();
  for (const r of rows) {
    const k = String(r.part);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({
      issueId: r.issueId,
      issueCode: r.issueCode,
      buyer: r.buyer,
      buyerName: r.buyerName,
      quantity: r.quantity,
      issuedAt: r.issuedAt,
    });
  }
  return map;
}