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
  const withCounts = templates.map((t) => ({
    ...t,
    itemCount: Array.isArray(t.items) ? t.items.length : 0,
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
  res.json(await withResolvedItems(template));
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
    revision: (revision || "").trim(),
    description: (description || "").trim(),
    items: sanitizedItems,
    createdBy: req.user?.name || req.user?.username || "",
    createdByUser: req.user?._id || null,
  });

  res.status(201).json(await withResolvedItems(template));
});

// PATCH /api/kits/:id  (admin only — kit.manage)
export const updateKitTemplate = asyncHandler(async (req, res) => {
  const template = await KitTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("Kit template not found");
  }

  const { kitName, kitCode, revision, description, items, isActive } = req.body;

  if (kitName !== undefined) {
    if (!String(kitName).trim()) {
      res.status(400);
      throw new Error("Kit name is required");
    }
    template.kitName = String(kitName).trim();
  }
  if (kitCode !== undefined) template.kitCode = String(kitCode).trim().toUpperCase();
  if (revision !== undefined) template.revision = String(revision).trim();
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
  res.json(await withResolvedItems(template));
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
export const getIssuesForTemplate = asyncHandler(async (req, res) => {
  const issues = await KitIssue.find({ kitTemplate: req.params.id })
    .populate("vendor", "companyName")
    .sort({ createdAt: -1 });
  res.json(issues);
});

// GET /api/kits/issues?vendor=&kit=&limit=  — all kit issues, newest first
export const getKitIssues = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.vendor) filter.vendor = req.query.vendor;
  if (req.query.kit) filter.kitTemplate = req.query.kit;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  const issues = await KitIssue.find(filter)
    .populate("vendor", "companyName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock")
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json(issues);
});

// GET /api/kits/issues/:id
export const getKitIssueById = asyncHandler(async (req, res) => {
  const issue = await KitIssue.findById(req.params.id)
    .populate("vendor")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");
  if (!issue) {
    res.status(404);
    throw new Error("Kit issue not found");
  }
  res.json(issue);
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

  const byCode = await resolvePartsByCode(items);

  // Optional per-item overrides from the user: the actual quantity being
  // issued for each part, keyed by ttUniquePartNumber. When a part isn't
  // present in this map (or the body sent no `lines` at all), the line
  // falls back to the old auto behaviour of min(available, required), so
  // older clients keep working unchanged.
  const overrideByCode = new Map();
  if (Array.isArray(overrideLines)) {
    for (const line of overrideLines) {
      const code = String(line?.ttUniquePartNumber || "").trim().toUpperCase();
      if (!code) continue;
      const q = Number(line?.qtyIssued);
      if (Number.isFinite(q) && q >= 0) overrideByCode.set(code, q);
    }
  }

  // Resolve every line against live stock. A line is never rejected for
  // being short — it deducts whatever is available (0 if the part is
  // missing from the master entirely) and the gap is recorded as a
  // shortage on that line. If the user entered a specific qty to issue for
  // a line, that figure is used instead (still capped at available stock,
  // since a line can never deduct more than what's on hand).
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
        res.status(400);
        throw new Error(
          `Qty to issue for ${item.ttUniquePartNumber} (${toDeduct}) exceeds available stock (${available})`
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

  const issue = await KitIssue.create({
    kitTemplate: template._id,
    kitName: template.kitName,
    kitCode: template.kitCode,
    quantity: qty,
    vendor: vendorDoc._id,
    issuedBy: issuedBy || req.user?.name || req.user?.username || "",
    issuedByUser: req.user?._id || null,
    remarks: remarks || "",
    hasShortage: shortages.length > 0,
    lines: resolvedLines.map(({ item, partDoc, required, toDeduct, short }) => ({
      part: partDoc ? partDoc._id : null,
      ttUniquePartNumber: item.ttUniquePartNumber,
      itemDescription: partDoc ? partDoc.itemDescription : item.value || "",
      referenceDesignator: item.referenceDesignator,
      qtyPerKit: item.qtyPerKit,
      qtyRequired: required,
      qtyIssued: toDeduct,
      qtyShort: short,
    })),
  });

  const populated = await KitIssue.findById(issue._id)
    .populate("vendor", "companyName")
    .populate("lines.part", "ttUniquePartNumber itemDescription quantityInStock");

  res.status(201).json({
    ...populated.toObject(),
    message:
      shortages.length > 0
        ? `Issued ${qty} × "${template.kitName}" — ${shortages.length} part(s) were short and only partially deducted`
        : `Issued ${qty} × "${template.kitName}"`,
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