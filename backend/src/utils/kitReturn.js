/*
  Shared maths for "inward stock against an issued kit" (Receive material).

  A kit issue says how much of each part went out to the vendor
  (KitIssue.lines[].qtyIssued). Unused parts coming back are booked as
  StockEntry lines with kitLink.kind = "returned", and each such line records
  in kitLink.allocations how much of WHICH kit's issued quantity it uses up.
  Returned-so-far is therefore always re-read from those lines, never kept as
  a running number that could drift.
*/
import StockEntry from "../models/StockEntry.js";

export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const keyOf = (kit, part) => `${kit}|${part}`;

/** How much of each part has already come back per kit: Map("kit|part" -> qty). */
export async function returnedMap(kitIssueIds, excludeEntryId = null) {
  const ids = (kitIssueIds || []).map(String);
  const map = new Map();
  if (!ids.length) return map;

  const q = { "kitLink.kind": "returned", "kitLink.allocations.kitIssue": { $in: ids } };
  if (excludeEntryId) q._id = { $ne: excludeEntryId };
  const entries = await StockEntry.find(q).select("part quantityReceived kitLink.allocations").lean();

  for (const e of entries) {
    const allocs = e.kitLink?.allocations || [];
    const total = allocs.reduce((s, a) => s + (a.quantity || 0), 0);
    if (total <= 0) continue;
    // An IQC partial approval splits a line in two and copies the allocations to
    // both halves; scaling by the line's own quantity keeps the total correct.
    // Rejected-in-IQC parts still physically came back, so they stay counted.
    const scale = Math.min(1, (e.quantityReceived || 0) / total);
    for (const a of allocs) {
      const k = keyOf(a.kitIssue, e.part);
      map.set(k, (map.get(k) || 0) + (a.quantity || 0) * scale);
    }
  }
  return map;
}

/** Quantity of `partId` that went out in one kit issue (lean doc). */
export function issuedQty(kit, partId) {
  return (kit.lines || []).reduce(
    (s, l) => (l.part && String(l.part._id || l.part) === String(partId) ? s + (l.qtyIssued || 0) : s),
    0
  );
}

/**
 * Splits `qty` of one part across the given kit issues (oldest first), never
 * exceeding what each issued less what already came back. Throws a 400-style
 * error when the kits together can't take that much.
 * Returns [{ kitIssue, quantity }].
 */
export async function allocateReturn({ partId, kitIssues, qty, excludeEntryId = null }) {
  const returned = await returnedMap(
    kitIssues.map((k) => k._id),
    excludeEntryId
  );
  let left = round3(qty);
  let capacity = 0;
  const allocations = [];
  for (const kit of kitIssues) {
    const remaining = Math.max(0, round3(issuedQty(kit, partId) - (returned.get(keyOf(kit._id, partId)) || 0)));
    capacity += remaining;
    const take = Math.min(remaining, left);
    if (take > 0) {
      allocations.push({ kitIssue: kit._id, quantity: round3(take) });
      left = round3(left - take);
    }
  }
  if (left > 0.0005) {
    const err = new Error(
      capacity > 0
        ? `Only ${round3(capacity)} of this part can still be returned against the selected kit(s).`
        : "Nothing of this part is left to return against the selected kit(s)."
    );
    err.status = 400;
    throw err;
  }
  return allocations;
}
