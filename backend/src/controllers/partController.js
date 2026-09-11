import asyncHandler from "express-async-handler";
import Part from "../models/Part.js";
import StockEntry from "../models/StockEntry.js";
import KitIssue from "../models/KitIssue.js";
import { buildPartNumber } from "../utils/generatePartNumber.js";

/*
  Attaches, to each part, how much of it has actually gone out through
  issued kits — NOT how much a kit template merely calls for. Creating or
  editing a KitTemplate must never move this number: a template is just a
  recipe, so it stays at 0 for every part until a kit built from it is
  actually issued to someone (POST /api/kits/:id/issue), at which point
  the issue's own lines (qtyIssued) are what count here.
    - totalQtyInKits: sum of qtyIssued across every KitIssue line whose
      ttUniquePartNumber matches this part
    - kitTemplateCount: how many distinct kit templates this part has
      actually been issued through (via KitIssue.kitTemplate)
  Matched purely by ttUniquePartNumber (same convention KitTemplate itself
  uses), computed fresh on every call since kit issues and the parts
  master change independently of each other. Accepts either a single part
  document or an array, mirroring what it's given back.
*/
async function attachKitDemand(parts) {
  const list = Array.isArray(parts) ? parts : [parts];
  const codes = [...new Set(list.map((p) => p.ttUniquePartNumber).filter(Boolean))];

  let byCode = new Map();
  if (codes.length) {
    const agg = await KitIssue.aggregate([
      { $unwind: "$lines" },
      { $match: { "lines.ttUniquePartNumber": { $in: codes } } },
      {
        $group: {
          _id: "$lines.ttUniquePartNumber",
          totalQtyInKits: { $sum: "$lines.qtyIssued" },
          kitTemplates: { $addToSet: "$kitTemplate" },
        },
      },
      {
        $project: {
          totalQtyInKits: 1,
          kitTemplateCount: {
            $size: { $filter: { input: "$kitTemplates", as: "kt", cond: { $ne: ["$$kt", null] } } },
          },
        },
      },
    ]);
    byCode = new Map(agg.map((a) => [a._id, a]));
  }

  const withDemand = list.map((p) => {
    const obj = p.toObject ? p.toObject({ virtuals: true }) : { ...p };
    const match = byCode.get(p.ttUniquePartNumber);
    obj.totalQtyInKits = match ? match.totalQtyInKits : 0;
    obj.kitTemplateCount = match ? match.kitTemplateCount : 0;
    return obj;
  });

  return Array.isArray(parts) ? withDemand : withDemand[0];
}

// GET /api/parts?search=&limit=
export const getParts = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const filter = {};
  if (search) {
    filter.$or = [
      { ttUniquePartNumber: { $regex: search, $options: "i" } },
      { manufacturerPartNumber: { $regex: search, $options: "i" } },
      { itemDescription: { $regex: search, $options: "i" } },
    ];
  }
  // The parts master has no pagination UI — it lists everything that
  // matches. 200 used to be hard-coded here, which silently cut the table
  // (and anything that counts off this endpoint, like the dashboard) off
  // at 200 parts once the database grew past that. Now it's a generous,
  // overridable cap instead of a silent truncation.
  const limit = Math.min(Number(req.query.limit) || 5000, 5000);
  const parts = await Part.find(filter)
    .populate("vendors", "companyName")
    .sort({ ttUniquePartNumber: 1 })
    .limit(limit);
  res.json(await attachKitDemand(parts));
});

// GET /api/parts/count?search=  -> exact total, independent of any list limit
export const getPartsCount = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const filter = {};
  if (search) {
    filter.$or = [
      { ttUniquePartNumber: { $regex: search, $options: "i" } },
      { manufacturerPartNumber: { $regex: search, $options: "i" } },
      { itemDescription: { $regex: search, $options: "i" } },
    ];
  }
  const count = await Part.countDocuments(filter);
  res.json({ count });
});

// GET /api/parts/lookup?partNumber=  -> used by stock entry to check for a match
export const lookupPart = asyncHandler(async (req, res) => {
  const { partNumber } = req.query;
  if (!partNumber) {
    res.status(400);
    throw new Error("partNumber query param is required");
  }
  const part = await Part.findOne({
    $or: [
      { ttUniquePartNumber: partNumber.trim().toUpperCase() },
      { manufacturerPartNumber: { $regex: `^${partNumber.trim()}$`, $options: "i" } },
    ],
  }).populate("alternateOf alternateParts vendors");

  res.json({ matched: !!part, part: part || null });
});

// Words too generic to be useful as a match signal on their own (units,
// connectors, filler). Kept short and hand-picked rather than a full
// stopword list — this only needs to skip the tokens that would otherwise
// match almost everything in the parts master.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "type", "size", "pcs", "pc", "no", "of", "a", "an", "in", "on",
]);

// Splits a free-text item description into the keywords worth matching on:
// alphanumeric tokens of length >= 3, deduplicated, filler words dropped.
// Kept in one place since both suggestParts and its ranking use it.
const keywordsFrom = (text) =>
  [
    ...new Set(
      String(text || "")
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()))
    ),
  ];

// GET /api/parts/suggest?description=&excludePartNumber=
// Used by the "new part" entry screens (manual stock entry and the vendor
// sheet import) to catch the case where a part is being re-entered as new
// under a different manufacturer part number / spelling. Splits the typed
// description into keywords and returns existing parts whose description
// shares any of them, best (most-keywords-matched) first — a fuzzier net
// than the exact "already in the master?" lookup at /parts/lookup.
export const suggestParts = asyncHandler(async (req, res) => {
  const { description, excludePartNumber } = req.query;
  const keywords = keywordsFrom(description);
  if (keywords.length === 0) {
    res.json([]);
    return;
  }

  const filter = {
    $or: keywords.map((kw) => ({
      itemDescription: { $regex: kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" },
    })),
  };
  if (excludePartNumber) {
    filter.ttUniquePartNumber = { $ne: String(excludePartNumber).trim().toUpperCase() };
  }

  const candidates = await Part.find(filter)
    .select("ttUniquePartNumber itemDescription manufacturerPartNumber quantityInStock")
    .limit(50)
    .lean();

  const upperKeywords = keywords.map((k) => k.toUpperCase());
  const scored = candidates
    .map((p) => {
      const hay = String(p.itemDescription || "").toUpperCase();
      const score = upperKeywords.reduce((n, kw) => n + (hay.includes(kw) ? 1 : 0), 0);
      return { ...p, matchedKeywords: score };
    })
    .filter((p) => p.matchedKeywords > 0)
    .sort((a, b) => b.matchedKeywords - a.matchedKeywords)
    .slice(0, 8);

  res.json(scored);
});

// GET /api/parts/:id
export const getPartById = asyncHandler(async (req, res) => {
  const part = await Part.findById(req.params.id).populate("alternateOf alternateParts vendors");
  if (!part) {
    res.status(404);
    throw new Error("Part not found");
  }
  res.json(await attachKitDemand(part));
});

/*
  GET /api/parts/:id/history
  Bank-statement style ledger for a single part: every stock movement,
  oldest first for the running-balance math, returned newest first so the
  most recent activity is on top.

  There are now two movement types: a "receipt" (material coming in from a
  vendor, backed by StockEntry) and an "issued" (a kit sent out to a
  vendor, backed by one line of a KitIssue). The response shape is
  deliberately generic ("direction" + "party" + "reference" instead of
  receipt-only fields) so both merge into one normalized `entries` array —
  everything downstream (running balance, sort order) works off
  `direction` alone, not the underlying record type.
*/
export const getPartHistory = asyncHandler(async (req, res) => {
  const part = await Part.findById(req.params.id);
  if (!part) {
    res.status(404);
    throw new Error("Part not found");
  }

  const receipts = await StockEntry.find({ part: part._id })
    .populate("vendor", "companyName")
    .populate("purchaseOrder", "documentType documentNumber")
    .sort({ createdAt: 1 }); // oldest first, so the balance can be walked forward

  // Every kit issue with at least one line against this part. A single
  // issue can carry lines for many different parts, so each matching line
  // becomes its own ledger entry (entryType/issueId/lineId identify it for
  // the "undo" action, which reverts one line, not the whole issue).
  const kitIssuesForPart = await KitIssue.find({ "lines.part": part._id })
    .populate("vendor", "companyName")
    .sort({ createdAt: 1 });

  // Normalize into a single ledger shape.
  const receiptMovements = receipts.map((entry) => ({
    _id: entry._id,
    date: entry.createdAt,
    direction: "in", // "in" | "out"
    type: "received",
    quantity: entry.quantityReceived,
    party: entry.vendor
      ? { role: "vendor", id: entry.vendor._id, name: entry.vendor.companyName }
      : null,
    reference: entry.purchaseOrder
      ? {
          type: entry.purchaseOrder.documentType,
          number: entry.purchaseOrder.documentNumber || null,
          id: entry.purchaseOrder._id,
        }
      : null,
    matchType: entry.matchType,
    enteredBy: entry.enteredBy || null,
    remarks: entry.remarks || null,
    // Whether this line's quantity has actually been credited to
    // quantityInStock yet — false while its tax invoice hasn't arrived.
    stockApplied: !!entry.stockApplied,
    // WW/YY lot code stamped on once the tax invoice arrives — see
    // utils/batchCode.js. Empty while the entry is still pending.
    batchCode: entry.batchCode || null,
    entryType: "stock_entry",
  }));

  const kitMovements = [];
  for (const issue of kitIssuesForPart) {
    for (const line of issue.lines) {
      if (String(line.part) !== String(part._id)) continue;
      kitMovements.push({
        _id: line._id,
        date: issue.createdAt,
        direction: "out",
        type: "issued",
        quantity: line.qtyIssued,
        party: issue.vendor
          ? { role: "vendor", id: issue.vendor._id, name: issue.vendor.companyName }
          : null,
        reference: { type: "Kit issue", number: issue.kitCode || issue.kitName, id: issue._id },
        matchType: null,
        enteredBy: issue.issuedBy || null,
        remarks: issue.remarks || null,
        // Kit issues deduct stock the instant they're created — there is
        // no "pending an invoice" equivalent on the way out.
        stockApplied: true,
        entryType: "kit_issue",
        issueId: issue._id,
        lineId: line._id,
      });
    }
  }

  const movements = [...receiptMovements, ...kitMovements];
  movements.sort((a, b) => new Date(a.date) - new Date(b.date));

  // A line that hasn't been applied yet (tax invoice not uploaded) was
  // never credited to quantityInStock, so it must not move the running
  // balance — otherwise the ledger would show a balance the stock count
  // doesn't actually have.
  let running = 0;
  const withBalance = movements.map((m) => {
    const counts = m.type !== "received" || m.stockApplied;
    if (counts) {
      running += m.direction === "out" ? -m.quantity : m.quantity;
    }
    return { ...m, balance: running };
  });

  res.json({
    part: {
      _id: part._id,
      ttUniquePartNumber: part.ttUniquePartNumber,
      itemDescription: part.itemDescription,
      quantityInStock: part.quantityInStock,
    },
    openingBalance: 0,
    closingBalance: part.quantityInStock,
    // Newest first, like a bank statement.
    entries: withBalance.slice().reverse(),
  });
});

// POST /api/parts  (create a brand-new part; auto-generates the TT unique part number)
export const createPart = asyncHandler(async (req, res) => {
  const {
    typeOfPart,
    manufacturerPartNumber,
    itemDescription,
    companyCode,
    category,
    partTypeBatchNo,
    isAlternatePart,
    alternateOf,
  } = req.body;

  if (!itemDescription || !companyCode || !category || !partTypeBatchNo) {
    res.status(400);
    throw new Error("itemDescription, companyCode, category and partTypeBatchNo are required");
  }

  let ttUniquePartNumber;
  try {
    ({ ttUniquePartNumber } = await buildPartNumber(companyCode, category, partTypeBatchNo));
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  const part = await Part.create({
    ttUniquePartNumber,
    typeOfPart,
    manufacturerPartNumber,
    itemDescription,
    companyCode: companyCode.toUpperCase(),
    category: category.toUpperCase(),
    partTypeBatchNo: partTypeBatchNo.toUpperCase(),
    isAlternatePart: !!isAlternatePart,
    alternateOf: isAlternatePart ? alternateOf : null,
  });

  if (isAlternatePart && alternateOf) {
    await Part.findByIdAndUpdate(alternateOf, { $addToSet: { alternateParts: part._id } });
  }

  res.status(201).json(part);
});

// PATCH /api/parts/:id/stock  (add/remove quantity from an existing part's stack)
export const adjustPartStock = asyncHandler(async (req, res) => {
  const { quantity } = req.body; // positive to add, negative to remove
  const part = await Part.findById(req.params.id);
  if (!part) {
    res.status(404);
    throw new Error("Part not found");
  }
  part.quantityInStock = Math.max(0, part.quantityInStock + Number(quantity));
  await part.save();
  res.json(part);
});

// GET /api/parts/duplicates
// Groups active parts by manufacturer part number (trimmed, case-insensitive)
// and returns only the groups that contain more than one TT part number —
// i.e. the same manufacturer part accidentally entered under different rows.
export const getDuplicateParts = asyncHandler(async (req, res) => {
  const groups = await Part.aggregate([
    {
      $match: {
        manufacturerPartNumber: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $addFields: {
        _mfgKey: { $toUpper: { $trim: { input: "$manufacturerPartNumber" } } },
      },
    },
    { $match: { _mfgKey: { $ne: "" } } },
    {
      $group: {
        _id: "$_mfgKey",
        partIds: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);

  const allIds = groups.flatMap((g) => g.partIds);
  const parts = await Part.find({ _id: { $in: allIds } })
    .populate("vendors", "companyName")
    .sort({ ttUniquePartNumber: 1 })
    .lean();
  const byId = new Map(parts.map((p) => [String(p._id), p]));

  const duplicates = groups.map((g) => ({
    manufacturerPartNumber: g._id,
    count: g.count,
    parts: g.partIds.map((id) => byId.get(String(id))).filter(Boolean),
  }));

  res.json(duplicates);
});

// DELETE /api/parts/:id
export const deletePart = asyncHandler(async (req, res) => {
  const part = await Part.findById(req.params.id);
  if (!part) {
    res.status(404);
    throw new Error("Part not found");
  }

  if (part.quantityInStock > 0) {
    res.status(400);
    throw new Error(
      `Cannot delete ${part.ttUniquePartNumber} — it still has ${part.quantityInStock} unit(s) in stock. Zero out the stock first.`
    );
  }

  // Keep the alternate-part linkage clean before removing the part.
  await Part.updateMany({ alternateOf: part._id }, { $set: { alternateOf: null } });
  await Part.updateMany({ alternateParts: part._id }, { $pull: { alternateParts: part._id } });

  await part.deleteOne();
  res.json({ message: "Part deleted", _id: part._id });
});