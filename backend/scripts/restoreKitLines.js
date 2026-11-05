/**
 * One-off repair: put a part's line back into already-issued kits, shown with
 * 0 issued, after the line was removed by "Delete this history entry".
 *
 *   # 1) See what is missing (changes nothing). Run from the backend folder:
 *   node scripts/restoreKitLines.js --kit "KIT 12"
 *
 *   # 2) Preview exactly what would be added for the parts you name:
 *   node scripts/restoreKitLines.js --kit "KIT 12" --part PN1,PN2
 *
 *   # 3) Write it:
 *   node scripts/restoreKitLines.js --kit "KIT 12" --part PN1,PN2 --apply
 *
 *   --kit   the kit template's code or name (as shown on the Kits page)
 *   --part  one or more TT unique part numbers (comma separated) that are on
 *           the template but are missing from the issued kits
 *
 * What it does, per ISSUED kit of that template that has no line for the part:
 *   adds a line with qty issued = 0 (qty per kit / reference designator taken
 *   from the template, qty required = qty per kit x kits issued).
 *
 * What it never does: it does not touch stock (Part.quantityInStock), batches,
 * saved (draft) kits, or any kit that already has a line for the part.
 */
import "dotenv/config";
import mongoose from "mongoose";
import KitTemplate from "../src/models/KitTemplate.js";
import KitIssue from "../src/models/KitIssue.js";
import Part from "../src/models/Part.js";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const kitArg = (arg("kit") || "").trim();
const partArgs = (arg("part") || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

if (!kitArg) {
  console.error('Pass --kit "<kit code or name>"');
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

const issues = await KitIssue.find({
  status: "issued",
  $or: [{ kitTemplate: template._id }, { kitCode: template.kitCode || "__none__" }],
}).sort({ createdAt: 1 });
console.log(`Issued kits of this template: ${issues.length}\n`);

const items = (template.items || []).filter((it) => !it.dnp);
const hasLine = (issue, pn, partId) =>
  (issue.lines || []).some(
    (l) => l.ttUniquePartNumber === pn || (partId && l.part && String(l.part) === String(partId))
  );

// ---- Report-only mode: which template parts are missing from which kits ----
if (partArgs.length === 0) {
  let any = false;
  for (const issue of issues) {
    const missing = items.filter((it) => !hasLine(issue, it.ttUniquePartNumber, null));
    if (missing.length) {
      any = true;
      console.log(
        `${issue.issueCode || issue.kitName}: missing ${missing
          .map((m) => m.ttUniquePartNumber)
          .join(", ")}`
      );
    }
  }
  if (!any) console.log("Every issued kit already has a line for every template part.");
  console.log("\nNothing was changed. Re-run with --part <numbers> to preview a fix.");
  await mongoose.disconnect();
  process.exit(0);
}

// ---- Fix mode ----
const plan = [];
for (const pn of partArgs) {
  const item = items.find((it) => it.ttUniquePartNumber === pn);
  if (!item) {
    console.error(`Part ${pn} is not an active (non-DNP) item on this template — skipped.`);
    continue;
  }
  const part = await Part.findOne({ ttUniquePartNumber: pn }).select("_id itemDescription");
  for (const issue of issues) {
    if (hasLine(issue, pn, part?._id)) continue;
    plan.push({ issue, item, part });
  }
}

if (plan.length === 0) {
  console.log("Nothing to add — every issued kit already has those parts.");
  await mongoose.disconnect();
  process.exit(0);
}

for (const { issue, item } of plan) {
  console.log(`  + ${issue.issueCode || issue.kitName}: ${item.ttUniquePartNumber}  (issued 0)`);
}

if (!APPLY) {
  console.log(`\nDRY RUN — ${plan.length} line(s) would be added. Re-run with --apply to write them.`);
  await mongoose.disconnect();
  process.exit(0);
}

const byIssue = new Map();
for (const p of plan) {
  const key = String(p.issue._id);
  if (!byIssue.has(key)) byIssue.set(key, { issue: p.issue, lines: [] });
  const qtyPerKit = Number(p.item.qtyPerKit) || 0;
  byIssue.get(key).lines.push({
    part: p.part?._id || null,
    ttUniquePartNumber: p.item.ttUniquePartNumber,
    itemDescription: p.part?.itemDescription || "",
    referenceDesignator: p.item.referenceDesignator || "",
    qtyPerKit,
    qtyRequired: qtyPerKit * (Number(p.issue.quantity) || 0),
    qtyIssued: 0,
    qtyShort: 0,
    batchBreakdown: [],
  });
}
for (const { issue, lines } of byIssue.values()) {
  await KitIssue.updateOne({ _id: issue._id }, { $push: { lines: { $each: lines } } });
}
console.log(`\nDone — ${plan.length} line(s) added across ${byIssue.size} kit(s). Stock was not changed.`);
await mongoose.disconnect();