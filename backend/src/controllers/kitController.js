import asyncHandler from "express-async-handler";
import xlsx from "xlsx";
import KitTemplate from "../models/KitTemplate.js";
import KitIssue from "../models/KitIssue.js";
import Part from "../models/Part.js";
import Vendor from "../models/Vendor.js";
import { parseKitWorkbook } from "../utils/parseKitSheet.js";

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

// Resolves every ttUniquePartNumber referenced by a set of kit items
// against the live parts master in one query, keyed by code.
async function resolvePartsByCode(items) {
  const codes = [...new Set((items || []).map((it) => it.ttUniquePartNumber).filter(Boolean))];
  if (!codes.length) return new Map();
  const parts = await Part.find({ ttUniquePartNumber: { $in: codes } }).select(
    "ttUniquePartNumber itemDescription quantityInStock"
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
async function resolveAndDeductLines(items, qty, overrideLines) {
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
  for (const item of items) {
    const partDoc = byCode.get(item.ttUniquePartNumber);
    const required = item.qtyPerKit * qty;
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
    const short = Math.max(0, required - toDeduct);

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

    resolvedLines.push({ item, partDoc, required, toDeduct, short });
  }

  // Deduct whatever's available for every line — nothing to deduct for a
  // line whose part isn't in the master at all.
  for (const { partDoc, toDeduct } of resolvedLines) {
    if (partDoc && toDeduct > 0) {
      partDoc.quantityInStock = Math.max(0, partDoc.quantityInStock - toDeduct);
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
async function resolveDraftLines(items, qty, overrideLines) {
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
  for (const item of items) {
    const partDoc = byCode.get(item.ttUniquePartNumber);
    const required = item.qtyPerKit * qty;
    const available = partDoc ? partDoc.quantityInStock : 0;

    const planned = overrideByCode.has(item.ttUniquePartNumber)
      ? overrideByCode.get(item.ttUniquePartNumber)
      : Math.min(available, required);
    const short = Math.max(0, required - planned);

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

    resolvedLines.push({ item, partDoc, required, toDeduct: planned, short });
  }

  return { resolvedLines, shortages };
}

// Shapes resolveAndDeductLines' output into KitIssue.lines' schema.
const linesPayloadFrom = (resolvedLines) =>
  resolvedLines.map(({ item, partDoc, required, toDeduct, short }) => ({
    part: partDoc ? partDoc._id : null,
    ttUniquePartNumber: item.ttUniquePartNumber,
    itemDescription: partDoc ? partDoc.itemDescription : item.value || "",
    referenceDesignator: item.referenceDesignator,
    qtyPerKit: item.qtyPerKit,
    qtyRequired: required,
    qtyIssued: toDeduct,
    qtyShort: short,
  }));

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

// A kit issue is editable only while nothing has been created "from" it
// yet — the moment an edit is made (Kit 1 -> Kit 1A, or Kit 1A -> Kit 1B),
// the entry that edit was made from is permanently superseded: it stays
// visible as history but can never be edited again, only viewed. Editing
// always happens from whichever entry is currently the head of the chain.
async function attachEditLock(issues) {
  const list = Array.isArray(issues) ? issues : [issues];
  if (list.length === 0) return issues;
  const supersededIds = new Set((await KitIssue.distinct("editedFrom")).map((id) => String(id)));
  for (const iss of list) {
    iss.isEditable = !supersededIds.has(String(iss._id));
  }
  return issues;
}

// Attaches a live `matchedPart` (or null) to every item of a template —
// used wherever the frontend needs to know current stock against a
// template, without ever storing a stale Part reference on the template
// itself (ttUniquePartNumber is always the source of truth).
async function withResolvedItems(templateDoc) {
  const template = templateDoc.toObject ? templateDoc.toObject() : templateDoc;
  const byCode = await resolvePartsByCode(template.items);
  template.items = (template.items || []).map((it) => ({
    ...it,
    matchedPart: byCode.get(it.ttUniquePartNumber) || null,
  }));
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
      template.items = items.map(sanitizeItem);
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
  const issues = await KitIssue.find({ kitTemplate: req.params.id, status: "issued" })
    .populate("vendor", "companyName")
    .sort({ createdAt: -1 });
  const plain = issues.map((i) => i.toObject());
  await attachEditLock(plain);
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
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock")
    .sort({ createdAt: -1 })
    .limit(limit);
  const plain = issues.map((i) => i.toObject());
  await attachEditLock(plain);
  res.json(plain);
});

// GET /api/kits/issues/:id
export const getKitIssueById = asyncHandler(async (req, res) => {
  const issue = await KitIssue.findById(req.params.id)
    .populate("vendor")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");
  if (!issue || issue.status !== "issued") {
    res.status(404);
    throw new Error("Kit issue not found");
  }
  const plain = issue.toObject();
  await attachEditLock(plain);
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

  let resolvedLines, shortages;
  try {
    ({ resolvedLines, shortages } = await resolveAndDeductLines(items, qty, overrideLines));
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  // First issue of this kit template is "Kit 1", the next time this same
  // template is issued it's "Kit 2", and so on — counted from the root
  // issues already recorded against this template (edits don't count,
  // they grow a letter suffix off their own root instead — see
  // editKitIssue). Scoped per kitTemplate, so a different kit's numbering
  // starts back at 1.
  const priorRootIssues = await KitIssue.countDocuments({
    kitTemplate: template._id,
    rootIssue: null,
    status: "issued",
  });
  const issueCode = `Kit ${priorRootIssues + 1}`;

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
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");

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
  Body: { quantity, vendor, issuedBy, remarks, lines?, extraItems? } — the
  first four are the same shape as POST /api/kits/:id/issue. `extraItems`
  (optional): [{ ttUniquePartNumber, referenceDesignator? }, ...] — parts
  to add to this edit that weren't on the original issue (or the current
  template); the actual quantity for each still comes through `lines`,
  same as any other line.

  Never touches the issue that's being "edited" — from here on that entry
  stays exactly as it was, untouched, permanent history. This instead
  re-resolves against live stock and creates a brand-new KitIssue, and
  gives IT the next code in that issue's own edit series: the original
  issue at the start of the chain keeps whatever issueCode it was given at
  creation ("Kit 1", "Kit 2", ... — see issueKit), and every edit appends
  the next letter — "Kit 1" -> "Kit 1A" -> "Kit 1B" — no matter which
  entry in the chain "Edit" was actually clicked on. Only the entry
  currently at the head of the chain (nothing edited from it yet) may be
  edited — see the isEditable/alreadySuperseded check below.
*/
export const editKitIssue = asyncHandler(async (req, res) => {
  const { issueId } = req.params;
  const { quantity, vendor, issuedBy, remarks, lines: overrideLines, extraItems } = req.body;

  const original = await KitIssue.findById(issueId);
  if (!original) {
    res.status(404);
    throw new Error("Kit issue not found");
  }

  // Once something has already been created "from" this entry (Kit 1 ->
  // Kit 1A, Kit 1A -> Kit 1B, ...), this entry is permanently superseded —
  // it stays as untouched history and can only be viewed from here on.
  // Only the current head of the chain can be edited further.
  const alreadySuperseded = await KitIssue.exists({ editedFrom: original._id });
  if (alreadySuperseded) {
    res.status(400);
    throw new Error(
      `${original.issueCode || original.kitName} has already been edited and is now locked — only its latest edit can be edited further. You can still view this entry.`
    );
  }

  // Always count from the start of the chain, not from whichever entry
  // was clicked — so editing an already-edited entry still lands on the
  // next letter after the last one, e.g. editing ABC11A gives ABC11B.
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
  if (!vendor) {
    res.status(400);
    throw new Error("Select the vendor this kit is being issued to");
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

  // Prefer the live template (so this edit picks up any item / qty-per-kit
  // changes made since the original was issued); fall back to the
  // original issue's own snapshot lines if the template has since been
  // deleted, so an edit is still possible even then.
  let items = null;
  if (original.kitTemplate) {
    const template = await KitTemplate.findById(original.kitTemplate);
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
    items = (original.lines || []).map((l) => ({
      ttUniquePartNumber: l.ttUniquePartNumber,
      referenceDesignator: l.referenceDesignator,
      qtyPerKit: l.qtyPerKit,
      value: l.itemDescription,
    }));
  }
  // Parts added on THIS edit only — not on the template or the original
  // issue's own snapshot. Given qtyPerKit: 0 so they never inflate
  // `required` for the kit's normal per-kit math; the actual quantity to
  // deduct still comes through `overrideLines` (`lines`) exactly like
  // every other line, keyed by ttUniquePartNumber. Duplicates of a code
  // already in `items` are ignored — that line is edited in place instead.
  if (Array.isArray(extraItems) && extraItems.length) {
    const existingCodes = new Set(items.map((it) => it.ttUniquePartNumber));
    for (const ex of extraItems) {
      const code = String(ex?.ttUniquePartNumber || "").trim().toUpperCase();
      if (!code || existingCodes.has(code)) continue;
      existingCodes.add(code);
      items.push({
        ttUniquePartNumber: code,
        referenceDesignator: String(ex?.referenceDesignator || "").trim(),
        qtyPerKit: 0,
        value: "",
      });
    }
  }

  if (items.length === 0) {
    res.status(400);
    throw new Error("This kit has no issuable items to re-issue");
  }

  let resolvedLines, shortages;
  try {
    ({ resolvedLines, shortages } = await resolveAndDeductLines(items, qty, overrideLines));
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  // Next letter in this chain — counted across every edit already made
  // from this same root, so it keeps incrementing even if edits happen
  // out of order or from different entries in the chain.
  const priorEdits = await KitIssue.find({ rootIssue: rootDoc._id }).select("editIndex").lean();
  const nextIndex = priorEdits.reduce((max, e) => Math.max(max, e.editIndex || 0), 0) + 1;
  const issueCode = `${rootDoc.issueCode || rootDoc.kitName}${editLetterSuffix(nextIndex)}`;

  const created = await KitIssue.create({
    status: "issued",
    kitTemplate: original.kitTemplate,
    kitName: original.kitName,
    kitCode: original.kitCode,
    issueCode,
    rootIssue: rootDoc._id,
    editedFrom: original._id,
    editIndex: nextIndex,
    quantity: qty,
    vendor: vendorDoc._id,
    issuedBy: issuedBy || req.user?.name || req.user?.username || "",
    issuedByUser: req.user?._id || null,
    remarks: remarks || "",
    hasShortage: shortages.length > 0,
    lines: linesPayloadFrom(resolvedLines),
  });

  const populated = await KitIssue.findById(created._id)
    .populate("vendor", "companyName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");

  res.status(201).json({
    ...populated.toObject(),
    isEditable: true, // brand new — nothing has been edited from it yet
    message:
      shortages.length > 0
        ? `Created ${issueCode} — ${shortages.length} part(s) were short and only partially deducted`
        : `Created ${issueCode}, based on ${rootDoc.issueCode || rootDoc.kitName}`,
    shortages,
  });
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
    partDoc.quantityInStock = partDoc.quantityInStock + Number(line.qtyIssued || 0);
    await partDoc.save();
  }

  line.deleteOne();
  await issue.save();

  res.json({ message: "Kit issue line reverted — stock restored", issueId: issue._id, lineId, partId: partDoc?._id });
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
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");

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
  const { resolvedLines, shortages } = await resolveDraftLines(items, qty, overrideLines);

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
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");

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
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock")
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
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");
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
  if (items.length === 0) {
    res.status(400);
    throw new Error("This kit has no issuable items to issue");
  }

  // Fall back to whatever was last saved on the draft so "Issue" works
  // straight from the saved-kits list, without needing the form open.
  const linesToUse =
    Array.isArray(overrideLines) && overrideLines.length
      ? overrideLines
      : draft.lines.map((l) => ({ ttUniquePartNumber: l.ttUniquePartNumber, qtyIssued: l.qtyIssued }));

  let resolvedLines, shortages;
  try {
    ({ resolvedLines, shortages } = await resolveAndDeductLines(items, qty, linesToUse));
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  const priorRootIssues = await KitIssue.countDocuments({
    kitTemplate: draft.kitTemplate,
    rootIssue: null,
    status: "issued",
  });
  const issueCode = `Kit ${priorRootIssues + 1}`;

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
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");

  res.status(200).json({
    ...populated.toObject(),
    isEditable: true, // brand new as an issued entry — nothing edited from it yet
    message:
      shortages.length > 0
        ? `Issued ${qty} × "${draft.kitName}" as ${issueCode} — ${shortages.length} part(s) were short and only partially deducted`
        : `Issued ${qty} × "${draft.kitName}" as ${issueCode}`,
    shortages,
  });
});