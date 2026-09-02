import api from "@/lib/api";

/*
  Total quantity ALREADY booked into stock against a delivery's PO/PI.

  A delivery can be received in parts across several days (e.g. 10 pcs today
  against a PO of 12, the remaining 2 next week against the same open PO).
  Every stock entry is stored against the PO/PI id, so the cumulative received
  quantity is simply the sum of all entries for the documents of the delivery.

  Both the PO and the PI of the same delivery are passed in; entries are
  de-duplicated by their own _id so an entry linked to both is counted once.
*/
export async function fetchReceivedTotal(docs = []) {
  const ids = docs
    .map((d) => (typeof d === "string" ? d : d?._id))
    .filter(Boolean)
    .filter((id, i, arr) => arr.indexOf(id) === i);

  if (ids.length === 0) return { total: 0, entries: [] };

  const results = await Promise.all(
    ids.map((id) =>
      api
        .get("/stock-entries", { params: { purchaseOrder: id } })
        .then((r) => r.data || [])
        .catch(() => [])
    )
  );

  const seen = new Set();
  const entries = [];
  for (const list of results) {
    for (const e of list) {
      const key = String(e._id);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(e);
    }
  }

  const total = entries.reduce((sum, e) => sum + Number(e.quantityReceived || 0), 0);
  return { total, entries };
}
