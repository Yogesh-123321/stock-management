/**
 * One-off repair: a part was entered with the wrong "qty per kit" (e.g. 3 per
 * kit instead of 3 per 400 kits = 0.0075). Fixes the kit TEMPLATE and every
 * ALREADY-ISSUED kit of it, and gives the over-deducted stock back.
 *
 *   node scripts/fixKitQtyPerKit.js --kit "KIT 12" --part TTMSLT24301 --per-kit 0.0075
 *   node scripts/fixKitQtyPerKit.js --kit "KIT 12" --part TTMSLT24301 --per-kit 0.0075 --apply
 *
 * Run from the backend folder. Without --apply it only prints what would change.
 *
 * Per issued-kit line:
 *   qty per kit   -> the new value
 *   qty required  -> new qty per kit x kits in that entry
 *   qty issued    -> the smaller of (what was issued, new qty required)
 *   the difference goes back into Part.quantityInStock, and is taken off the
 *   END of the line's batch breakdown (the newest batches it drew from), so
 *   batch balances come out right too.
 *
 * Skipped with a message (nothing changes for them): lines that have had stock
 * reverted, and kits where parts have already been returned by the vendor
 * beyond what the corrected quantity allows. Saved (draft) kits are not
 * touched — they only report.
 */
import "dotenv/config";
import mongoose from "mongoose";
import KitTemplate from "../src/models/KitTemplate.js";
import KitIssue from "../src/models/KitIssue.js";
import Part from "../src/models/Part.js";
import { returnedMap } from "../src/utils/kitReturn.js";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const kitArg = (arg("kit") || "").trim();
const pn = (arg("part") || "").trim().toUpperCase();
const perKit = Number(arg("per-kit"));
const qr = (n) => Math.round((Number(n) || 0) * 1e4) / 1e4;

if (!kitArg || !pn || !Number.isFinite(perKit) || perKit < 0) {
  console.error('Usage: node scripts/fixKitQtyPerKit.js --kit "KIT 12" --part TTMSLT24301 --per-kit 0.0075 [--apply]');
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
const templates = await KitTemplate.find({ $or: [{ kitCode: exact }, { kitName: exact }] });
if (templates.length !== 1) {
  console.error(templates.length ? "More than one template matches — use the exact kit code." : `No kit template "${kitArg}".`);
  process.exit(1);
}
const template = templates[0];
const items = template.items.filter((it) => it.ttUniquePartNumber === pn);
if (items.length === 0) {
  console.error(`${pn} is not on template ${template.kitCode || template.kitName}.`);
  process.exit(1);
}
const part = await Part.findOne({ ttUniquePartNumber: pn }).select("_id quantityInStock");
if (!part) {
  console.error(`${pn} is not in the parts master.`);
  process.exit(1);
}

console.log(`Template ${template.kitCode || "(no code)"} — ${template.kitName}`);
for (const it of items) console.log(`  template qty per kit for ${pn}: ${it.qtyPerKit}  ->  ${perKit}`);
console.log(`  stock now: ${part.quantityInStock}\n`);

const issues = await KitIssue.find({
  status: "issued",
  $or: [{ kitTemplate: template._id }, { kitCode: template.kitCode || "__none__" }],
  "lines.ttUniquePartNumber": pn,
}).sort({ createdAt: 1 });

const returned = await returnedMap(issues.map((i) => i._id));

const plan = [];
let totalRefund = 0;
console.log("Issued kit      kits  per-kit  required  issued          refund");
for (const issue of issues) {
  const name = (issue.issueCode || issue.kitName).padEnd(14);
  for (const line of issue.lines) {
    if (line.ttUniquePartNumber !== pn) continue;
    if ((line.qtyReverted || 0) > 0) {
      console.log(`${name}  SKIPPED — stock was already reverted on this line; fix by hand.`);
      continue;
    }
    const newRequired = qr(perKit * (Number(issue.quantity) || 0));
    const oldIssued = Number(line.qtyIssued) || 0;
    const newIssued = Math.min(oldIssued, newRequired);
    const refund = qr(oldIssued - newIssued);
    const back = qr(returned.get(`${issue._id}|${part._id}`) || 0);
    if (back > newIssued + 1e-9) {
      console.log(`${name}  SKIPPED — vendor already returned ${back}, more than the corrected issued ${newIssued}.`);
      continue;
    }
    const wasShort = (line.qtyShort || 0) > 0;
    const newShort = wasShort ? qr(Math.max(0, newRequired - newIssued)) : 0;

    // Trim the batch breakdown from the END (newest batch first).
    let remaining = newIssued;
    const breakdown = [];
    for (const b of line.batchBreakdown || []) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      if (take > 0) breakdown.push({ batchCode: b.batchCode ?? null, quantity: qr(take) });
      remaining = qr(remaining - take);
    }

    totalRefund = qr(totalRefund + refund);
    plan.push({ issue, line, newRequired, newIssued, newShort, breakdown, refund });
    console.log(
      `${name}  ${String(issue.quantity).padStart(4)}  ${String(line.qtyPerKit).padStart(3)}->${perKit}  ` +
        `${String(line.qtyRequired).padStart(4)}->${newRequired}  ${String(oldIssued).padStart(5)}->${newIssued}  ` +
        `+${refund}`
    );
  }
}

const drafts = await KitIssue.find({
  status: "draft",
  $or: [{ kitTemplate: template._id }, { kitCode: template.kitCode || "__none__" }],
  "lines.ttUniquePartNumber": pn,
}).select("kitName kitCode");
if (drafts.length) {
  console.log(`\n${drafts.length} saved (draft) kit(s) also carry ${pn} at the old quantity — not touched. Discard and re-make them after this fix.`);
}

console.log(`\nStock to give back: ${totalRefund}   (stock ${part.quantityInStock} -> ${qr(part.quantityInStock + totalRefund)})`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing was changed. Re-run with --apply to write it.");
  await mongoose.disconnect();
  process.exit(0);
}

for (const p of plan) {
  await KitIssue.updateOne(
    { _id: p.issue._id },
    {
      $set: {
        "lines.$[l].qtyPerKit": perKit,
        "lines.$[l].qtyRequired": p.newRequired,
        "lines.$[l].qtyIssued": p.newIssued,
        "lines.$[l].qtyShort": p.newShort,
        "lines.$[l].batchBreakdown": p.breakdown,
      },
    },
    { arrayFilters: [{ "l._id": p.line._id }] }
  );
  const fresh = await KitIssue.findById(p.issue._id).select("lines.qtyShort");
  await KitIssue.updateOne(
    { _id: p.issue._id },
    { $set: { hasShortage: fresh.lines.some((l) => (l.qtyShort || 0) > 0) } }
  );
}
if (totalRefund > 0) await Part.updateOne({ _id: part._id }, { $inc: { quantityInStock: totalRefund } });
for (const it of items) {
  await KitTemplate.updateOne(
    { _id: template._id },
    { $set: { "items.$[i].qtyPerKit": perKit } },
    { arrayFilters: [{ "i._id": it._id }] }
  );
}
console.log(`\nDone — ${plan.length} kit line(s) corrected, template updated, ${totalRefund} returned to stock.`);
await mongoose.disconnect();