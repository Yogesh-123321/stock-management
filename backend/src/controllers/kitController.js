import asyncHandler from "express-async-handler";
import xlsx from "xlsx";
import ExcelJS from "exceljs";
import KitTemplate from "../models/KitTemplate.js";
import KitIssue from "../models/KitIssue.js";
import Part from "../models/Part.js";
import Vendor from "../models/Vendor.js";
import { parseKitWorkbook } from "../utils/parseKitSheet.js";
import { getAvailableBatches, allocateFromBatches } from "../utils/batchAllocation.js";
import { returnedMap } from "../utils/kitReturn.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "tispl-logo.jpeg");

// Lines flagged Do Not Populate never consume stock and are never part of
// what an issue actually deducts — kept on the template for reference only.
const issuableItems = (items) => (items || []).filter((it) => !it.dnp);

const sanitizeItem = (raw = {}) => {
  const ttUniquePartNumber = String(raw.ttUniquePartNumber || "").trim().toUpperCase();
  const qtyPerKit = Number(raw.qtyPerKit);
  if (!ttUniquePartNumber) throw Object.assign(new Error("Every kit item needs a TT unique part number"), { status: 400 });
  if (!Number.isFinite(qtyPerKit) || qtyPerKit < 0) {
    throw Object.assign(
      new Error(`Qty per kit for ${ttUniquePartNumber} must be a non-negative number`),
      { status: 400 }
    );
  }
  return {
    srNo: raw.srNo != null && raw.srNo !== "" ? Number(raw.srNo) : null,
    referenceDesignator: String(raw.referenceDesignator || "").trim(),
    value: String(raw.value || "").trim(),
    partType: String(raw.partType || "").trim(),
    ttUniquePartNumber,
    manufacturerPartNumber: String(raw.manufacturerPartNumber || "").trim(),
    manufacturer: String(raw.manufacturer || "").trim(),
    footprint: String(raw.footprint || "").trim(),
    qtyPerKit,
    dnp: !!raw.dnp,
    remarks: String(raw.remarks || "").trim(),
  };
};

// A kit template may list each part only ONCE. Matching is on the TT unique part
// number (already trimmed + upper-cased by sanitizeItem). Throws a 400 naming
// every part that appears more than once and the rows it is on.
const assertNoDuplicateParts = (items) => {
  const rowsByCode = new Map();
  items.forEach((it, i) => {
    const list = rowsByCode.get(it.ttUniquePartNumber) || [];
    list.push(i + 1);
    rowsByCode.set(it.ttUniquePartNumber, list);
  });
  const dups = [...rowsByCode.entries()].filter(([, rows]) => rows.length > 1);
  if (dups.length) {
    const list = dups.map(([code, rows]) => `${code} (rows ${rows.join(", ")})`).join("; ");
    throw Object.assign(
      new Error(
        `A part can appear only once in a kit template. Duplicate part${dups.length === 1 ? "" : "s"}: ${list}. ` +
          "Remove the repeated line(s) or add their quantities together."
      ),
      { status: 400 }
    );
  }
};

// Quantities can be decimal (metres, kilograms, ...). Rounding to 4 places keeps
// float noise (0.1 * 3 = 0.30000000000000004) out of stock and issue figures.
const qr = (n) => Math.round((Number(n) || 0) * 1e4) / 1e4;

// Resolves every ttUniquePartNumber referenced by a set of kit items
// against the live parts master in one query, keyed by code.
async function resolvePartsByCode(items) {
  const codes = [...new Set((items || []).map((it) => it.ttUniquePartNumber).filter(Boolean))];
  if (!codes.length) return new Map();
  const parts = await Part.find({ ttUniquePartNumber: { $in: codes } }).select(
    "ttUniquePartNumber itemDescription quantityInStock unit"
  );
  return new Map(parts.map((p) => [p.ttUniquePartNumber, p]));
}

/*
  Shared by issueKit and editKitIssue: resolves every line against live
  stock and deducts it. A line is never rejected for being short — it
  deducts whatever is available (0 if the part is missing from the master
  entirely) and the gap comes back as a shortage. If the caller passed a
  specific qty to issue for a line (overrideLines), that figure is used
  instead (still capped at available stock — a line can never deduct more
  than what's on hand — which throws a validation error, .status 400, if
  violated).
*/
async function resolveAndDeductLines(items, qty, overrideLines, previousByCode = null) {
  const byCode = await resolvePartsByCode(items);

  // Optional per-item overrides from the user: the actual quantity being
  // issued for each part, keyed by ttUniquePartNumber. A part not present
  // here (or no `lines` at all) falls back to min(available, required).
  const overrideByCode = new Map();
  if (Array.isArray(overrideLines)) {
    for (const line of overrideLines) {
      const code = String(line?.ttUniquePartNumber || "").trim().toUpperCase();
      if (!code) continue;
      const q = Number(line?.qtyIssued);
      if (Number.isFinite(q) && q >= 0) overrideByCode.set(code, q);
    }
  }

  const resolvedLines = [];
  const shortages = [];
  // Batches fetched per part are cached and mutated across this whole
  // call, so a second line for the same part (e.g. two reference
  // designators for the same TT number) continues drawing from wherever
  // the first line left off instead of double-allocating the same units.
  const batchCache = new Map();
  for (const item of items) {
    const partDoc = byCode.get(item.ttUniquePartNumber);
    const required = qr(item.qtyPerKit * qty);
    const available = partDoc ? partDoc.quantityInStock : 0;

    let toDeduct;
    if (overrideByCode.has(item.ttUniquePartNumber)) {
      toDeduct = overrideByCode.get(item.ttUniquePartNumber);
      if (toDeduct > available) {
        throw Object.assign(
          new Error(
            `Qty to issue for ${item.ttUniquePartNumber} (${toDeduct}) exceeds available stock (${available})`
          ),
          { status: 400 }
        );
      }
    } else {
      toDeduct = Math.min(available, required);
    }
    // previousByCode is only passed for a PARTIAL edit: what the earlier
    // entries of the chain already issued counts towards the requirement.
    const alreadyIssued = previousByCode ? previousByCode.get(item.ttUniquePartNumber) || 0 : 0;
    const short = qr(Math.max(0, required - alreadyIssued - toDeduct));

    if (short > 0) {
      shortages.push({
        ttUniquePartNumber: item.ttUniquePartNumber,
        itemDescription: partDoc?.itemDescription || "",
        referenceDesignator: item.referenceDesignator,
        required,
        available,
        qtyShort: short,
        reason: partDoc ? "Insufficient stock" : "Not found in the parts master",
      });
    }

    let batchBreakdown = [];
    if (partDoc && toDeduct > 0) {
      const key = String(partDoc._id);
      if (!batchCache.has(key)) {
        batchCache.set(key, await getAvailableBatches(partDoc._id));
      }
      batchBreakdown = allocateFromBatches(batchCache.get(key), toDeduct);
    }

    resolvedLines.push({ item, partDoc, required, toDeduct, short, batchBreakdown });
  }

  // Deduct whatever's available for every line — nothing to deduct for a
  // line whose part isn't in the master at all.
  for (const { partDoc, toDeduct } of resolvedLines) {
    if (partDoc && toDeduct > 0) {
      partDoc.quantityInStock = qr(Math.max(0, partDoc.quantityInStock - toDeduct));
      await partDoc.save();
    }
  }

  return { resolvedLines, shortages };
}

/*
  Preview-only counterpart of resolveAndDeductLines, used for saving a
  draft. Resolves every line against CURRENT live stock so the draft
  always shows an up-to-date picture, but never writes anything back to a
  Part — nothing is deducted until the draft is actually issued (see
  issueKitDraft). A planned qty above what's currently available is not
  an error here — stock may well arrive before the kit is finally issued,
  which is the whole point of being able to save a kit for a while — so
  it's just reported back as a shortage for the UI to show, same shape as
  a real shortage.
*/
async function resolveDraftLines(items, qty, overrideLines, previousByCode = null) {
  const byCode = await resolvePartsByCode(items);

  const overrideByCode = new Map();
  if (Array.isArray(overrideLines)) {
    for (const line of overrideLines) {
      const code = String(line?.ttUniquePartNumber || "").trim().toUpperCase();
      if (!code) continue;
      const q = Number(line?.qtyIssued);
      if (Number.isFinite(q) && q >= 0) overrideByCode.set(code, q);
    }
  }

  const resolvedLines = [];
  const shortages = [];
  const batchCache = new Map();
  for (const item of items) {
    const partDoc = byCode.get(item.ttUniquePartNumber);
    const required = qr(item.qtyPerKit * qty);
    const available = partDoc ? partDoc.quantityInStock : 0;

    const planned = overrideByCode.has(item.ttUniquePartNumber)
      ? overrideByCode.get(item.ttUniquePartNumber)
      : Math.min(available, required);
    const alreadyIssued = previousByCode ? previousByCode.get(item.ttUniquePartNumber) || 0 : 0;
    const short = qr(Math.max(0, required - alreadyIssued - planned));

    if (short > 0) {
      shortages.push({
        ttUniquePartNumber: item.ttUniquePartNumber,
        itemDescription: partDoc?.itemDescription || "",
        referenceDesignator: item.referenceDesignator,
        required,
        available,
        qtyShort: short,
        reason: partDoc ? "Insufficient stock" : "Not found in the parts master",
      });
    }

    // Same FIFO preview as a real issue — indicative only, since nothing
    // is actually deducted for a draft, so live stock (and therefore
    // which batch this would draw from) can still move before it's
    // actually issued.
    let batchBreakdown = [];
    if (partDoc && planned > 0) {
      const key = String(partDoc._id);
      if (!batchCache.has(key)) {
        batchCache.set(key, await getAvailableBatches(partDoc._id));
      }
      batchBreakdown = allocateFromBatches(batchCache.get(key), planned);
    }

    resolvedLines.push({ item, partDoc, required, toDeduct: planned, short, batchBreakdown });
  }

  return { resolvedLines, shortages };
}

// Shapes resolveAndDeductLines' output into KitIssue.lines' schema.
const linesPayloadFrom = (resolvedLines) =>
  resolvedLines.map(({ item, partDoc, required, toDeduct, short, batchBreakdown }) => ({
    part: partDoc ? partDoc._id : null,
    ttUniquePartNumber: item.ttUniquePartNumber,
    itemDescription: partDoc ? partDoc.itemDescription : item.value || "",
    referenceDesignator: item.referenceDesignator,
    qtyPerKit: item.qtyPerKit,
    qtyRequired: required,
    qtyIssued: toDeduct,
    qtyShort: short,
    batchBreakdown: batchBreakdown || [],
  }));

// Per-part totals already issued across the edit chain up to (and including)
// the issued entry `baseId` — the same totals getKitIssueChainTotals shows as
// "Prev. issued". Used to measure shortages of a PARTIAL edit. Map of
// ttUniquePartNumber -> qty; empty when the entry can't be found.
async function previousTotalsFor(baseId) {
  const totals = new Map();
  if (!baseId) return totals;
  const baseDoc = await KitIssue.findById(baseId).select("rootIssue editIndex");
  if (!baseDoc) return totals;
  const rootId = baseDoc.rootIssue || baseDoc._id;
  const chain = await KitIssue.find({
    $or: [{ _id: rootId }, { rootIssue: rootId }],
    status: "issued",
    editIndex: { $lte: baseDoc.editIndex || 0 },
  })
    .select("lines.ttUniquePartNumber lines.qtyIssued")
    .lean();
  for (const doc of chain) {
    for (const line of doc.lines || []) {
      if (!line.ttUniquePartNumber) continue;
      totals.set(line.ttUniquePartNumber, (totals.get(line.ttUniquePartNumber) || 0) + (line.qtyIssued || 0));
    }
  }
  return totals;
}

// "partial" | "full" from a request body; anything else -> "full" (the
// behaviour edits always had), so older clients keep working.
const cleanEditMode = (v) => (v === "partial" ? "partial" : "full");

// Base-26 uppercase letter suffix used for the kit-issue edit series:
// 1 -> "A", 2 -> "B", ..., 26 -> "Z", 27 -> "AA", 28 -> "AB", ...
function editLetterSuffix(n) {
  let out = "";
  let x = n;
  while (x > 0) {
    x -= 1;
    out = String.fromCharCode(65 + (x % 26)) + out;
    x = Math.floor(x / 26);
  }
  return out;
}

/* ---------------------------------------------------------------------
  Issue codes
  The code of an issued kit is taken from the kit template's own kit code
  (e.g. KIT_05) at the moment it is issued:
    first issue            KIT_05
    its 1st / 2nd edit     KIT_05-A / KIT_05-B ... (KIT_05-Z, then -AA)
    same template issued   KIT_05-A, KIT_05-B ...   (a fresh issue, not an edit)
    again from scratch
  A template with no kit code falls back to its name. The person issuing
  can overwrite the suggested code with their own; a code can only be used
  by one issued kit.
--------------------------------------------------------------------- */
const escapeRegExp = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Trim, collapse inner whitespace, cap the length. "" when nothing usable.
const cleanIssueCode = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

// The base every code of this kit starts from: its kit code, else its name.
const kitCodeBase = (src) => cleanIssueCode(src?.kitCode) || cleanIssueCode(src?.kitName) || "Kit";

/* ---------------------------------------------------------------------
  "Same kit" matching for the Prev. issued figures
  Two issued entries belong to the same kit when they come from the same
  kit template OR carry the same kit code (case-insensitive). Matching on
  the code as well means a new issue made against a kit code still sees
  what was issued before under that code — even when the template was
  re-created / re-imported since (a new template _id, same code).
--------------------------------------------------------------------- */
const codeKey = (v) => cleanIssueCode(v).toLowerCase();

// Mongo filter for every ISSUED entry of the same kit as `src`
// ({ kitTemplate?, kitCode? }). null when src carries neither.
function sameKitIssuedFilter(src) {
  const or = [];
  if (src?.kitTemplate) or.push({ kitTemplate: src.kitTemplate });
  const code = cleanIssueCode(src?.kitCode);
  if (code) or.push({ kitCode: new RegExp(`^${escapeRegExp(code)}$`, "i") });
  return or.length ? { status: "issued", $or: or } : null;
}

// Per-part sum of qtyIssued over a set of KitIssue docs -> { code: qty }.
function sumIssuedByPart(docs) {
  const totals = {};
  for (const doc of docs) {
    for (const line of doc.lines || []) {
      if (!line.ttUniquePartNumber) continue;
      totals[line.ttUniquePartNumber] = qr((totals[line.ttUniquePartNumber] || 0) + (line.qtyIssued || 0));
    }
  }
  return totals;
}

// Adds `qtyPreviouslyIssued` to every line of every (plain) issue in `list`:
// what was issued of that part by EARLIER issued entries of the same kit
// (same template or same kit code, any vendor, edits included). Feeds the
// "Prev. issued" column of the Issued kits view.
async function attachPreviouslyIssued(list) {
  if (!list.length) return list;
  const templateIds = new Set();
  const codes = new Set();
  for (const iss of list) {
    if (iss.kitTemplate) templateIds.add(String(iss.kitTemplate));
    const c = codeKey(iss.kitCode);
    if (c) codes.add(c);
  }
  const or = [];
  if (templateIds.size) or.push({ kitTemplate: { $in: [...templateIds] } });
  for (const c of codes) or.push({ kitCode: new RegExp(`^${escapeRegExp(c)}$`, "i") });

  const pool = or.length
    ? await KitIssue.find({ status: "issued", $or: or })
        .select("kitTemplate kitCode createdAt lines.ttUniquePartNumber lines.qtyIssued")
        .lean()
    : [];
  const entries = pool.map((d) => ({
    id: String(d._id),
    tpl: d.kitTemplate ? String(d.kitTemplate) : "",
    code: codeKey(d.kitCode),
    at: d.createdAt ? new Date(d.createdAt).getTime() : 0,
    totals: sumIssuedByPart([d]),
  }));

  for (const iss of list) {
    const tpl = iss.kitTemplate ? String(iss.kitTemplate._id || iss.kitTemplate) : "";
    const code = codeKey(iss.kitCode);
    const at = iss.createdAt ? new Date(iss.createdAt).getTime() : 0;
    const prev = {};
    for (const e of entries) {
      if (e.id === String(iss._id) || e.at >= at) continue;
      if (!((tpl && e.tpl === tpl) || (code && e.code === code))) continue;
      for (const [part, qty] of Object.entries(e.totals)) prev[part] = qr((prev[part] || 0) + qty);
    }
    for (const line of iss.lines || []) {
      line.qtyPreviouslyIssued = prev[line.ttUniquePartNumber] || 0;
    }
  }
  return list;
}

// Case-insensitive: is this code already carried by an ISSUED kit?
async function issueCodeTaken(code, excludeId = null) {
  const filter = { status: "issued", issueCode: new RegExp(`^${escapeRegExp(code)}$`, "i") };
  if (excludeId) filter._id = { $ne: excludeId };
  return !!(await KitIssue.exists(filter));
}

// Throws a 400 when a code typed by the user is already in use.
async function assertIssueCodeFree(res, code, excludeId = null) {
  if (code && (await issueCodeTaken(code, excludeId))) {
    res.status(400);
    throw new Error(`The code "${code}" is already used by another issued kit — type a different one`);
  }
}

// Next code for a fresh (non-edit) issue of a template: the kit's own code
// the first time, then KIT_05-A, KIT_05-B ... — the same letter series an
// edit uses. A code can only belong to one issued kit, so a letter already
// taken (by an earlier issue OR by an edit of one) is skipped and the next
// free one is suggested.
async function suggestRootIssueCode(src) {
  const base = kitCodeBase(src);
  if (!(await issueCodeTaken(base))) return base;
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${base}-${editLetterSuffix(n)}`;
    if (!(await issueCodeTaken(candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// Next code in an edit series: root code + "-A", "-B", ... `nextIndex` is
// the position in the chain (kept for editIndex); the letter is bumped
// further only if somebody already used that exact code.
async function suggestEditIssueCode(rootDoc) {
  const priorEdits = await KitIssue.find({ rootIssue: rootDoc._id, status: "issued" })
    .select("editIndex")
    .lean();
  const nextIndex = priorEdits.reduce((max, e) => Math.max(max, e.editIndex || 0), 0) + 1;
  const baseCode = rootDoc.issueCode || rootDoc.kitName;
  let letter = nextIndex;
  let issueCode = `${baseCode}-${editLetterSuffix(letter)}`;
  while (await issueCodeTaken(issueCode)) {
    letter += 1;
    issueCode = `${baseCode}-${editLetterSuffix(letter)}`;
  }
  return { nextIndex, baseCode, issueCode };
}

// Parts added to ONE kit on top of its template (the "Add part" button on
// the edit screen) are stored as lines with qtyPerKit 0, since they aren't
// on the template. Saving / issuing a saved kit rebuilds its item list from
// the template, so these extras have to be carried over explicitly or they
// would silently drop off. `savedLines` = the kit's existing lines,
// `extraItems` = parts newly added in this request.
const withExtraItems = (baseItems, savedLines = [], extraItems = []) => {
  const items = [...baseItems];
  const have = new Set(items.map((it) => it.ttUniquePartNumber));
  const add = (code, referenceDesignator, value) => {
    const c = String(code || "").trim().toUpperCase();
    if (!c || have.has(c)) return;
    have.add(c);
    items.push({
      ttUniquePartNumber: c,
      referenceDesignator: String(referenceDesignator || "").trim(),
      qtyPerKit: 0,
      value: value || "",
    });
  };
  for (const l of savedLines || []) {
    if ((l.qtyPerKit || 0) === 0) add(l.ttUniquePartNumber, l.referenceDesignator, l.itemDescription);
  }
  for (const ex of extraItems || []) add(ex?.ttUniquePartNumber, ex?.referenceDesignator, "");
  return items;
};

// Quantities the request didn't mention for those extra parts fall back to
// what's already saved on the kit (otherwise they'd default to 0).
const withSavedExtraQty = (overrideLines, savedLines = []) => {
  const out = Array.isArray(overrideLines) ? [...overrideLines] : [];
  const named = new Set(out.map((l) => String(l?.ttUniquePartNumber || "").trim().toUpperCase()));
  for (const l of savedLines || []) {
    if ((l.qtyPerKit || 0) === 0 && !named.has(l.ttUniquePartNumber)) {
      out.push({ ttUniquePartNumber: l.ttUniquePartNumber, qtyIssued: l.qtyIssued });
    }
  }
  return out;
};

// A kit issue is editable only while nothing has been created "from" it
// yet — the moment an edit is made (Kit 1 -> Kit 1A, or Kit 1A -> Kit 1B),
// the entry that edit was made from is permanently superseded: it stays
// visible as history but can never be edited again, only viewed. Editing
// always happens from whichever entry is currently the head of the chain.
async function attachEditLock(issues) {
  const list = Array.isArray(issues) ? issues : [issues];
  if (list.length === 0) return issues;
  // Only edits that have actually been ISSUED supersede their source — an
  // edit still sitting in "Saved kits" (a draft) leaves it editable, so
  // discarding that saved edit puts everything back as it was.
  const supersededIds = new Set(
    (await KitIssue.distinct("editedFrom", { status: "issued" })).map((id) => String(id))
  );
  for (const iss of list) {
    iss.isEditable = !supersededIds.has(String(iss._id));
  }
  return issues;
}

// Attaches a live `matchedPart` (or null) to every item of a template —
// used wherever the frontend needs to know current stock against a
// template, without ever storing a stale Part reference on the template
// itself (ttUniquePartNumber is always the source of truth). Also attaches
// each matched part's current batch breakdown (`batches`, oldest first) so
// the issuing screen can preview which batch(es) a line will actually draw
// from before the kit is issued for real.
async function withResolvedItems(templateDoc) {
  const template = templateDoc.toObject ? templateDoc.toObject() : templateDoc;
  const byCode = await resolvePartsByCode(template.items);

  const batchesByPart = new Map();
  await Promise.all(
    [...byCode.values()].map(async (partDoc) => {
      batchesByPart.set(String(partDoc._id), await getAvailableBatches(partDoc._id));
    })
  );

  template.items = (template.items || []).map((it) => {
    const matchedPart = byCode.get(it.ttUniquePartNumber) || null;
    return {
      ...it,
      matchedPart,
      batches: matchedPart ? batchesByPart.get(String(matchedPart._id)) || [] : [],
    };
  });
  return template;
}

// GET /api/kits?search=&activeOnly=1
export const getKitTemplates = asyncHandler(async (req, res) => {
  const { search, activeOnly } = req.query;
  const filter = {};
  if (search) {
    filter.$or = [
      { kitName: { $regex: search, $options: "i" } },
      { kitCode: { $regex: search, $options: "i" } },
    ];
  }
  if (activeOnly === "1" || activeOnly === "true") filter.isActive = true;

  // NOTE: .lean({ virtuals: true }) looks like it should compute the
  // `itemCount` virtual, but that option only works with the
  // mongoose-lean-virtuals plugin, which isn't installed here — so with a
  // plain .lean() it silently does nothing and itemCount comes back
  // undefined for every row (shown as 0 on the Kits list). Compute it by
  // hand instead so the list always reflects the real item count.
  const templates = await KitTemplate.find(filter).sort({ kitName: 1 }).lean();
  // Once a template has been issued at least once, its composition is
  // locked (see updateKitTemplate) — the list needs to know this up front
  // so the Edit action can be disabled without a round trip per row.
  const issuedIds = new Set((await KitIssue.distinct("kitTemplate")).map((id) => String(id)));
  const withCounts = templates.map((t) => ({
    ...t,
    itemCount: Array.isArray(t.items) ? t.items.length : 0,
    hasIssues: issuedIds.has(String(t._id)),
  }));
  res.json(withCounts);
});

// GET /api/kits/:id  — full template with each item's live stock match resolved
export const getKitTemplateById = asyncHandler(async (req, res) => {
  const template = await KitTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("Kit template not found");
  }
  const resolved = await withResolvedItems(template);
  resolved.hasIssues = !!(await KitIssue.exists({ kitTemplate: template._id }));
  res.json(resolved);
});

// POST /api/kits  (admin only — kit.manage)
export const createKitTemplate = asyncHandler(async (req, res) => {
  const { kitName, kitCode, revision, description, items } = req.body;
  if (!kitName || !kitName.trim()) {
    res.status(400);
    throw new Error("Kit name is required");
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400);
    throw new Error("A kit template needs at least one item");
  }

  let sanitizedItems;
  try {
    sanitizedItems = items.map(sanitizeItem);
    assertNoDuplicateParts(sanitizedItems);
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  const template = await KitTemplate.create({
    kitName: kitName.trim(),
    kitCode: (kitCode || "").trim().toUpperCase(),
    revision: (revision || "").trim().toUpperCase(),
    description: (description || "").trim(),
    items: sanitizedItems,
    createdBy: req.user?.name || req.user?.username || "",
    createdByUser: req.user?._id || null,
  });

  res.status(201).json(await withResolvedItems(template));
});

// PATCH /api/kits/:id  (admin only — kit.manage)
// Once a template has been issued at least once, its composition is
// frozen — issues (and any future edit made to them) rely on this
// template's items staying exactly what they were at issue time,
// so nothing but `isActive` may change from here on. Deactivating it and
// creating a fresh template is the supported way to make changes.
export const updateKitTemplate = asyncHandler(async (req, res) => {
  const template = await KitTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("Kit template not found");
  }

  const { kitName, kitCode, revision, description, items, isActive } = req.body;

  const changingComposition =
    kitName !== undefined ||
    kitCode !== undefined ||
    revision !== undefined ||
    description !== undefined ||
    items !== undefined;
  if (changingComposition) {
    const hasIssues = await KitIssue.exists({ kitTemplate: template._id });
    if (hasIssues) {
      res.status(400);
      throw new Error(
        "This kit has already been issued and can no longer be edited. Deactivate it and create a new kit template instead."
      );
    }
  }

  if (kitName !== undefined) {
    if (!String(kitName).trim()) {
      res.status(400);
      throw new Error("Kit name is required");
    }
    template.kitName = String(kitName).trim();
  }
  if (kitCode !== undefined) template.kitCode = String(kitCode).trim().toUpperCase();
  if (revision !== undefined) template.revision = String(revision).trim().toUpperCase();
  if (description !== undefined) template.description = String(description).trim();
  if (isActive !== undefined) template.isActive = !!isActive;

  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400);
      throw new Error("A kit template needs at least one item");
    }
    try {
      const cleaned = items.map(sanitizeItem);
      assertNoDuplicateParts(cleaned);
      template.items = cleaned;
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }
  }

  await template.save();
  const resolved = await withResolvedItems(template);
  resolved.hasIssues = !!(await KitIssue.exists({ kitTemplate: template._id }));
  res.json(resolved);
});

// DELETE /api/kits/:id  (admin only — kit.manage)
// Past issues keep their own snapshot (kitName/kitCode/lines), so deleting
// a template never rewrites or hides history that already happened.
export const deleteKitTemplate = asyncHandler(async (req, res) => {
  const template = await KitTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("Kit template not found");
  }
  await template.deleteOne();
  res.json({ message: "Kit template deleted", _id: template._id });
});

// POST /api/kits/import/parse  (multipart, field name "file") — admin only, read-only
export const parseKitImport = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("Attach the kit / BOM workbook (.xlsx or .xls)");
  }

  let parsed;
  try {
    const wb = xlsx.read(req.file.buffer, { type: "buffer" });
    parsed = parseKitWorkbook(wb, { sheetName: req.body.sheetName || undefined });
  } catch (err) {
    res.status(400);
    throw new Error(`Could not read that spreadsheet: ${err.message}`);
  }

  const byCode = await resolvePartsByCode(parsed.rows);
  const rows = parsed.rows.map((r) => ({
    ...r,
    matchedPart: r.ttUniquePartNumber ? byCode.get(r.ttUniquePartNumber) || null : null,
  }));

  res.json({ ...parsed, rows });
});

// GET /api/kits/:id/issues — issue history for one template (by snapshot kitTemplate ref)
// Saved drafts aren't "history" yet, so this only ever shows kits that
// have actually been issued — see getKitDrafts for the saved-but-not-yet-
// issued half.
export const getIssuesForTemplate = asyncHandler(async (req, res) => {
  // Same template OR same kit code, so a kit issued again under the same
  // code (even from a re-created template) still shows what went out before.
  const template = await KitTemplate.findById(req.params.id).select("kitCode");
  const filter = sameKitIssuedFilter({ kitTemplate: req.params.id, kitCode: template?.kitCode });
  const issues = await KitIssue.find(filter || { kitTemplate: req.params.id, status: "issued" })
    .populate("vendor", "companyName")
    .sort({ createdAt: -1 });
  const plain = issues.map((i) => i.toObject());
  await attachEditLock(plain);
  await attachPreviouslyIssued(plain);
  res.json(plain);
});

// GET /api/kits/issues?vendor=&kit=&limit=  — all ISSUED kit issues,
// newest first. Saved drafts live under GET /api/kits/drafts instead, so
// the "Issued kits" and "Saved kits" halves of the history never mix.
export const getKitIssues = asyncHandler(async (req, res) => {
  const filter = { status: "issued" };
  if (req.query.vendor) filter.vendor = req.query.vendor;
  if (req.query.kit) filter.kitTemplate = req.query.kit;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  const issues = await KitIssue.find(filter)
    .populate("vendor", "companyName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit")
    .sort({ createdAt: -1 })
    .limit(limit);
  const plain = issues.map((i) => i.toObject());
  await attachEditLock(plain);
  await attachPreviouslyIssued(plain);
  res.json(plain);
});

// GET /api/kits/issues/:id/export
// Downloads ONE issued kit as a formatted .xlsx "material issue slip": who
// it was issued to, who issued it, when, and every material that went out
// (part, description, qty per kit / required / issued / short, FIFO
// batches), with totals and signature lines. Only the kit asked for —
// there is deliberately no "export everything" endpoint.
export const exportKitIssueById = asyncHandler(async (req, res) => {
  const issue = await KitIssue.findById(req.params.id)
    .populate("vendor", "companyName address phone email contactPersonName taxRegistrationNo")
    .populate("lines.part", "itemDescription");
  if (!issue || issue.status !== "issued") {
    res.status(404);
    throw new Error("Kit issue not found");
  }
  const iss = issue.toObject();
  await attachPreviouslyIssued([iss]); // adds line.qtyPreviouslyIssued (earlier entries of this kit)
  const v = iss.vendor || {};
  const lines = iss.lines || [];

  // The issue time is written as fixed text (India time, same look as the
  // on-screen table) taken from the timestamp stored on the record — not as
  // an Excel date cell — so nothing in Excel can ever re-evaluate it.
  const fmtIst = (d) =>
    d
      ? new Date(d).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : "—";
  const batchText = (b = []) =>
    b.length ? b.map((x) => `${x.batchCode || "No batch"}: ${x.quantity}`).join(", ") : "";

  const THIN = { style: "thin", color: { argb: "FF9CA3AF" } };
  const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  const NAVY = "FF1F3A5F";
  const LAST_COL = 11; // K

  const wb = new ExcelJS.Workbook();
  wb.creator = "Inventory Platform";
  wb.created = new Date();
  const ws = wb.addWorksheet("Issued Kit", {
    pageSetup: {
      orientation: "landscape",
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  ws.columns = [
    { width: 7 }, // A  S.No
    { width: 20 }, // B  TT part no
    { width: 42 }, // C  description
    { width: 20 }, // D  ref designator
    { width: 10 }, // E  qty / kit
    { width: 13 }, // F  required
    { width: 12 }, // G  previously issued
    { width: 12 }, // H  issued
    { width: 11 }, // I  short
    { width: 18 }, // J  status tag
    { width: 32 }, // K  batches
  ];

  // ---- Title ----
  ws.mergeCells("C1:K1");
  ws.getCell("C1").value = "TECHNOTRENDZ INNOVATIVE SOLUTIONS PVT. LTD";
  ws.getCell("C1").font = { bold: true, size: 14 };
  ws.getCell("C1").alignment = { vertical: "middle", horizontal: "center" };
  ws.mergeCells("C2:K2");
  ws.getCell("C2").value = "KIT ISSUE SLIP — MATERIAL ISSUED";
  ws.getCell("C2").font = { bold: true, size: 12, color: { argb: NAVY } };
  ws.getCell("C2").alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 26;
  ws.getRow(3).height = 16;
  if (fs.existsSync(LOGO_PATH)) {
    const imageId = wb.addImage({ filename: LOGO_PATH, extension: "jpeg" });
    ws.addImage(imageId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 70, height: 72 } });
  }

  // ---- Details block: label (A:B) + value (C:K) ----
  const contact = [v.contactPersonName, v.phone].filter(Boolean).join(" · ");
  const details = [
    ["Kit", iss.kitName],
    ["Kit Code", iss.kitCode || "—"],
    ["Issue Code", iss.issueCode || "—"],
    ["Issued To (Vendor)", v.companyName || "—"],
    v.address ? ["Vendor Address", v.address] : null,
    contact ? ["Vendor Contact", contact] : null,
    v.taxRegistrationNo ? ["Vendor GSTIN / Tax No", v.taxRegistrationNo] : null,
    ["Issued By (Person)", iss.issuedBy || "—"],
    ["Issued On", fmtIst(iss.createdAt)],
    ["Kits Issued", iss.quantity],
    ["Shortage", iss.hasShortage ? "Yes — some parts were issued short (see Qty Short)" : "No"],
    iss.revertedAt ? ["Reverted", `Whole kit reverted to stock on ${fmtIst(iss.revertedAt)}${iss.revertedBy ? ` by ${iss.revertedBy}` : ""}`] : null,
    iss.remarks ? ["Remarks", iss.remarks] : null,
  ].filter(Boolean);

  for (const [label, value] of details) {
    const row = ws.addRow([]);
    const r = row.number;
    ws.mergeCells(`A${r}:B${r}`);
    ws.mergeCells(`C${r}:K${r}`);
    const l = ws.getCell(`A${r}`);
    l.value = label;
    l.font = { bold: true };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F7" } };
    l.alignment = { vertical: "middle" };
    const val = ws.getCell(`C${r}`);
    val.value = value;
    val.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    for (let c = 1; c <= LAST_COL; c += 1) ws.getCell(r, c).border = BOX;
    if (label === "Vendor Address" || label === "Remarks") row.height = 32;
  }
  ws.addRow([]);

  // ---- Materials table ----
  ws.addRow(["MATERIALS ISSUED"]).font = { bold: true, color: { argb: NAVY } };
  const header = ws.addRow([
    "S.No",
    "TT Part No",
    "Description",
    "Ref. Designator",
    "Qty / Kit",
    "Qty Required",
    "Prev. Issued",
    "Qty Issued",
    "Qty Short",
    "Status",
    "Batches (FIFO)",
  ]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 24;
  for (let c = 1; c <= LAST_COL; c += 1) header.getCell(c).border = BOX;

  // Colour coding — same rules as the on-screen kit preview:
  //   SHORT       (red)    some of the part is still missing
  //   OVER-ISSUE  (yellow) earlier issues + this one are ABOVE what is required
  //   COMPLETED   (green)  earlier issues + this one reach what is required
  const PALETTE = {
    short: { fill: "FFFECACA", text: "FFB91C1C" },
    over: { fill: "FFFEF08A", text: "FF92400E" },
    completed: { fill: "FFBBF7D0", text: "FF166534" },
    reverted: { fill: "FFE5E7EB", text: "FF374151" },
  };
  const rnd = (n) => Math.round((Number(n) || 0) * 1e4) / 1e4;
  // A part sitting on several lines is judged on the combined figures.
  const totalsByPart = new Map();
  for (const ln of lines) {
    const t = totalsByPart.get(ln.ttUniquePartNumber) || { required: 0, issued: 0 };
    t.required += Number(ln.qtyRequired) || 0;
    t.issued += Number(ln.qtyIssued) || 0;
    totalsByPart.set(ln.ttUniquePartNumber, t);
  }
  const statusOf = (ln) => {
    const prev = Number(ln.qtyPreviouslyIssued) || 0;
    const t = totalsByPart.get(ln.ttUniquePartNumber) || { required: 0, issued: 0 };
    const over = rnd(prev + t.issued - t.required);
    if ((Number(ln.qtyShort) || 0) > 0) return { kind: "short", tag: `SHORT ${ln.qtyShort}` };
    if (t.required > 0 && over > 1e-9) return { kind: "over", tag: `OVER-ISSUE +${over}` };
    if (t.required > 0 && prev + t.issued >= t.required - 1e-9) return { kind: "completed", tag: "COMPLETED" };
    if ((Number(ln.qtyReverted) || 0) > 0 && !(Number(ln.qtyIssued) > 0)) return { kind: "reverted", tag: "REVERTED" };
    return null;
  };

  const firstDataRow = header.number + 1;
  lines.forEach((ln, i) => {
    const st = statusOf(ln);
    const row = ws.addRow([
      i + 1,
      ln.ttUniquePartNumber || "",
      ln.part?.itemDescription || ln.itemDescription || "",
      ln.referenceDesignator || "",
      ln.qtyPerKit,
      ln.qtyRequired,
      ln.qtyPreviouslyIssued || 0,
      ln.qtyIssued,
      ln.qtyShort || 0,
      st ? st.tag : "",
      batchText(ln.batchBreakdown),
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    [1, 5, 6, 7, 8, 9, 10].forEach((c) => {
      row.getCell(c).alignment = { vertical: "top", horizontal: "center", wrapText: true };
    });
    for (let c = 1; c <= LAST_COL; c += 1) row.getCell(c).border = BOX;
    if (st) {
      const { fill, text } = PALETTE[st.kind];
      for (let c = 1; c <= LAST_COL; c += 1) {
        row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      }
      row.getCell(10).font = { bold: true, color: { argb: text } };
      if (st.kind === "short") row.getCell(9).font = { bold: true, color: { argb: text } };
    }
  });
  const lastDataRow = header.number + lines.length;

  if (lines.length === 0) {
    const r = ws.addRow(["This issue has no lines."]).number;
    ws.mergeCells(`A${r}:K${r}`);
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  } else {
    const sum = (key) => {
      if (key === "qtyPreviouslyIssued") {
        // Earlier-issued is a per-PART figure: count it once even if the part is on several lines.
        const seen = new Set();
        return lines.reduce((t, l) => {
          if (seen.has(l.ttUniquePartNumber)) return t;
          seen.add(l.ttUniquePartNumber);
          return t + (Number(l.qtyPreviouslyIssued) || 0);
        }, 0);
      }
      return lines.reduce((t, l) => t + (Number(l[key]) || 0), 0);
    };
    const tot = ws.addRow([]);
    const r = tot.number;
    ws.mergeCells(`A${r}:E${r}`);
    ws.getCell(`A${r}`).value = "Total";
    ws.getCell(`A${r}`).alignment = { horizontal: "right" };
    [
      ["F", "qtyRequired"],
      ["G", "qtyPreviouslyIssued"],
      ["H", "qtyIssued"],
      ["I", "qtyShort"],
    ].forEach(([col, key]) => {
      ws.getCell(`${col}${r}`).value =
        key === "qtyPreviouslyIssued"
          ? sum(key)
          : {
              formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})`,
              result: sum(key),
            };
      ws.getCell(`${col}${r}`).alignment = { horizontal: "center" };
    });
    tot.font = { bold: true };
    tot.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F7" } };
    for (let c = 1; c <= LAST_COL; c += 1) tot.getCell(c).border = BOX;
  }

  // ---- Colour key ----
  if (lines.length) {
    ws.addRow([]);
    const keyRow = ws.addRow([]);
    const kr = keyRow.number;
    ws.mergeCells(`A${kr}:B${kr}`);
    ws.getCell(`A${kr}`).value = "Colour key";
    ws.getCell(`A${kr}`).font = { bold: true };
    [
      [3, "COMPLETED — earlier issues + this issue reach the required qty", PALETTE.completed],
      [6, "OVER-ISSUE — more issued than required", PALETTE.over],
      [9, "SHORT — part of the required qty is missing", PALETTE.short],
    ].forEach(([col, text, pal]) => {
      const c = keyRow.getCell(col);
      c.value = text;
      c.font = { bold: true, size: 9, color: { argb: pal.text } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pal.fill } };
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      c.border = BOX;
    });
    ws.mergeCells(`C${kr}:E${kr}`);
    ws.mergeCells(`F${kr}:H${kr}`);
    ws.mergeCells(`I${kr}:K${kr}`);
    keyRow.height = 30;
  }

  // ---- Signature lines ----
  ws.addRow([]);
  ws.addRow([]);
  const sig = ws.addRow([]);
  const sr = sig.number;
  ws.mergeCells(`A${sr}:C${sr}`);
  ws.mergeCells(`F${sr}:K${sr}`);
  ws.getCell(`A${sr}`).value = `Issued By: ${iss.issuedBy || ""}`;
  ws.getCell(`F${sr}`).value = "Received By (Name & Signature):";
  for (const c of [1, 2, 3, 6, 7, 8, 9, 10, 11]) {
    sig.getCell(c).border = { top: THIN };
  }
  sig.font = { bold: true };

  const base = String(iss.issueCode || iss.kitName || "kit").replace(/[^A-Za-z0-9._-]+/g, "_");
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="kit-issue-${base}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// GET /api/kits/issues/:id
export const getKitIssueById = asyncHandler(async (req, res) => {
  const issue = await KitIssue.findById(req.params.id)
    .populate("vendor")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit");
  if (!issue || issue.status !== "issued") {
    res.status(404);
    throw new Error("Kit issue not found");
  }
  const plain = issue.toObject();
  await attachEditLock(plain);
  await attachPreviouslyIssued([plain]);
  res.json(plain);
});

/*
  POST /api/kits/:id/issue
  Body: { quantity, vendor, issuedBy, remarks, lines? }
  `lines` (optional): [{ ttUniquePartNumber, qtyIssued }, ...] — lets the
  user hand-enter the actual quantity being issued for one or more items
  instead of accepting the auto-computed min(available, required). Any
  item not named in `lines` falls back to the old auto behaviour.

  Re-resolves every non-DNP item against the live parts master by
  ttUniquePartNumber and issues the kit regardless of stock levels — a
  short or missing part no longer blocks the whole kit. Each line deducts
  either the user-entered qty (capped at available stock) or, absent an
  override, whatever stock is actually available (down to zero, never
  negative), and records qtyRequired / qtyIssued / qtyShort, so any
  shortage is captured as part of the kit issue's own history rather than
  rejecting the request outright. `hasShortage` on the issue and
  `shortage` in the response flag whether anything was short, for the UI
  to surface.
*/
export const issueKit = asyncHandler(async (req, res) => {
  const { quantity, vendor, issuedBy, remarks, lines: overrideLines } = req.body;
  const requestedCode = cleanIssueCode(req.body.issueCode);

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
    res.status(400);
    throw new Error("Quantity must be a whole number of at least 1");
  }
  if (!vendor) {
    res.status(400);
    throw new Error("Select the vendor this kit is being issued to");
  }

  const template = await KitTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("Kit template not found");
  }
  if (!template.isActive) {
    res.status(400);
    throw new Error("This kit template has been deactivated by the admin and can no longer be issued");
  }

  const vendorDoc = await Vendor.findById(vendor);
  if (!vendorDoc) {
    res.status(404);
    throw new Error("Vendor not found");
  }
  if ((vendorDoc.activeStatus || "active") === "inactive") {
    res.status(400);
    throw new Error(`${vendorDoc.companyName} has been marked inactive — cannot issue a kit to them`);
  }

  const items = issuableItems(template.items);
  if (items.length === 0) {
    res.status(400);
    throw new Error("This kit template has no issuable (non-DNP) items");
  }

  // The code comes from the template's kit code (KIT_05, then KIT_05-2 …
  // if the same template is issued again from scratch) unless the person
  // typed their own. Settled BEFORE any stock is deducted so a clash is
  // refused cleanly. Edits grow "-A", "-B" off this code (see issueKitDraft).
  await assertIssueCodeFree(res, requestedCode);
  const issueCode = requestedCode || (await suggestRootIssueCode(template));

  let resolvedLines, shortages;
  try {
    ({ resolvedLines, shortages } = await resolveAndDeductLines(items, qty, overrideLines));
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  const issue = await KitIssue.create({
    status: "issued",
    kitTemplate: template._id,
    kitName: template.kitName,
    kitCode: template.kitCode,
    issueCode,
    editIndex: 0,
    quantity: qty,
    vendor: vendorDoc._id,
    issuedBy: issuedBy || req.user?.name || req.user?.username || "",
    issuedByUser: req.user?._id || null,
    remarks: remarks || "",
    hasShortage: shortages.length > 0,
    lines: linesPayloadFrom(resolvedLines),
  });

  const populated = await KitIssue.findById(issue._id)
    .populate("vendor", "companyName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit");

  res.status(201).json({
    ...populated.toObject(),
    isEditable: true, // brand new — nothing has been edited from it yet
    message:
      shortages.length > 0
        ? `Issued ${qty} × "${template.kitName}" as ${issueCode} — ${shortages.length} part(s) were short and only partially deducted`
        : `Issued ${qty} × "${template.kitName}" as ${issueCode}`,
    shortages,
  });
});

/*
  POST /api/kits/issues/:issueId/edit
  Body: { quantity, vendor?, remarks, lines?, extraItems? } — `lines`:
  [{ ttUniquePartNumber, qtyIssued }, ...] (same shape as POST
  /api/kits/:id/issue). `extraItems` (optional): [{ ttUniquePartNumber,
  referenceDesignator? }, ...] — parts to add that weren't on the original
  issue (or the current template); the quantity for each still comes
  through `lines`.

  Editing an issued kit now SAVES the edited version as a saved kit (a
  draft) — nothing is deducted from stock and no issue code is used up.
  The person then issues it from the "Saved kits" tab
  (POST /api/kits/drafts/:draftId/issue), which is where the stock is
  deducted and the entry gets the next code in this issue's edit series
  ("Kit 1" -> "Kit 1A" -> "Kit 1B", ... — see issueKitDraft).

  Never touches the issue that's being "edited" — it stays exactly as it
  was, permanent history — and it only becomes locked once the edit is
  actually ISSUED (see attachEditLock), so discarding the saved edit
  leaves it editable as before. Only the entry at the head of its chain may
  be edited, and only one saved edit per entry can be waiting at a time.
*/
export const editKitIssue = asyncHandler(async (req, res) => {
  const { issueId } = req.params;
  const { quantity, vendor, remarks, lines: overrideLines, extraItems } = req.body;
  const requestedCode = cleanIssueCode(req.body.issueCode);
  const editMode = cleanEditMode(req.body.editMode);

  const original = await KitIssue.findById(issueId);
  if (!original || original.status !== "issued") {
    res.status(404);
    throw new Error("Kit issue not found");
  }

  // Once an edit has been ISSUED from this entry (Kit 1 -> Kit 1A, Kit 1A
  // -> Kit 1B, ...), this entry is permanently superseded — it stays as
  // untouched history and can only be viewed from here on. Only the
  // current head of the chain can be edited further.
  const alreadySuperseded = await KitIssue.exists({ editedFrom: original._id, status: "issued" });
  if (alreadySuperseded) {
    res.status(400);
    throw new Error(
      `${original.issueCode || original.kitName} has already been edited and is now locked — only its latest edit can be edited further. You can still view this entry.`
    );
  }

  // One saved edit at a time per entry, so two people can't end up with
  // competing versions of the same kit.
  const waiting = await KitIssue.exists({ editedFrom: original._id, status: "draft" });
  if (waiting) {
    res.status(400);
    throw new Error(
      `A saved edit of ${original.issueCode || original.kitName} is already waiting in the Saved kits tab — open it from there to keep editing or issue it, or discard it first.`
    );
  }

  // Always count from the start of the chain, not from whichever entry
  // was clicked.
  const rootId = original.rootIssue || original._id;
  const rootDoc = original.rootIssue ? await KitIssue.findById(rootId) : original;
  if (!rootDoc) {
    res.status(404);
    throw new Error("The original kit issue in this series could not be found");
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
    res.status(400);
    throw new Error("Quantity must be a whole number of at least 1");
  }
  await assertIssueCodeFree(res, requestedCode);

  let vendorDoc = null;
  if (vendor) {
    vendorDoc = await Vendor.findById(vendor);
    if (!vendorDoc) {
      res.status(404);
      throw new Error("Vendor not found");
    }
  }

  // Prefer the live template (so this edit picks up any item / qty-per-kit
  // changes made since the original was issued); fall back to the
  // original issue's own snapshot lines if the template has since been
  // deleted, so an edit is still possible even then. (Whether the template
  // is still active is checked when the saved kit is actually issued.)
  let items = null;
  if (original.kitTemplate) {
    const template = await KitTemplate.findById(original.kitTemplate);
    if (template) items = issuableItems(template.items);
  }
  if (!items || items.length === 0) {
    items = (original.lines || []).map((l) => ({
      ttUniquePartNumber: l.ttUniquePartNumber,
      referenceDesignator: l.referenceDesignator,
      qtyPerKit: l.qtyPerKit,
      value: l.itemDescription,
    }));
  }
  // Parts added to the original by an earlier edit, plus any added now —
  // stored with qtyPerKit: 0 so they never inflate `required` for the kit's
  // normal per-kit math; the quantity comes through `lines`.
  items = withExtraItems(items, original.lines, extraItems);

  if (items.length === 0) {
    res.status(400);
    throw new Error("This kit has no issuable items to save");
  }

  // Preview only — nothing is deducted until the saved kit is issued.
  const { resolvedLines, shortages } = await resolveDraftLines(
    items,
    qty,
    withSavedExtraQty(overrideLines, original.lines),
    editMode === "partial" ? await previousTotalsFor(original._id) : null
  );

  const draft = await KitIssue.create({
    status: "draft",
    kitTemplate: original.kitTemplate,
    kitName: original.kitName,
    kitCode: original.kitCode,
    // Only set when the person typed their own code; otherwise the next
    // "-A" / "-B" code is assigned when this is issued. editIndex too.
    issueCode: requestedCode,
    rootIssue: rootDoc._id,
    editedFrom: original._id,
    editMode,
    quantity: qty,
    vendor: vendorDoc ? vendorDoc._id : original.vendor || null,
    issuedBy: req.user?.name || req.user?.username || "",
    issuedByUser: req.user?._id || null,
    remarks: remarks || "",
    hasShortage: shortages.length > 0,
    lines: linesPayloadFrom(resolvedLines),
  });

  const populated = await KitIssue.findById(draft._id)
    .populate("vendor", "companyName")
    .populate("editedFrom", "issueCode kitName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit");

  res.status(201).json({
    ...populated.toObject(),
    message: `Saved your edit of ${original.issueCode || original.kitName} — open the Saved kits tab to issue it (nothing is deducted until then)`,
    shortages,
  });
});

/*
  GET /api/kits/issues/:id/previous-quantities
  For the "Edit kit issue" screen: per-part quantities already issued
  across EVERY earlier version of this kit's edit chain, not just the one
  entry being edited from. Kit 1 -> Kit 1A -> Kit 1B: editing Kit 1A
  towards a new Kit 1B should show Kit 1's qty PLUS Kit 1A's qty, not
  Kit 1A alone.

  `id` may be either an ISSUED entry (about to be edited into a new
  version — the normal case) or a DRAFT (a saved-but-not-yet-issued edit
  being revisited from the Saved kits tab). A draft hasn't deducted
  anything itself, so its baseline is whatever the entry it was created
  FROM (editedFrom) already accounts for — identical to what re-opening
  that entry directly would show.

  Walks the chain via rootIssue + editIndex (see KitIssue.js) rather than
  editedFrom alone, so it totals the whole history in one query instead of
  hopping one parent at a time.

  Responds { chain, kit }, each a { ttUniquePartNumber: qty } map:
    chain - this edit chain only (what a PARTIAL edit measures shortages by)
    kit   - everything issued of the same kit (same template or same kit
            code), i.e. the "Prev. issued" column
*/
export const getKitIssueChainTotals = asyncHandler(async (req, res) => {
  const entry = await KitIssue.findById(req.params.id).select(
    "status editedFrom rootIssue editIndex kitTemplate kitCode"
  );
  if (!entry) {
    res.status(404);
    throw new Error("Kit issue not found");
  }

  // chain: this entry's own edit chain (root + edits up to the entry being
  // edited) — the basis for measuring a PARTIAL edit's shortages. A draft
  // made from scratch (never edited from an issued entry) has no chain.
  const baseId = entry.status === "draft" ? entry.editedFrom : entry._id;
  const chain = baseId ? Object.fromEntries(await previousTotalsFor(baseId)) : {};

  // kit: EVERYTHING already issued of this kit — every earlier issue and its
  // edits, any vendor — matched by template or kit code. This is what the
  // "Prev. issued" column shows, so a fresh issue made against the same kit
  // code is counted too, not just the edits of one chain.
  const kitFilter = sameKitIssuedFilter(entry);
  const kit = kitFilter
    ? sumIssuedByPart(await KitIssue.find(kitFilter).select("lines.ttUniquePartNumber lines.qtyIssued").lean())
    : {};
  // The chain is always part of the kit; guard against a chain entry the
  // template / code match could not see.
  for (const [part, qty] of Object.entries(chain)) {
    if ((kit[part] || 0) < qty) kit[part] = qty;
  }

  res.json({ chain, kit });
});

/*
  DELETE /api/kits/issues/:issueId/lines/:lineId
  Reverts one line of one kit issue — restores the deducted quantity to the
  part and removes the line. Used from the Part history ledger's "undo"
  action, mirroring how a stock-entry receipt line can be deleted there.
*/
export const deleteKitIssueLine = asyncHandler(async (req, res) => {
  const { issueId, lineId } = req.params;
  const issue = await KitIssue.findById(issueId);
  if (!issue) {
    res.status(404);
    throw new Error("Kit issue not found");
  }
  const line = issue.lines.id(lineId);
  if (!line) {
    res.status(404);
    throw new Error("Kit issue line not found");
  }

  const partDoc = await Part.findById(line.part);
  if (partDoc) {
    partDoc.quantityInStock = qr(partDoc.quantityInStock + Number(line.qtyIssued || 0));
    await partDoc.save();
  }

  line.deleteOne();
  await issue.save();

  res.json({ message: "Kit issue line reverted — stock restored", issueId: issue._id, lineId, partId: partDoc?._id });
});

/*
  Revert stock from an ISSUED kit — put parts back into main stock.

    GET  /api/kits/issues/:issueId/revertable
         -> per line, how much can still be reverted (issued, less anything the
            vendor has already sent back through Receive material).
    POST /api/kits/issues/:issueId/revert
         body { all?: true, lines?: [{ lineId, quantity? }], reason? }
         Pick any number of lines — or `all` — and an optional quantity per
         line (default: everything still revertable on it).

  For every reverted line: Part.quantityInStock goes up by the quantity, the
  line's qtyIssued goes down by it (so batch balances, "previously issued" and
  completion all recompute correctly) and the revert is recorded on the line.
*/
const roundQ = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Max revertable per line: issued less what the vendor already returned, per part, in line order. */
async function revertCaps(issue) {
  const returned = await returnedMap([issue._id]);
  const freeByPart = new Map();
  for (const l of issue.lines || []) {
    if (!l.part) continue;
    const key = String(l.part);
    freeByPart.set(key, (freeByPart.get(key) ?? 0) + (l.qtyIssued || 0));
  }
  for (const [key, total] of freeByPart) {
    freeByPart.set(key, Math.max(0, roundQ(total - (returned.get(`${issue._id}|${key}`) || 0))));
  }
  const caps = new Map(); // lineId -> { max, returned }
  for (const l of issue.lines || []) {
    if (!l.part || !(l.qtyIssued > 0)) {
      caps.set(String(l._id), { max: 0, returned: 0 });
      continue;
    }
    const key = String(l.part);
    const free = freeByPart.get(key) || 0;
    const max = Math.min(l.qtyIssued, free);
    freeByPart.set(key, roundQ(free - max));
    caps.set(String(l._id), { max: roundQ(max), returned: roundQ(l.qtyIssued - max) });
  }
  return caps;
}

export const getKitIssueRevertable = asyncHandler(async (req, res) => {
  const issue = await KitIssue.findById(req.params.issueId);
  if (!issue) {
    res.status(404);
    throw new Error("Kit issue not found");
  }
  const caps = await revertCaps(issue);
  res.json({
    status: issue.status,
    lines: (issue.lines || []).map((l) => ({
      lineId: l._id,
      maxRevert: caps.get(String(l._id))?.max || 0,
      alreadyReturned: caps.get(String(l._id))?.returned || 0,
    })),
  });
});

export const revertKitIssueStock = asyncHandler(async (req, res) => {
  const { issueId } = req.params;
  const { all = false, lines: requested = [], reason = "" } = req.body || {};

  const issue = await KitIssue.findById(issueId);
  if (!issue) {
    res.status(404);
    throw new Error("Kit issue not found");
  }
  if (issue.status !== "issued") {
    res.status(400);
    throw new Error("Only an issued kit can have its stock reverted — a saved kit has not deducted anything");
  }

  const caps = await revertCaps(issue);

  // Work out what to revert: [{ line, qty }]
  const plan = [];
  if (all) {
    for (const l of issue.lines) {
      const max = caps.get(String(l._id))?.max || 0;
      if (max > 0) plan.push({ line: l, qty: max });
    }
  } else {
    if (!Array.isArray(requested) || requested.length === 0) {
      res.status(400);
      throw new Error("Select at least one part to revert");
    }
    const seen = new Set();
    for (const r of requested) {
      const line = issue.lines.id(r.lineId);
      if (!line) {
        res.status(404);
        throw new Error("One of the selected lines is not on this kit issue");
      }
      if (seen.has(String(line._id))) continue;
      seen.add(String(line._id));
      const max = caps.get(String(line._id))?.max || 0;
      const qty = r.quantity === undefined || r.quantity === null || r.quantity === "" ? max : roundQ(r.quantity);
      if (!(qty > 0)) {
        res.status(400);
        throw new Error(`Enter a quantity above 0 for ${line.ttUniquePartNumber}`);
      }
      if (qty > max + 1e-6) {
        res.status(400);
        throw new Error(
          max > 0
            ? `${line.ttUniquePartNumber}: only ${max} can be reverted (${line.qtyIssued} issued${
                line.qtyIssued > max ? `, ${roundQ(line.qtyIssued - max)} already returned by the vendor` : ""
              })`
            : `${line.ttUniquePartNumber}: nothing left to revert`
        );
      }
      plan.push({ line, qty });
    }
  }
  if (plan.length === 0) {
    res.status(400);
    throw new Error("Nothing to revert — no part on this issue has stock left to put back");
  }

  const at = new Date();
  const by = req.user?.name || req.user?.username || "";
  const stockBack = new Map(); // partId -> qty
  const done = [];

  for (const { line, qty } of plan) {
    // Put the quantity back into the batch(es) it was drawn from, most recently
    // drawn first, so the older batches stay as consumed as they were.
    let left = qty;
    const takenBack = [];
    const bd = (line.batchBreakdown || []).map((b) => ({ batchCode: b.batchCode ?? null, quantity: b.quantity }));
    for (let i = bd.length - 1; i >= 0 && left > 1e-9; i -= 1) {
      const take = Math.min(bd[i].quantity, left);
      if (take > 0) {
        takenBack.push({ batchCode: bd[i].batchCode, quantity: roundQ(take) });
        bd[i].quantity = roundQ(bd[i].quantity - take);
        left = roundQ(left - take);
      }
    }
    line.batchBreakdown = bd.filter((b) => b.quantity > 1e-9);
    line.qtyIssued = qr(Math.max(0, (line.qtyIssued || 0) - qty));
    line.qtyReverted = qr((line.qtyReverted || 0) + qty);
    line.reverts.push({
      quantity: qty,
      at,
      by,
      byUser: req.user?._id || null,
      reason: String(reason || "").trim().slice(0, 300),
      batchBreakdown: takenBack,
    });

    if (line.part) stockBack.set(String(line.part), qr((stockBack.get(String(line.part)) || 0) + qty));
    done.push({ lineId: line._id, ttUniquePartNumber: line.ttUniquePartNumber, quantity: qty });
  }

  // Everything that was issued is now back in stock -> mark the whole kit Reverted.
  const fullyReverted =
    issue.lines.every((l) => !(l.qtyIssued > 1e-9)) &&
    issue.lines.some((l) => (l.qtyReverted || 0) > 0);
  if (fullyReverted) {
    issue.revertedAt = at;
    issue.revertedBy = by;
    issue.revertedByUser = req.user?._id || null;
  }

  // Save the issue first (validated), then credit the stock.
  await issue.save();
  for (const [partId, qty] of stockBack) {
    await Part.updateOne({ _id: partId }, { $inc: { quantityInStock: qty } });
  }

  const total = qr(done.reduce((s, d) => s + d.quantity, 0));
  res.json({
    message: fullyReverted
      ? `Kit reverted — ${done.length} part${done.length === 1 ? "" : "s"} (${total} unit${total === 1 ? "" : "s"}) back in stock`
      : `Reverted ${done.length} part${done.length === 1 ? "" : "s"} (${total} unit${total === 1 ? "" : "s"}) — stock restored`,
    issueId: issue._id,
    fullyReverted,
    reverted: done,
    totalQuantity: total,
  });
});

/* ===================================================================== *
 * Saved (draft) kit issues
 *
 * Issuing a kit can take 10-14 days in practice — waiting on stock,
 * approvals, whatever — so a kit doesn't have to be finished in one
 * sitting. Saving creates (or updates) a KitIssue with status: "draft":
 * nothing is deducted from stock, and the SAME document is simply
 * overwritten on every subsequent save (unlike editing an already-issued
 * kit, which always chains a new entry — there's nothing to preserve the
 * history of yet, since nothing irreversible has happened). Only the
 * final "Issue" step deducts stock for real and turns the draft into a
 * normal, permanent kit issue.
 * ===================================================================== */

// POST /api/kits/:id/draft
// Body: { quantity?, vendor?, remarks?, lines? } — all optional; a draft
// can be saved with only a template chosen and nothing else filled in
// yet.
export const saveKitDraft = asyncHandler(async (req, res) => {
  const { quantity, vendor, remarks, lines: overrideLines } = req.body;
  const requestedCode = cleanIssueCode(req.body.issueCode);
  await assertIssueCodeFree(res, requestedCode);

  const template = await KitTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("Kit template not found");
  }

  const items = issuableItems(template.items);
  if (items.length === 0) {
    res.status(400);
    throw new Error("This kit template has no issuable (non-DNP) items");
  }

  let vendorDoc = null;
  if (vendor) {
    vendorDoc = await Vendor.findById(vendor);
    if (!vendorDoc) {
      res.status(404);
      throw new Error("Vendor not found");
    }
  }

  const qty = Number(quantity) > 0 ? Number(quantity) : 1;
  const { resolvedLines, shortages } = await resolveDraftLines(items, qty, overrideLines);

  const draft = await KitIssue.create({
    status: "draft",
    kitTemplate: template._id,
    kitName: template.kitName,
    kitCode: template.kitCode,
    issueCode: requestedCode, // blank = auto-assigned when issued
    quantity: qty,
    vendor: vendorDoc ? vendorDoc._id : null,
    issuedBy: req.user?.name || req.user?.username || "",
    issuedByUser: req.user?._id || null,
    remarks: remarks || "",
    hasShortage: shortages.length > 0,
    lines: linesPayloadFrom(resolvedLines),
  });

  const populated = await KitIssue.findById(draft._id)
    .populate("vendor", "companyName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit");

  res.status(201).json({
    ...populated.toObject(),
    message: `Saved progress on "${template.kitName}" — stock untouched until it's issued`,
    shortages,
  });
});

// PATCH /api/kits/drafts/:draftId
// Same body shape as saveKitDraft. Overwrites the draft in place — no new
// document, no stock touched.
export const updateKitDraft = asyncHandler(async (req, res) => {
  const draft = await KitIssue.findById(req.params.draftId);
  if (!draft || draft.status !== "draft") {
    res.status(404);
    throw new Error("Saved kit not found");
  }

  const { quantity, vendor, remarks, lines: overrideLines } = req.body;
  // Only touched when the body carries issueCode: "" clears a custom code
  // (back to auto), a value sets it.
  const codeSent = req.body.issueCode !== undefined;
  const requestedCode = cleanIssueCode(req.body.issueCode);
  if (codeSent) await assertIssueCodeFree(res, requestedCode, draft._id);

  // Prefer the live template (picks up any item/qty-per-kit changes since
  // the draft was last saved); fall back to the draft's own snapshot
  // lines if the template has since been deleted.
  let items = null;
  if (draft.kitTemplate) {
    const template = await KitTemplate.findById(draft.kitTemplate);
    if (template) items = issuableItems(template.items);
  }
  if (!items || items.length === 0) {
    items = (draft.lines || []).map((l) => ({
      ttUniquePartNumber: l.ttUniquePartNumber,
      referenceDesignator: l.referenceDesignator,
      qtyPerKit: l.qtyPerKit,
      value: l.itemDescription,
    }));
  }
  // Carry over parts added to this one kit (and any added right now).
  items = withExtraItems(items, draft.lines, req.body.extraItems);
  if (items.length === 0) {
    res.status(400);
    throw new Error("This kit has no issuable items to save");
  }

  let vendorDoc = null;
  if (vendor) {
    vendorDoc = await Vendor.findById(vendor);
    if (!vendorDoc) {
      res.status(404);
      throw new Error("Vendor not found");
    }
  }

  const qty = Number(quantity) > 0 ? Number(quantity) : 1;
  // Only a saved EDIT has an edit mode; the body may switch it.
  if (draft.editedFrom && req.body.editMode !== undefined) draft.editMode = cleanEditMode(req.body.editMode);
  const { resolvedLines, shortages } = await resolveDraftLines(
    items,
    qty,
    withSavedExtraQty(overrideLines, draft.lines),
    draft.editedFrom && draft.editMode === "partial" ? await previousTotalsFor(draft.editedFrom) : null
  );

  if (codeSent) draft.issueCode = requestedCode;
  draft.quantity = qty;
  draft.vendor = vendorDoc ? vendorDoc._id : null;
  draft.remarks = remarks || "";
  draft.hasShortage = shortages.length > 0;
  draft.lines = linesPayloadFrom(resolvedLines);
  draft.issuedBy = req.user?.name || req.user?.username || draft.issuedBy;
  draft.issuedByUser = req.user?._id || draft.issuedByUser;
  await draft.save();

  const populated = await KitIssue.findById(draft._id)
    .populate("vendor", "companyName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit");

  res.json({
    ...populated.toObject(),
    message: "Saved kit updated",
    shortages,
  });
});

// GET /api/kits/drafts?limit=  — every saved-but-not-yet-issued kit,
// most recently saved first. This is the "Saved kits" half of the issue
// history; GET /api/kits/issues is the "Issued kits" half.
export const getKitDrafts = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const drafts = await KitIssue.find({ status: "draft" })
    .populate("vendor", "companyName")
    .populate("editedFrom", "issueCode kitName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit")
    .sort({ updatedAt: -1 })
    .limit(limit);
  res.json(drafts.map((d) => d.toObject()));
});

// GET /api/kits/drafts/:draftId — full saved kit, for resuming it in the
// issue-kit form (same shape RecentIssues/EditKitIssueDialog already
// expect, since it's the same KitIssue model).
export const getKitDraftById = asyncHandler(async (req, res) => {
  const draft = await KitIssue.findById(req.params.draftId)
    .populate("vendor")
    .populate("editedFrom", "issueCode kitName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit");
  if (!draft || draft.status !== "draft") {
    res.status(404);
    throw new Error("Saved kit not found");
  }
  res.json(draft.toObject());
});

// DELETE /api/kits/drafts/:draftId — discards a saved kit. Safe to delete
// outright since a draft never touches stock, so there's nothing to
// restore.
export const deleteKitDraft = asyncHandler(async (req, res) => {
  const draft = await KitIssue.findById(req.params.draftId);
  if (!draft || draft.status !== "draft") {
    res.status(404);
    throw new Error("Saved kit not found");
  }
  await draft.deleteOne();
  res.json({ message: "Saved kit discarded", _id: draft._id });
});

/*
  POST /api/kits/drafts/:draftId/issue
  Body: { quantity?, vendor?, remarks?, lines? } — anything omitted falls
  back to whatever's already saved on the draft, so "Issue" can be
  clicked straight from the saved-kits list without re-opening the form.

  Commits the draft for real: re-resolves every line against CURRENT live
  stock and deducts it, exactly like POST /api/kits/:id/issue. From this
  point on the entry IS a normal issued kit — it gets the next "Kit N"
  code, can be edited (which chains a new entry and never touches this
  one), and its lines can be reverted, same as any other issued kit.
*/
export const issueKitDraft = asyncHandler(async (req, res) => {
  const { quantity, vendor, remarks, lines: overrideLines } = req.body;

  const draft = await KitIssue.findById(req.params.draftId);
  if (!draft || draft.status !== "draft") {
    res.status(404);
    throw new Error("Saved kit not found");
  }
  // A code sent now wins — an explicit "" means "assign it automatically".
  // Nothing sent (e.g. "Issue now" from the Saved kits list) falls back to
  // the code saved on the draft, if any.
  const requestedCode =
    req.body.issueCode !== undefined
      ? cleanIssueCode(req.body.issueCode)
      : cleanIssueCode(draft.issueCode);

  const qty = Number(quantity ?? draft.quantity);
  if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
    res.status(400);
    throw new Error("Quantity must be a whole number of at least 1");
  }

  const vendorId = vendor || draft.vendor;
  if (!vendorId) {
    res.status(400);
    throw new Error("Select the vendor this kit is being issued to");
  }
  const vendorDoc = await Vendor.findById(vendorId);
  if (!vendorDoc) {
    res.status(404);
    throw new Error("Vendor not found");
  }
  if ((vendorDoc.activeStatus || "active") === "inactive") {
    res.status(400);
    throw new Error(`${vendorDoc.companyName} has been marked inactive — cannot issue a kit to them`);
  }

  let items = null;
  if (draft.kitTemplate) {
    const template = await KitTemplate.findById(draft.kitTemplate);
    if (template) {
      if (!template.isActive) {
        res.status(400);
        throw new Error(
          "This kit template has been deactivated by the admin and can no longer be issued"
        );
      }
      items = issuableItems(template.items);
    }
  }
  if (!items || items.length === 0) {
    items = (draft.lines || []).map((l) => ({
      ttUniquePartNumber: l.ttUniquePartNumber,
      referenceDesignator: l.referenceDesignator,
      qtyPerKit: l.qtyPerKit,
      value: l.itemDescription,
    }));
  }
  // Parts added to this one kit on top of the template (see editKitIssue).
  items = withExtraItems(items, draft.lines);
  if (items.length === 0) {
    res.status(400);
    throw new Error("This kit has no issuable items to issue");
  }

  // Fall back to whatever was last saved on the draft so "Issue" works
  // straight from the saved-kits list, without needing the form open.
  const linesToUse =
    Array.isArray(overrideLines) && overrideLines.length
      ? withSavedExtraQty(overrideLines, draft.lines)
      : draft.lines.map((l) => ({ ttUniquePartNumber: l.ttUniquePartNumber, qtyIssued: l.qtyIssued }));

  // A saved EDIT of an issued kit (made from the edit screen) takes the
  // next code in that kit's edit series when it's issued: Kit 1 -> Kit 1A ->
  // Kit 1B. Checked BEFORE any stock is deducted, so a stale saved edit
  // (its source was already edited and issued another way) is refused
  // cleanly instead of after the fact.
  let editMeta = null;
  if (draft.editedFrom) {
    const supersededElsewhere = await KitIssue.exists({
      editedFrom: draft.editedFrom,
      status: "issued",
      _id: { $ne: draft._id },
    });
    if (supersededElsewhere) {
      res.status(400);
      throw new Error(
        "The kit this edit was made from has since been edited and issued — this saved edit is out of date. Discard it and edit the latest entry instead."
      );
    }
    const rootDoc = await KitIssue.findById(draft.rootIssue || draft.editedFrom);
    if (!rootDoc) {
      res.status(404);
      throw new Error("The original kit issue in this series could not be found");
    }
    // KIT_05 -> KIT_05-A -> KIT_05-B ...
    editMeta = await suggestEditIssueCode(rootDoc);
  }

  // Settle the code BEFORE any stock moves: the person's own code if they
  // gave one, else the next "-A"/"-B" (edit) or the template's kit code.
  await assertIssueCodeFree(res, requestedCode, draft._id);
  let issueCode;
  if (requestedCode) {
    issueCode = requestedCode;
  } else if (editMeta) {
    issueCode = editMeta.issueCode;
  } else {
    // Pull the template's CURRENT kit code; fall back to the snapshot.
    const liveTemplate = draft.kitTemplate
      ? await KitTemplate.findById(draft.kitTemplate).select("kitCode kitName")
      : null;
    issueCode = await suggestRootIssueCode(liveTemplate || draft);
  }

  let resolvedLines, shortages;
  try {
    ({ resolvedLines, shortages } = await resolveAndDeductLines(
      items,
      qty,
      linesToUse,
      draft.editedFrom && draft.editMode === "partial" ? await previousTotalsFor(draft.editedFrom) : null
    ));
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  if (editMeta) draft.editIndex = editMeta.nextIndex;

  draft.status = "issued";
  draft.issueCode = issueCode;
  draft.quantity = qty;
  draft.vendor = vendorDoc._id;
  draft.remarks = remarks !== undefined ? remarks : draft.remarks;
  draft.hasShortage = shortages.length > 0;
  draft.lines = linesPayloadFrom(resolvedLines);
  draft.issuedBy = req.user?.name || req.user?.username || draft.issuedBy;
  draft.issuedByUser = req.user?._id || draft.issuedByUser;
  await draft.save();

  const populated = await KitIssue.findById(draft._id)
    .populate("vendor", "companyName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock unit");

  res.status(200).json({
    ...populated.toObject(),
    isEditable: true, // brand new as an issued entry — nothing edited from it yet
    message:
      shortages.length > 0
        ? `Issued ${qty} × "${draft.kitName}" as ${issueCode} — ${shortages.length} part(s) were short and only partially deducted`
        : editMeta
        ? `Issued ${qty} × "${draft.kitName}" as ${issueCode}, based on ${editMeta.baseCode}`
        : `Issued ${qty} × "${draft.kitName}" as ${issueCode}`,
    shortages,
  });
});

/*
  GET /api/kits/:id/next-code
  The code a fresh issue of this template would get right now (its kit
  code, or KIT_05-A, KIT_05-B … if that is taken) — shown pre-filled, and editable,
  on the Issue-a-kit form.
*/
export const getNextKitIssueCode = asyncHandler(async (req, res) => {
  const template = await KitTemplate.findById(req.params.id).select("kitCode kitName");
  if (!template) {
    res.status(404);
    throw new Error("Kit template not found");
  }
  res.json({ issueCode: await suggestRootIssueCode(template), kitCode: template.kitCode || "" });
});

/*
  GET /api/kits/issues/:issueId/next-edit-code
  The code an edit of this entry would get when issued (KIT_05-A, then
  KIT_05-B …). `issueId` is the issued entry being edited, or a saved edit
  (draft) of it.
*/
export const getNextEditIssueCode = asyncHandler(async (req, res) => {
  const entry = await KitIssue.findById(req.params.issueId).select("status rootIssue editedFrom");
  if (!entry) {
    res.status(404);
    throw new Error("Kit issue not found");
  }
  const rootId = entry.rootIssue || (entry.status === "issued" ? entry._id : entry.editedFrom);
  const rootDoc = rootId ? await KitIssue.findById(rootId) : null;
  if (!rootDoc) {
    res.status(404);
    throw new Error("The original kit issue in this series could not be found");
  }
  const { issueCode, baseCode } = await suggestEditIssueCode(rootDoc);
  res.json({ issueCode, baseCode });
});