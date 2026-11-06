/**
 * One-off repair: a kit was set up with the WRONG part. Replace it with the
 * right one in the kit template AND in every kit issued from it (the original
 * issue, all its edits 12-A, 12-B ... and every saved/draft kit), with stock
 * corrected to match.
 *
 *   # 1) Preview (changes nothing). Run from the backend folder:
 *   node scripts/swapKitPart.js --kit "KIT 12" --from TTMSSTK001 --to TTMSSTK006
 *
 *   # 2) Write it:
 *   node scripts/swapKitPart.js --kit "KIT 12" --from TTMSSTK001 --to TTMSSTK006 --apply
 *
 *   --kit   the kit template's code or name (as shown on the Kits page)
 *   --from  the part number that was entered by mistake
 *   --to    the part number that should have been there (must exist in the
 *           parts master)
 *
 * What it does
 *   Template      the BOM row's part number becomes --to (its "value" and
 *                 manufacturer part number follow the new part).
 *   Issued kits   every line for --from becomes a line for --to (same qty
 *                 issued / required / short). The quantity that had been
 *                 deducted from --from is put back into --from's stock and
 *                 deducted from --to's stock instead, with the FIFO batch
 *                 breakdown re-worked from --to's own batches.
 *   Saved kits    the line is switched to --to. Nothing is deducted for a
 *                 saved kit, so stock is not touched.
 *
 * Things to know
 *   - If --to does not have enough stock for everything that was issued, its
 *     stock is taken down to 0 only (never negative) and the shortfall is
 *     printed — receive / correct that stock afterwards.
 *   - Parts the vendor already sent back through "Receive material" against
 *     these kits are NOT touched; they are only listed so you can review them.
 *   - Run the preview first and check the numbers. Take a database backup
 *     before using --apply.
 */
import "dotenv/config";
import mongoose from "mongoose";
import KitTemplate from "../src/models/KitTemplate.js";
import KitIssue from "../src/models/KitIssue.js";
import Part from "../src/models/Part.js";
import StockEntry from "../src/models/StockEntry.js";
import { getAvailableBatches, allocateFromBatches } from "../src/utils/batchAllocation.js";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const kitArg = (arg("kit") || "").trim();
const FROM = (arg("from") || "").trim().toUpperCase();
const TO = (arg("to") || "").trim().toUpperCase();
const r4 = (n) => Math.round((Number(n) || 0) * 1e4) / 1e4;

if (!kitArg || !FROM || !TO) {
  console.error('Usage: node scripts/swapKitPart.js --kit "<kit code or name>" --from <wrong part> --to <right part> [--apply]');
  process.exit(1);
}
if (FROM === TO) {
  console.error("--from and --to are the same part.");
  process.exit(1);
}
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGO_URI is not set");
  process.exit(1);
}
await mongoose.connect(uri);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = new RegExp(`^${esc(kitArg)}$`, "i");

const fromPart = await Part.findOne({ ttUniquePartNumber: FROM });
const toPart = await Part.findOne({ ttUniquePartNumber: TO });
if (!toPart) {
  console.error(`${TO} is not in the parts master — create it first.`);
  process.exit(1);
}
console.log(`Wrong part : ${FROM}${fromPart ? ` — ${fromPart.itemDescription} (stock ${fromPart.quantityInStock})` : " (not in master)"}`);
console.log(`Right part : ${TO} — ${toPart.itemDescription} (stock ${toPart.quantityInStock})\n`);

/* ---------------- template ---------------- */
const templates = await KitTemplate.find({ $or: [{ kitCode: exact }, { kitName: exact }] });
if (templates.length === 0) {
  console.error(`No kit template found with code or name "${kitArg}".`);
  process.exit(1);
}
if (templates.length > 1) {
  console.error(
    `"${kitArg}" matches ${templates.length} templates — use the exact code:\n` +
      templates.map((t) => `  ${t.kitCode || "(no code)"}  —  ${t.kitName}`).join("\n")
  );
  process.exit(1);
}
const template = templates[0];
console.log(`Kit template: ${template.kitCode || "(no code)"} — ${template.kitName}`);

const tplRows = (template.items || []).filter((it) => it.ttUniquePartNumber === FROM);
if (tplRows.length === 0) console.log(`  ! no BOM row with ${FROM} on the template (issues are still checked below)`);
if ((template.items || []).some((it) => it.ttUniquePartNumber === TO)) {
  console.error(`The template already has a row for ${TO} — swapping would create a duplicate. Remove one by hand first.`);
  process.exit(1);
}
for (const row of tplRows) {
  console.log(`  template row #${row.srNo ?? "-"}: ${FROM} -> ${TO}  (qty/kit ${row.qtyPerKit}, ref "${row.referenceDesignator || ""}")`);
}

/* ---------------- every issue of this kit (all successions + saved) ---------------- */
let issues = await KitIssue.find({
  $or: [{ kitTemplate: template._id }, ...(template.kitCode ? [{ kitCode: new RegExp(`^${esc(template.kitCode)}$`, "i") }] : [])],
}).sort({ createdAt: 1 });
// Pull in any edit whose chain root / source is one of these but which didn't match above.
const known = new Set(issues.map((i) => String(i._id)));
const extra = await KitIssue.find({
  _id: { $nin: [...known] },
  $or: [{ rootIssue: { $in: [...known] } }, { editedFrom: { $in: [...known] } }],
}).sort({ createdAt: 1 });
issues = [...issues, ...extra].sort((a, b) => a.createdAt - b.createdAt);

const affected = issues.filter((i) => (i.lines || []).some((l) => l.ttUniquePartNumber === FROM));
console.log(`\nKits of this template: ${issues.length}, of which ${affected.length} carry ${FROM}\n`);

/* ---------------- plan ---------------- */
const toBatches = await getAvailableBatches(toPart._id); // mutated as issued lines are allocated, oldest first
let creditFrom = 0; // goes back into FROM stock
let debitTo = 0; // comes out of TO stock
const warnings = [];

for (const issue of affected) {
  const issued = issue.status === "issued";
  const label = `${issue.issueCode || issue.kitName}${issued ? "" : "  [saved kit]"}`;
  for (const line of issue.lines.filter((l) => l.ttUniquePartNumber === FROM)) {
    const qty = r4(line.qtyIssued || 0);
    console.log(`  ${label}: issued ${qty}, required ${line.qtyRequired}, short ${line.qtyShort || 0}`);
    if ((line.qtyReverted || 0) > 0) {
      warnings.push(`${label}: ${line.qtyReverted} of ${FROM} had been reverted — revert history keeps the old part's batch codes.`);
    }

    const hadPart = !!line.part;
    line.part = toPart._id;
    line.ttUniquePartNumber = toPart.ttUniquePartNumber;
    line.itemDescription = toPart.itemDescription;

    if (issued) {
      if (fromPart && hadPart) creditFrom = r4(creditFrom + qty);
      debitTo = r4(debitTo + qty);
      line.batchBreakdown = qty > 0 ? allocateFromBatches(toBatches, qty) : [];
    } else {
      // Saved kit: nothing was deducted — just show an indicative batch split.
      const copy = toBatches.map((b) => ({ ...b }));
      line.batchBreakdown = qty > 0 ? allocateFromBatches(copy, qty) : [];
    }
  }
}

// Returns already booked against these kits for the wrong part.
const issuedIds = affected.filter((i) => i.status === "issued").map((i) => i._id);
if (fromPart && issuedIds.length) {
  const returned = await StockEntry.find({
    part: fromPart._id,
    "kitLink.kind": "returned",
    "kitLink.allocations.kitIssue": { $in: issuedIds },
  }).select("quantityReceived");
  if (returned.length) {
    const sum = r4(returned.reduce((s, e) => s + (e.quantityReceived || 0), 0));
    warnings.push(
      `${returned.length} "returned" receipt(s) totalling ${sum} of ${FROM} were booked against these kits. They were NOT changed — review them in Receive material.`
    );
  }
}

const debitApplied = Math.min(debitTo, toPart.quantityInStock);
console.log("\nStock effect");
console.log(`  ${FROM}: +${creditFrom}  (${fromPart ? fromPart.quantityInStock : "-"} -> ${fromPart ? r4(fromPart.quantityInStock + creditFrom) : "-"})`);
console.log(`  ${TO}: -${debitApplied}  (${toPart.quantityInStock} -> ${r4(toPart.quantityInStock - debitApplied)})`);
if (debitTo > toPart.quantityInStock) {
  warnings.push(`${TO} only has ${toPart.quantityInStock} in stock but ${debitTo} was issued — short by ${r4(debitTo - toPart.quantityInStock)}; stock goes to 0.`);
}
if (warnings.length) {
  console.log("\nWarnings");
  warnings.forEach((w) => console.log(`  ! ${w}`));
}

if (!APPLY) {
  console.log("\nPreview only — nothing was written. Re-run with --apply to make the change.");
  await mongoose.disconnect();
  process.exit(0);
}

/* ---------------- write ---------------- */
for (const row of tplRows) {
  const oldDesc = (fromPart?.itemDescription || "").trim().toLowerCase();
  row.ttUniquePartNumber = toPart.ttUniquePartNumber;
  if (!row.value || (oldDesc && row.value.trim().toLowerCase() === oldDesc)) row.value = toPart.itemDescription;
  if (toPart.manufacturerPartNumber) row.manufacturerPartNumber = toPart.manufacturerPartNumber;
}
if (tplRows.length) await template.save();

for (const issue of affected) await issue.save();

if (fromPart && creditFrom > 0) await Part.updateOne({ _id: fromPart._id }, { $inc: { quantityInStock: creditFrom } });
if (debitApplied > 0) await Part.updateOne({ _id: toPart._id }, { $inc: { quantityInStock: -debitApplied } });

console.log("\nDone — template, issued kits and saved kits now use " + TO + ".");
await mongoose.disconnect();