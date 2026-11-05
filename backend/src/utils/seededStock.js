/*
  Ledger helper shared by the stock-workbook import and the seeded-stock
  backfill. For one part it returns what the movements alone explain:
    appliedIn  - receipts already credited to main stock
    kits       - units issued out through kits
    rndIssued  - units moved to R&D (from the part's own issue log)
    sampleOut  - units currently out with buyers as samples (part.sampleStock)
    ledgerMain - appliedIn - kits - rndIssued - sampleOut
                 = what main stock should be WITHOUT any seeded quantity
*/
import StockEntry from "../models/StockEntry.js";
import KitIssue from "../models/KitIssue.js";

export const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export async function ledgerFor(part) {
  const [inAgg] = await StockEntry.aggregate([
    { $match: { part: part._id, stockApplied: true } },
    { $group: { _id: null, qty: { $sum: "$quantityReceived" } } },
  ]);
  const [kitAgg] = await KitIssue.aggregate([
    { $unwind: "$lines" },
    { $match: { "lines.part": part._id } },
    { $group: { _id: null, qty: { $sum: "$lines.qtyIssued" } } },
  ]);
  const appliedIn = inAgg?.qty || 0;
  const kits = kitAgg?.qty || 0;
  const rndIssued = (part.rndIssues || []).reduce((n, e) => n + (Number(e.quantity) || 0), 0);
  const sampleOut = Number(part.sampleStock) || 0;
  return { appliedIn, kits, rndIssued, sampleOut, ledgerMain: r3(appliedIn - kits - rndIssued - sampleOut) };
}