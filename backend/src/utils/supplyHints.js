/*
  "Where else is this part?" — used on the kit screens when a part is short
  in main stock. For each part it reports stock that exists but is NOT in
  main stock, so the person issuing the kit knows where to look:

    rnd             set aside for R&D — who currently holds how much
                    (net of anything already returned to main stock)
    samples         out with buyers as samples — which buyer / sample issue
    pendingInvoice  received from a vendor but the tax invoice hasn't arrived
                    yet, so it hasn't reached IQC or main stock — which
                    vendor / PO or PI, and how much

  Only sections with a non-zero quantity are included. Read-only: nothing
  here changes stock.
*/
import mongoose from "mongoose";
import Part from "../models/Part.js";
import StockEntry from "../models/StockEntry.js";
import { sampleHoldersByPart } from "./sampleHolders.js";

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Map(partId string -> { rnd?, samples?, pendingInvoice? }) */
export async function supplyHintsByPart(partIds) {
  const ids = [...new Set((partIds || []).filter(Boolean).map((id) => String(id)))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );
  const out = new Map();
  if (!ids.length) return out;
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));

  const [parts, holdersMap, pending] = await Promise.all([
    Part.find({ _id: { $in: objectIds } }).select("rndStock rndIssues sampleStock").lean(),
    sampleHoldersByPart(ids),
    StockEntry.find({
      part: { $in: objectIds },
      stockApplied: false,
      iqcStatus: "awaiting_invoice",
    })
      .populate("vendor", "companyName")
      .populate("purchaseOrder", "documentType documentNumber")
      .select("part vendor purchaseOrder quantityReceived createdAt")
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const entryFor = (id) => {
    const k = String(id);
    if (!out.has(k)) out.set(k, {});
    return out.get(k);
  };

  for (const p of parts) {
    // R&D: who still holds how much.
    const byPerson = new Map();
    for (const iss of p.rndIssues || []) {
      const left = r3((Number(iss.quantity) || 0) - (Number(iss.returnedQuantity) || 0));
      if (left <= 0) continue;
      const key = iss.person ? String(iss.person) : `name:${iss.personName}`;
      const cur = byPerson.get(key) || { name: iss.personName || "Unknown", quantity: 0 };
      cur.quantity = r3(cur.quantity + left);
      byPerson.set(key, cur);
    }
    const rndQty = r3(Number(p.rndStock) || 0);
    if (rndQty > 0) {
      entryFor(p._id).rnd = { quantity: rndQty, holders: [...byPerson.values()] };
    }

    // Samples: total from the part, who holds it from the sample ledger.
    const sampleQty = r3(Number(p.sampleStock) || 0);
    if (sampleQty > 0) {
      const holders = (holdersMap.get(String(p._id)) || []).map((h) => ({
        buyerName: h.buyerName || "",
        issueCode: h.issueCode || "",
        quantity: h.quantity,
      }));
      entryFor(p._id).samples = { quantity: sampleQty, holders };
    }
  }

  // Pending invoice: received, tax invoice not in yet.
  for (const e of pending) {
    const slot = entryFor(e.part);
    if (!slot.pendingInvoice) slot.pendingInvoice = { quantity: 0, entries: [] };
    slot.pendingInvoice.quantity = r3(slot.pendingInvoice.quantity + (Number(e.quantityReceived) || 0));
    slot.pendingInvoice.entries.push({
      vendorName: e.vendor?.companyName || "",
      reference: e.purchaseOrder
        ? `${e.purchaseOrder.documentType || "PO"}${
            e.purchaseOrder.documentNumber ? ` ${e.purchaseOrder.documentNumber}` : ""
          }`
        : "",
      quantity: e.quantityReceived,
      receivedAt: e.createdAt,
    });
  }

  return out;
}