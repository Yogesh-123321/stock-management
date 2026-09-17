/*
  FIFO batch allocation for kit issuing.

  Stock itself is still just one aggregate number on Part
  (quantityInStock) — nothing here changes that. What this adds is a way
  to answer "which batch(es) is this quantity actually coming out of?"
  purely by re-reading the existing ledger, the same way the part-history
  "stock movements" screen already does:

    batch received  = sum of applied StockEntry receipts for that batchCode
    batch consumed   = sum of everything already recorded against that
                        batchCode in every issued KitIssue line's own
                        batchBreakdown
    batch remaining  = received - consumed

  Nothing is stored as a running per-batch balance, so there's no separate
  number that can drift out of sync with the ledger — it's recomputed from
  StockEntry + KitIssue every time it's needed, exactly like the ledger
  view on the part-history dialog.
*/
import StockEntry from "../models/StockEntry.js";
import KitIssue from "../models/KitIssue.js";

/**
 * Returns the batches currently holding stock for one part, oldest first
 * (so a FIFO walk always drains the oldest batch before touching the
 * next). Batches with nothing left are omitted entirely.
 *
 * Receipts with no batch code — legacy records from before batch codes
 * existed, or stock that was corrected in by hand rather than through a
 * normal receipt — are grouped into a single `batchCode: null` bucket,
 * sorted by its own earliest receipt like any other batch.
 */
export async function getAvailableBatches(partId) {
  const receipts = await StockEntry.find({ part: partId, stockApplied: true })
    .select("batchCode quantityReceived appliedAt createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const buckets = new Map(); // batchCode ("" for none) -> { received, earliest }
  for (const r of receipts) {
    const code = r.batchCode || "";
    const at = r.appliedAt || r.createdAt;
    const bucket = buckets.get(code) || { received: 0, earliest: at };
    bucket.received += r.quantityReceived;
    if (at && (!bucket.earliest || at < bucket.earliest)) bucket.earliest = at;
    buckets.set(code, bucket);
  }

  // Every issued kit-issue line against this part, so far, contributes to
  // how much of each batch has already gone out. Fetched as full docs
  // (rather than a positional projection) since a single issue can carry
  // more than one line for the same part.
  const issuedDocs = await KitIssue.find({ "lines.part": partId, status: "issued" })
    .select("lines")
    .lean();

  const consumed = new Map(); // batchCode ("" for none) -> qty already issued
  for (const doc of issuedDocs) {
    for (const line of doc.lines || []) {
      if (String(line.part) !== String(partId)) continue;
      for (const b of line.batchBreakdown || []) {
        const code = b.batchCode || "";
        consumed.set(code, (consumed.get(code) || 0) + (b.quantity || 0));
      }
    }
  }

  const batches = [];
  for (const [code, bucket] of buckets.entries()) {
    const remaining = bucket.received - (consumed.get(code) || 0);
    if (remaining > 0.0001) {
      batches.push({ batchCode: code || null, remaining, _earliest: bucket.earliest });
    }
  }
  batches.sort((a, b) => new Date(a._earliest) - new Date(b._earliest));
  return batches.map(({ batchCode, remaining }) => ({ batchCode, remaining }));
}

/**
 * Draws `qty` units out of `batches` (as returned by getAvailableBatches),
 * oldest batch first, mutating each batch's `remaining` in place — so a
 * second call against the same array (e.g. a second kit-issue line for
 * the same part, in the same issue) picks up where the last one left off.
 *
 * Returns the breakdown actually drawn, e.g.
 *   [{ batchCode: "0124", quantity: 10 }, { batchCode: "0224", quantity: 2 }]
 * for "10 from the first batch, then 2 from the next once it ran out".
 *
 * If the batches between them don't cover the full `qty` — stock that was
 * corrected in by hand, outside the normal receiving flow, is the usual
 * cause — the shortfall is returned as a trailing `batchCode: null` line
 * rather than silently dropped, so the breakdown always adds up to `qty`.
 */
export function allocateFromBatches(batches, qty) {
  let remaining = qty;
  const breakdown = [];
  for (const batch of batches || []) {
    if (remaining <= 0) break;
    if (batch.remaining <= 0) continue;
    const take = Math.min(batch.remaining, remaining);
    if (take > 0) {
      breakdown.push({ batchCode: batch.batchCode, quantity: take });
      batch.remaining -= take;
      remaining -= take;
    }
  }
  if (remaining > 0.0001) {
    breakdown.push({ batchCode: null, quantity: remaining });
  }
  return breakdown;
}