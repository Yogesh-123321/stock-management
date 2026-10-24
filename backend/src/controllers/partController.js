import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import Part from "../models/Part.js";
import StockEntry from "../models/StockEntry.js";
import KitIssue from "../models/KitIssue.js";
import KitTemplate from "../models/KitTemplate.js";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import { buildPartNumber } from "../utils/generatePartNumber.js";
import { getEmbeddings, cosineSimilarity, EmbeddingError } from "../utils/embeddings.js";
import { notifyUsers } from "../utils/notify.js";

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

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Splits a search box query into individual terms on whitespace, so
// "a b" is treated as two independent terms rather than the literal
// substring "a b". Empty/whitespace-only input yields no terms.
const searchTermsFrom = (search) =>
  search ? String(search).trim().split(/\s+/).filter(Boolean) : [];

// Builds a Mongo $or filter matching a part where ANY given term appears
// in ANY of the searchable fields (part number, mfr part number,
// description, remarks — the free-text note entered at part-registry
// time, either by the operator raising the request or the admin
// approving/editing it; see Part.remarks). Multi-term ranking (which
// terms matched, and how many) happens afterwards in rankByMatchedTerms —
// this filter just widens the candidate set to everything worth ranking.
const buildPartSearchFilter = (terms) => {
  if (!terms.length) return {};
  return {
    $or: terms.flatMap((term) => {
      const rx = { $regex: escapeRegex(term), $options: "i" };
      return [
        { ttUniquePartNumber: rx },
        { manufacturerPartNumber: rx },
        { itemDescription: rx },
        { remarks: rx },
      ];
    }),
  };
};

// Orders already-fetched parts so that a query like "a b" surfaces, in
// order: parts matching every term, then parts matching only earlier
// terms, then parts matching only later terms — matching-term-count wins
// first, and among equal counts, matching an earlier-typed term outranks
// matching a later one. Ties fall back to the original (incoming) order,
// which callers should have pre-sorted (e.g. by part number).
function rankByMatchedTerms(parts, terms) {
  const termRegexes = terms.map((t) => new RegExp(escapeRegex(t), "i"));
  const scored = parts.map((part, idx) => {
    const haystack = [
      part.ttUniquePartNumber,
      part.manufacturerPartNumber,
      part.itemDescription,
      part.remarks,
    ]
      .filter(Boolean)
      .join(" ");
    let matchCount = 0;
    let weight = 0;
    termRegexes.forEach((rx, i) => {
      if (rx.test(haystack)) {
        matchCount += 1;
        // Earlier terms carry more weight, so "matches term 1 only" ranks
        // above "matches term 2 only" among equal matchCounts.
        weight += 2 ** (termRegexes.length - 1 - i);
      }
    });
    return { part, idx, matchCount, weight };
  });

  scored.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.idx - b.idx;
  });

  return scored.map((s) => s.part);
}

// GET /api/parts?search=&limit=
export const getParts = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const terms = searchTermsFrom(search);
  const filter = buildPartSearchFilter(terms);
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
  const withDemand = await attachKitDemand(parts);
  // Single-term (or empty) searches keep the plain alphabetical order;
  // multi-term searches get re-ordered by how many/which terms matched.
  const ordered = terms.length > 1 ? rankByMatchedTerms(withDemand, terms) : withDemand;
  res.json(ordered);
});

// GET /api/parts/count?search=  -> exact total, independent of any list limit
export const getPartsCount = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const terms = searchTermsFrom(search);
  const filter = buildPartSearchFilter(terms);
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
    .populate("appliedVia", "invoiceNumber")
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
    // The tax invoice that actually moved this line into IQC/stock (see
    // StockEntry.appliedVia) — separate from `reference`, which points at
    // the PO/PI instead. Lets the ledger link straight to the invoice tab
    // for the specific tax invoice this delivery was booked against.
    taxInvoiceId: entry.appliedVia?._id || null,
    // Number printed on that tax invoice, shown under the link in the ledger.
    taxInvoiceNumber: entry.appliedVia?.invoiceNumber || null,
    matchType: entry.matchType,
    enteredBy: entry.enteredBy || null,
    remarks: entry.remarks || null,
    // Per-delivery unit/rate entered at receiving time — null on entries
    // logged before this field existed, in which case the ledger falls
    // back to the part's registered rate (see Parts.jsx).
    unit: entry.unit || null,
    price: entry.price ?? null,
    // Whether this line's quantity has actually been credited to
    // quantityInStock yet — false while its tax invoice hasn't arrived.
    stockApplied: !!entry.stockApplied,
    // Where this line stands in IQC: awaiting_invoice (tax invoice not in
    // yet) | in_iqc_stock (invoice in, waiting for inspection) | accepted |
    // rejected. stockApplied alone can't tell "no invoice" from "invoice
    // in but not inspected", so the ledger needs this to label the line.
    iqcStatus: entry.iqcStatus || null,
    iqcInspectedBy: entry.iqcReport?.inspectedBy || null,
    iqcRejectionReason: entry.iqcReport?.rejectionReason || null,
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
        // Show this specific issue's own code (e.g. "Kit 1", "Kit 1A") —
        // unique per issuance and always present — rather than the kit's
        // name, which is shared by every issue of the same kit template.
        // Falls back to the template's kitCode, then kitName, only for
        // older records created before issueCode existed.
        reference: {
          type: "Kit issue",
          number: issue.issueCode || issue.kitCode || issue.kitName,
          id: issue._id,
        },
        matchType: null,
        enteredBy: issue.issuedBy || null,
        remarks: issue.remarks || null,
        // Kit issues deduct stock the instant they're created — there is
        // no "pending an invoice" equivalent on the way out.
        stockApplied: true,
        // Which batch(es) this line's qty was actually drawn from, oldest
        // first — see utils/batchAllocation.js. batchCode: null is stock
        // that wasn't tied to any batch (a legacy receipt, or a manual
        // stock correction).
        batchBreakdown: line.batchBreakdown || [],
        entryType: "kit_issue",
        issueId: issue._id,
        lineId: line._id,
      });
    }
  }

  // Every time stock was issued to R&D (see issueRndStock above) becomes
  // its own "out" ledger line as well, so the running balance on this
  // ledger keeps matching quantityInStock exactly.
  const rndMovements = (part.rndIssues || []).map((issue) => ({
    _id: issue._id,
    date: issue.date || issue.createdAt,
    direction: "out",
    type: "rnd_issued",
    quantity: issue.quantity,
    party: { role: "rnd", id: null, name: issue.personName },
    reference: { type: "R&D issue", number: null, id: null },
    matchType: null,
    enteredBy: issue.issuedBy || null,
    remarks: issue.remarks || null,
    stockApplied: true,
    entryType: "rnd_issue",
  }));

  const movements = [...receiptMovements, ...kitMovements, ...rndMovements];
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

  // All-in stock picture for this part: where every unit currently is,
  // not just what's in main stock. Built from the same movements the
  // ledger above is built from, so the two always agree.
  //   mainStock        - cleared IQC, credited to quantityInStock
  //   iqcStock         - tax invoice in, waiting for IQC inspection
  //   awaitingInvoice  - received, but the tax invoice hasn't arrived yet
  //   rndStock         - set aside for R&D (still owned, not in main stock)
  //   expectedTotal    - mainStock + iqcStock + awaitingInvoice + rndStock
  //                      (everything we hold or are about to hold)
  //   issuedInKits     - already gone out through issued kits
  //   rejected         - failed IQC; held aside, NOT part of expectedTotal
  //   allInTotal       - expectedTotal + issuedInKits (everything that
  //                      has ever been accounted for, minus rejects)
  const sumQty = (list) => list.reduce((n, e) => n + (Number(e.quantity) || 0), 0);
  const pendingReceipts = receiptMovements.filter((m) => !m.stockApplied);
  const iqcStock = sumQty(pendingReceipts.filter((m) => m.iqcStatus === "in_iqc_stock"));
  const rejected = sumQty(pendingReceipts.filter((m) => m.iqcStatus === "rejected"));
  const awaitingInvoice = sumQty(
    pendingReceipts.filter((m) => m.iqcStatus !== "in_iqc_stock" && m.iqcStatus !== "rejected")
  );
  const mainStock = part.quantityInStock || 0;
  const rndStock = part.rndStock || 0;
  const issuedInKits = sumQty(kitMovements);
  const expectedTotal = mainStock + iqcStock + awaitingInvoice + rndStock;
  const stockSummary = {
    mainStock,
    iqcStock,
    awaitingInvoice,
    rndStock,
    expectedTotal,
    issuedInKits,
    rejected,
    allInTotal: expectedTotal + issuedInKits,
    unit: part.unit || "",
  };

  res.json({
    part: {
      _id: part._id,
      ttUniquePartNumber: part.ttUniquePartNumber,
      itemDescription: part.itemDescription,
      quantityInStock: part.quantityInStock,
    },
    stockSummary,
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
    unit,
    price,
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
    unit: unit || "",
    price: price === "" || price == null ? null : Number(price),
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

/*
  PATCH /api/parts/:id/rnd-stock  (issue quantity out of the main stock
  into the R&D stock, against a named person)
  Body: { quantity, personId, remarks }

  quantity is always a positive amount being moved OUT of quantityInStock
  and INTO rndStock — this endpoint only issues; it never lets rndStock go
  back the other way. personId must be an existing, active user (picked
  from a dropdown on the frontend, not typed freely) — that user is then
  notified that R&D stock was issued to them. Each call is also logged as
  its own line in part.rndIssues (who, how much, who issued it) so the
  Parts master can show, on hover, everyone who's been given R&D stock of
  this part.
*/
export const issueRndStock = asyncHandler(async (req, res) => {
  const { quantity, personId, remarks } = req.body;

  const qty = Number(quantity);
  if (!qty || Number.isNaN(qty) || qty <= 0) {
    res.status(400);
    throw new Error("Quantity must be a positive number");
  }
  if (!personId || !mongoose.Types.ObjectId.isValid(personId)) {
    res.status(400);
    throw new Error("Select the person this stock is being issued to");
  }

  const person = await User.findById(personId);
  if (!person || !person.isActive) {
    res.status(400);
    throw new Error("Selected person is not a valid, active user");
  }

  const part = await Part.findById(req.params.id);
  if (!part) {
    res.status(404);
    throw new Error("Part not found");
  }
  if (qty > part.quantityInStock) {
    res.status(400);
    throw new Error(
      `Only ${part.quantityInStock} unit(s) available in main stock — cannot issue ${qty} to R&D`
    );
  }

  part.quantityInStock -= qty;
  part.rndStock += qty;
  part.rndIssues.push({
    person: person._id,
    personName: person.name,
    quantity: qty,
    issuedBy: req.user?.name || req.user?.username || "",
    remarks: remarks ? String(remarks).trim() : "",
  });

  await part.save();

  try {
    await notifyUsers([person._id], {
      type: "info",
      title: "R&D stock issued to you",
      message: `${req.user?.name || req.user?.username || "An admin"} issued ${qty} unit(s) of ${
        part.ttUniquePartNumber
      } (${part.itemDescription}) to you for R&D use.`,
      link: "/parts",
      entityType: "part",
      entityId: part._id,
      actor: req.user?._id || null,
    });
  } catch (e) {
    console.error("rnd stock issue notification failed:", e.message);
  }

  res.json(part);
});

// Every part field the duplicate finder knows how to compare on. Each
// entry both drives the frontend's dropdown (via GET /parts/duplicates
// with no criterion — see below) and picks the matching finder function.
const DUPLICATE_CRITERIA = {
  manufacturerPartNumber: {
    label: "Manufacturer part number (exact match)",
    finder: findDuplicatesByManufacturerPartNumber,
  },
  description: {
    label: "Item description (exact match)",
    finder: findDuplicatesByExactDescription,
  },
  aiSimilarity: {
    label: "Item description (AI similarity)",
    finder: findDuplicatesByDescriptionSimilarity,
  },
};

// Same manufacturer part number (trimmed, case-insensitive) entered under
// more than one TT part number — the original, and still default, check.
async function findDuplicatesByManufacturerPartNumber() {
  const groups = await Part.aggregate([
    {
      $match: {
        manufacturerPartNumber: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $addFields: {
        _key: { $toUpper: { $trim: { input: "$manufacturerPartNumber" } } },
      },
    },
    { $match: { _key: { $ne: "" } } },
    {
      $group: {
        _id: "$_key",
        partIds: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);

  const parts = await partsByIds(groups.flatMap((g) => g.partIds));
  return groups.map((g) => ({
    criterion: "manufacturerPartNumber",
    label: `Mfr part no.: ${g._id}`,
    count: g.count,
    parts: g.partIds.map((id) => parts.get(String(id))).filter(Boolean),
  }));
}

// Same item description (trimmed, case-insensitive, repeated whitespace
// collapsed) entered under more than one TT part number — catches parts
// re-entered under a fresh part number with no manufacturer number to tie
// them together.
async function findDuplicatesByExactDescription() {
  const parts = await Part.find({ itemDescription: { $exists: true, $nin: [null, ""] } })
    .populate("vendors", "companyName")
    .sort({ ttUniquePartNumber: 1 })
    .lean();

  const byKey = new Map();
  for (const p of parts) {
    const key = String(p.itemDescription || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }

  return [...byKey.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      criterion: "description",
      label: `Description: “${group[0].itemDescription.trim()}”`,
      count: group.length,
      parts: group,
    }))
    .sort((a, b) => b.count - a.count);
}

// Above this cosine similarity, two item descriptions are treated as
// describing the same physical part (near-duplicate wording, not just
// "same rough category of thing").
const AI_DUPLICATE_MIN_SIMILARITY = 0.88;
// Comparing every part against every other part is O(n^2); past this many
// parts a single request would take too long (and burn too many embedding
// tokens) to run synchronously.
const AI_DUPLICATE_MAX_PARTS = 800;

// Semantic near-duplicate check: embeds every part's description, then
// groups any parts whose descriptions land above AI_DUPLICATE_MIN_SIMILARITY
// — transitively, via union-find, so A~B and B~C land in one group even if
// A and C alone fall just under the bar. Catches things the exact-match
// checks above miss, e.g. "24V DC cooling fan" vs "Cooling fan, 24VDC".
async function findDuplicatesByDescriptionSimilarity() {
  const parts = await Part.find({ itemDescription: { $exists: true, $nin: [null, ""] } })
    .populate("vendors", "companyName")
    .sort({ ttUniquePartNumber: 1 })
    .lean();

  if (parts.length > AI_DUPLICATE_MAX_PARTS) {
    const err = new Error(
      `AI similarity check only runs on up to ${AI_DUPLICATE_MAX_PARTS} parts at a time (the master currently has ${parts.length}). Try the manufacturer part number or description checks instead.`
    );
    err.httpStatus = 422;
    throw err;
  }
  if (parts.length < 2) return [];

  let vectors;
  try {
    vectors = await getEmbeddings(parts.map((p) => p.itemDescription || ""));
  } catch (err) {
    const wrapped = new Error(err.message || "Could not run AI similarity matching");
    wrapped.httpStatus = err instanceof EmbeddingError ? 502 : 500;
    throw wrapped;
  }

  const parent = parts.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (cosineSimilarity(vectors[i], vectors[j]) >= AI_DUPLICATE_MIN_SIMILARITY) {
        union(i, j);
      }
    }
  }

  const byRoot = new Map();
  parts.forEach((p, i) => {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(p);
  });

  return [...byRoot.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      criterion: "aiSimilarity",
      label: `Similar description: “${g[0].itemDescription}”`,
      count: g.length,
      parts: g,
    }))
    .sort((a, b) => b.count - a.count);
}

// Shared by every criterion above: fetch full part docs (with vendors
// populated) for a set of ids, keyed by id string for easy lookup.
async function partsByIds(ids) {
  const parts = await Part.find({ _id: { $in: ids } })
    .populate("vendors", "companyName")
    .sort({ ttUniquePartNumber: 1 })
    .lean();
  return new Map(parts.map((p) => [String(p._id), p]));
}

// GET /api/parts/duplicates?criterion=manufacturerPartNumber|description|aiSimilarity
// Criterion defaults to manufacturerPartNumber (the original behaviour) for
// callers that don't pass one. GET /api/parts/duplicate-criteria lists the
// available options for a dropdown.
export const getDuplicateParts = asyncHandler(async (req, res) => {
  const criterion = req.query.criterion || "manufacturerPartNumber";
  const entry = DUPLICATE_CRITERIA[criterion];
  if (!entry) {
    res.status(400);
    throw new Error(
      `Unknown duplicate-check criterion "${criterion}". Valid options: ${Object.keys(DUPLICATE_CRITERIA).join(", ")}.`
    );
  }

  try {
    const groups = await entry.finder();
    res.json(groups);
  } catch (err) {
    if (err.httpStatus) res.status(err.httpStatus);
    throw err;
  }
});

// GET /api/parts/duplicate-criteria — powers the criterion dropdown.
export const getDuplicateCriteria = asyncHandler(async (req, res) => {
  res.json(
    Object.entries(DUPLICATE_CRITERIA).map(([value, { label }]) => ({ value, label }))
  );
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

// ---------------------------------------------------------------------
// CSV export — Part Master "Download parts" button. Two separate CSVs
// (not zipped together) so each can be opened straight in Excel:
//   1. parts master itself
//   2. the part <-> vendor linkage, one row per vendor per part
// Mirrors the pattern used for the activity log export
// (controllers/activityLogController.js: exportLogs) and the vendor
// "download all forms" button (controllers/vendorController.js).
// ---------------------------------------------------------------------

const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const csvFrom = (header, rows) =>
  "\uFEFF" +
  [header.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join(
    "\n"
  );

const sendCsv = (res, filenamePrefix, csv) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csv);
};

// Single source of truth for the "Download parts" (parts-master) export —
// used both to build the CSV and to tell the frontend's field-picker what's
// available, so the two can never drift out of sync. Order here is the
// default order when the caller doesn't ask to customise it.
const PARTS_CSV_FIELDS = [
  { key: "ttUniquePartNumber", label: "TT unique part number", get: (p) => p.ttUniquePartNumber },
  { key: "typeOfPart", label: "Type of part", get: (p) => p.typeOfPart || "" },
  {
    key: "manufacturerPartNumber",
    label: "Manufacturer part number",
    get: (p) => p.manufacturerPartNumber || "",
  },
  { key: "itemDescription", label: "Item description", get: (p) => p.itemDescription || "" },
  { key: "companyCode", label: "Company code", get: (p) => p.companyCode || "" },
  { key: "category", label: "Category", get: (p) => p.category || "" },
  { key: "partTypeBatchNo", label: "Part type / batch no.", get: (p) => p.partTypeBatchNo || "" },
  { key: "hsnCode", label: "HSN code", get: (p) => p.hsnCode || "" },
  { key: "unit", label: "Unit", get: (p) => p.unit || "" },
  { key: "quantityInStock", label: "Quantity in stock", get: (p) => p.quantityInStock ?? 0 },
  { key: "rndStock", label: "R&D stock", get: (p) => p.rndStock ?? 0 },
  {
    key: "rndIssuedTo",
    label: "R&D stock issued to",
    get: (p) =>
      (p.rndIssues || [])
        .map((i) => `${i.personName} (${i.quantity})`)
        .filter(Boolean)
        .join(" / "),
  },
  {
    key: "vendors",
    label: "Vendor(s)",
    get: (p) => (p.vendors || []).map((v) => v.companyName).filter(Boolean).join(" / "),
  },
  { key: "isAlternatePart", label: "Is alternate part", get: (p) => (p.isAlternatePart ? "Yes" : "No") },
  { key: "alternateOf", label: "Alternate of", get: (p) => p.alternateOf?.ttUniquePartNumber || "" },
  { key: "hasPhoto", label: "Has photo", get: (p) => (p.photoUrl ? "Yes" : "No") },
  { key: "hasDatasheet", label: "Has datasheet", get: (p) => (p.datasheetUrl ? "Yes" : "No") },
  { key: "remarks", label: "Remarks", get: (p) => p.remarks || "" },
  { key: "lastEditedBy", label: "Last edited by", get: (p) => p.lastEditedBy || "" },
  {
    key: "lastEditedAt",
    label: "Last edited at",
    get: (p) => (p.lastEditedAt ? new Date(p.lastEditedAt).toLocaleString("en-IN") : ""),
  },
  {
    key: "createdAt",
    label: "Created at",
    get: (p) => (p.createdAt ? new Date(p.createdAt).toLocaleString("en-IN") : ""),
  },
];

// GET /api/parts/export/parts-csv-fields — the field picker's option list
// (key + label, in default order), ADMIN ONLY. Kept as a plain read of
// PARTS_CSV_FIELDS so the picker can never list a field the CSV export
// itself doesn't know how to produce.
export const getPartsCsvFields = asyncHandler(async (req, res) => {
  res.json(PARTS_CSV_FIELDS.map(({ key, label }) => ({ key, label })));
});

// GET /api/parts/export/parts-csv — the Part Master, ADMIN ONLY.
// Accepts an optional ?fields=key1,key2,... query param (from the
// "Customise report" picker) naming which columns to include and in what
// order. Unknown keys are ignored; if nothing recognisable is left, falls
// back to every field in the default order, same as when ?fields is
// omitted entirely.
export const exportPartsCsv = asyncHandler(async (req, res) => {
  const parts = await Part.find({})
    .populate("vendors", "companyName")
    .populate("alternateOf", "ttUniquePartNumber")
    .sort({ ttUniquePartNumber: 1 })
    .lean({ virtuals: true });

  const requestedKeys = (req.query.fields || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const fieldsByKey = new Map(PARTS_CSV_FIELDS.map((f) => [f.key, f]));
  let selectedFields = requestedKeys
    .map((k) => fieldsByKey.get(k))
    .filter(Boolean);
  if (selectedFields.length === 0) selectedFields = PARTS_CSV_FIELDS;

  const header = selectedFields.map((f) => f.label);
  const rows = parts.map((p) => selectedFields.map((f) => f.get(p)));

  sendCsv(res, "parts-master", csvFrom(header, rows));
});

/*
  GET /api/parts/:id/document-history
  Audit trail of every time this part's photo or datasheet was added,
  replaced, or removed — who did it, when, and the old/new file URLs.
  Separate from the stock ledger (getPartHistory above), which tracks
  quantity movements, not file changes. Purely a read of the
  documentHistory array that updatePart (partAdminController.js) appends
  to; newest change first.
*/
export const getPartDocumentHistory = asyncHandler(async (req, res) => {
  const part = await Part.findById(req.params.id).select("documentHistory ttUniquePartNumber");
  if (!part) {
    res.status(404);
    throw new Error("Part not found");
  }

  const entries = (part.documentHistory || [])
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date)) // newest first
    .map((e) => ({
      _id: e._id,
      date: e.date,
      field: e.field, // "photo" | "datasheet"
      action: e.action, // "added" | "replaced" | "removed"
      url: e.url, // the file now in place (null if removed)
      previousUrl: e.previousUrl, // the file that was there before (null if added)
      changedBy: e.changedBy,
    }));

  res.json(entries);
});

/*
  GET /api/parts/:id/kits
  Every kit template this part is used in — i.e. the BOM "recipe", not
  issue history (see attachKitDemand above for what's actually gone out
  the door). Matched the same way KitTemplate itself matches, purely by
  ttUniquePartNumber, since a template never keeps a live reference to a
  Part document. Both active and inactive templates are returned (each
  flagged with isActive) so a part doesn't just silently disappear from
  this list the moment a template is retired.
*/
export const getPartKitUsage = asyncHandler(async (req, res) => {
  const part = await Part.findById(req.params.id).select("ttUniquePartNumber");
  if (!part) {
    res.status(404);
    throw new Error("Part not found");
  }

  if (!part.ttUniquePartNumber) {
    res.json([]);
    return;
  }

  const templates = await KitTemplate.find({
    "items.ttUniquePartNumber": part.ttUniquePartNumber,
  })
    .sort({ kitName: 1 })
    .lean();

  const usage = templates.map((t) => {
    // A part number could in principle appear on more than one line of
    // the same BOM (e.g. split across reference designators) — sum those
    // together so "qty per kit" reflects the template's true total draw.
    const lines = (t.items || []).filter((i) => i.ttUniquePartNumber === part.ttUniquePartNumber);
    const qtyPerKit = lines.reduce((sum, l) => sum + (l.qtyPerKit || 0), 0);
    const dnp = lines.length > 0 && lines.every((l) => l.dnp);
    return {
      kitTemplateId: t._id,
      kitName: t.kitName,
      kitCode: t.kitCode || null,
      revision: t.revision || null,
      isActive: !!t.isActive,
      qtyPerKit,
      dnp,
      referenceDesignators: lines.map((l) => l.referenceDesignator).filter(Boolean).join(", "),
    };
  });

  res.json(usage);
});
/*
  GET /api/parts/export/stock-summary-xlsx — ADMIN ONLY.
  One Excel sheet with the all-in stock picture of every part (same
  numbers as the "Total stock — all in all" card in Part history):
    Expected total = Main + IQC + Awaiting invoice + R&D
    All-in total   = Expected total + Issued in kits
  Rejected-in-IQC units are listed but not counted in either total.
  Computed with two aggregations (stock entries, kit issues) rather than
  one history call per part, so it stays fast with thousands of parts.
*/
export const exportStockSummaryXlsx = asyncHandler(async (req, res) => {
  const parts = await Part.find({})
    .select("ttUniquePartNumber itemDescription manufacturerPartNumber unit quantityInStock rndStock")
    .sort({ ttUniquePartNumber: 1 })
    .lean();

  // Received lines not yet credited to main stock, bucketed by IQC state.
  const pendingAgg = await StockEntry.aggregate([
    { $match: { stockApplied: { $ne: true } } },
    {
      $group: {
        _id: {
          part: "$part",
          bucket: {
            $switch: {
              branches: [
                { case: { $eq: ["$iqcStatus", "in_iqc_stock"] }, then: "iqc" },
                { case: { $eq: ["$iqcStatus", "rejected"] }, then: "rejected" },
              ],
              default: "awaiting",
            },
          },
        },
        qty: { $sum: "$quantityReceived" },
      },
    },
  ]);
  const pending = new Map(); // partId -> { iqc, rejected, awaiting }
  for (const r of pendingAgg) {
    const key = String(r._id.part);
    if (!pending.has(key)) pending.set(key, { iqc: 0, rejected: 0, awaiting: 0 });
    pending.get(key)[r._id.bucket] = r.qty;
  }

  const kitAgg = await KitIssue.aggregate([
    { $unwind: "$lines" },
    { $group: { _id: "$lines.part", qty: { $sum: "$lines.qtyIssued" } } },
  ]);
  const kitByPart = new Map(kitAgg.map((k) => [String(k._id), k.qty]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Stock management";
  const ws = wb.addWorksheet("Stock summary", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "TT part number", key: "pn", width: 20 },
    { header: "Item description", key: "desc", width: 44 },
    { header: "Manufacturer part no.", key: "mpn", width: 24 },
    { header: "Unit", key: "unit", width: 8 },
    { header: "Main stock", key: "main", width: 12 },
    { header: "In IQC stock", key: "iqc", width: 13 },
    { header: "Awaiting invoice", key: "awaiting", width: 16 },
    { header: "R&D stock", key: "rnd", width: 11 },
    { header: "Expected total stock", key: "expected", width: 20 },
    { header: "Issued in kits", key: "kits", width: 14 },
    { header: "All-in total (incl. kits)", key: "allin", width: 22 },
    { header: "Rejected (IQC, not counted)", key: "rejected", width: 26 },
  ];

  parts.forEach((p, i) => {
    const pd = pending.get(String(p._id)) || { iqc: 0, rejected: 0, awaiting: 0 };
    const main = p.quantityInStock || 0;
    const rnd = p.rndStock || 0;
    const kits = kitByPart.get(String(p._id)) || 0;
    const expected = main + pd.iqc + pd.awaiting + rnd;
    const r = i + 2; // header is row 1
    ws.addRow({
      pn: p.ttUniquePartNumber || "",
      desc: p.itemDescription || "",
      mpn: p.manufacturerPartNumber || "",
      unit: p.unit || "",
      main,
      iqc: pd.iqc,
      awaiting: pd.awaiting,
      rnd,
      expected: { formula: `E${r}+F${r}+G${r}+H${r}`, result: expected },
      kits,
      allin: { formula: `I${r}+J${r}`, result: expected + kits },
      rejected: pd.rejected,
    });
  });

  // Totals row (only when there is data).
  if (parts.length > 0) {
    const last = parts.length + 1;
    const totals = ws.addRow({ pn: "TOTAL" });
    for (const col of ["E", "F", "G", "H", "I", "J", "K", "L"]) {
      totals.getCell(col).value = { formula: `SUM(${col}2:${col}${last})` };
    }
    totals.font = { bold: true };
    ws.autoFilter = { from: "A1", to: `L${last}` };
  }

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  for (const col of ["E", "F", "G", "H", "I", "J", "K", "L"]) {
    ws.getColumn(col).alignment = { horizontal: "right" };
    ws.getColumn(col).numFmt = "#,##0.###";
  }
  ws.getColumn("I").font = { bold: true };
  ws.getColumn("K").font = { bold: true };

  const note = wb.addWorksheet("How to read");
  note.columns = [{ width: 110 }];
  [
    "Expected total stock = Main stock + In IQC stock + Awaiting invoice + R&D stock",
    "All-in total = Expected total stock + Issued in kits",
    "Main stock: cleared IQC and credited to stock (usable now).",
    "In IQC stock: tax invoice received, waiting for IQC inspection.",
    "Awaiting invoice: material received, tax invoice not uploaded yet.",
    "R&D stock: set aside for R&D.",
    "Issued in kits: already sent out through issued kits.",
    "Rejected: failed IQC; shown for reference and not counted in either total.",
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ].forEach((t) => note.addRow([t]));

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="stock-summary-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/*
  Custom stock reports: `parts` is a comma-separated list of Part ids picked in
  the dialog's part dropdown. Resolved to TT part numbers once, so every
  movement (kit lines may have no Part ref) can be matched by part number.
  Empty set = no part filter.
*/
async function resolvePartSet(raw) {
  const ids = String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => mongoose.Types.ObjectId.isValid(x));
  if (ids.length === 0) return new Set();
  const found = await Part.find({ _id: { $in: ids } }).select("ttUniquePartNumber").lean();
  return new Set(found.map((p) => p.ttUniquePartNumber));
}

/*
  GET /api/parts/export/issued-stock-options — ADMIN ONLY.
  Feeds the "Custom stock report" dialog: the vendors that have actually been
  issued stock through issued kits, and the people that have actually been
  issued R&D stock. Derived from the issue records themselves, so the pickers
  never list someone with nothing to report.
*/
export const getIssuedStockReportOptions = asyncHandler(async (req, res) => {
  const kitVendorIds = await KitIssue.distinct("vendor", { status: "issued", vendor: { $ne: null } });
  const receivedVendorIds = await StockEntry.distinct("vendor", { vendor: { $ne: null } });
  const vendorIds = [...new Set([...kitVendorIds, ...receivedVendorIds].map((id) => String(id)))];
  const vendors = await Vendor.find({ _id: { $in: vendorIds } })
    .select("companyName")
    .sort({ companyName: 1 })
    .lean();

  const rndAgg = await Part.aggregate([
    { $unwind: "$rndIssues" },
    {
      $group: {
        _id: { person: "$rndIssues.person", name: "$rndIssues.personName" },
      },
    },
  ]);
  const seen = new Map();
  for (const r of rndAgg) {
    const key = r._id.person ? String(r._id.person) : `name:${r._id.name}`;
    if (!seen.has(key)) seen.set(key, { _id: key, name: r._id.name });
  }
  const people = [...seen.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  res.json({
    vendors: vendors.map((v) => ({ _id: String(v._id), name: v.companyName })),
    people,
  });
});

/*
  GET /api/parts/export/stock-movement-xlsx — ADMIN ONLY.
  Complete stock history ("who gave us what, when, and where did it go"):
  every movement of every part on one chronological ledger —
    received      material booked in from a vendor (PO/PI, tax invoice, batch)
    iqc_approved  inspected OK -> credited to main stock
    iqc_rejected  failed IQC -> held aside, never counted (with the reason)
    rnd_issued    issued to an R&D person
    kit_issued    issued to a vendor in a kit (with the FIFO batch(es) used)
  Query: types=received,iqc_approved,... (default all) · vendor=<id> ·
  person=<userId | name:..> · from/to=YYYY-MM-DD · search=<text>.
  A vendor filter keeps that vendor's receipts and kit issues; a person filter
  keeps that person's R&D issues; with both set, the two are combined.
  Extra sheets: "Receipts (lot trace)" — one row per received line with its
  current status and the kits that drew from its batch — and a part-wise
  summary of the same (filtered) movements.
*/
const MOVEMENT_TYPES = {
  received: { label: "Received from vendor", effect: "Incoming (booked in)" },
  iqc_approved: { label: "IQC approved → main stock", effect: "Credited to main stock" },
  iqc_rejected: { label: "IQC rejected", effect: "Held aside (not counted)" },
  rnd_issued: { label: "Issued to R&D", effect: "Out — to R&D person" },
  kit_issued: { label: "Issued in kit to vendor", effect: "Out — kit to vendor" },
};
const IQC_STATUS_LABEL = {
  awaiting_invoice: "Awaiting tax invoice",
  in_iqc_stock: "In IQC stock (awaiting inspection)",
  accepted: "Accepted — in main stock",
  rejected: "Rejected in IQC",
};

export const exportStockMovementXlsx = asyncHandler(async (req, res) => {
  const wanted = new Set(
    String(req.query.types || "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => MOVEMENT_TYPES[t])
  );
  if (wanted.size === 0) Object.keys(MOVEMENT_TYPES).forEach((t) => wanted.add(t));

  const vendorId = req.query.vendor ? String(req.query.vendor) : "";
  const personKey = req.query.person ? String(req.query.person) : "";
  const search = String(req.query.search || "").trim().toLowerCase();
  const partSet = await resolvePartSet(req.query.parts);
  let fromDate = null;
  let toDate = null;
  if (req.query.from) {
    const d = new Date(`${req.query.from}T00:00:00.000`);
    if (!Number.isNaN(d.getTime())) fromDate = d;
  }
  if (req.query.to) {
    const d = new Date(`${req.query.to}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) toDate = d;
  }
  const inRange = (dt) => {
    if (!fromDate && !toDate) return true;
    if (!dt) return false;
    const t = new Date(dt).getTime();
    if (fromDate && t < fromDate.getTime()) return false;
    if (toDate && t > toDate.getTime()) return false;
    return true;
  };
  const matchesSearch = (pn, desc) =>
    (partSet.size === 0 || partSet.has(pn)) &&
    (!search || `${pn || ""} ${desc || ""}`.toLowerCase().includes(search));
  const fmt = (dt) => (dt ? new Date(dt).toISOString().slice(0, 16).replace("T", " ") : "");

  // Vendor / person filter semantics (see header comment).
  const hasVendorFilter = !!vendorId;
  const hasPersonFilter = !!personKey;
  const vendorOk = (id) => !hasVendorFilter || String(id || "") === vendorId;
  const personOk = (key) => !hasPersonFilter || key === personKey;
  const vendorEventsAllowed = hasVendorFilter || !hasPersonFilter;
  const rndEventsAllowed = hasPersonFilter || !hasVendorFilter;

  const events = []; // normalized ledger rows
  const lots = []; // one row per received stock line

  // ---- Receipts, IQC outcomes, kit batch usage lookup ----
  const kitIssues = await KitIssue.find({ status: "issued" })
    .populate("vendor", "companyName")
    .sort({ createdAt: 1 })
    .lean();
  const batchUse = new Map(); // `${partId|pn}|${batch}` -> ["Kit 1 → Vendor: 5", ...]
  for (const iss of kitIssues) {
    for (const line of iss.lines || []) {
      if (!(line.qtyIssued > 0)) continue;
      const pnKey = line.ttUniquePartNumber || String(line.part || "");
      for (const b of line.batchBreakdown || []) {
        if (!(b.quantity > 0)) continue;
        const k = `${pnKey}|${b.batchCode || ""}`;
        if (!batchUse.has(k)) batchUse.set(k, []);
        batchUse
          .get(k)
          .push(`${iss.issueCode || iss.kitName} → ${iss.vendor?.companyName || "—"}: ${b.quantity}`);
      }
    }
  }

  const stockEntries = await StockEntry.find({})
    .populate("vendor", "companyName")
    .populate("purchaseOrder", "documentType documentNumber")
    .populate("appliedVia", "invoiceNumber")
    .populate("part", "ttUniquePartNumber itemDescription unit")
    .sort({ createdAt: 1 })
    .lean();

  if (vendorEventsAllowed) {
    for (const e of stockEntries) {
      const pn = e.part?.ttUniquePartNumber || "";
      const desc = e.part?.itemDescription || "";
      if (!matchesSearch(pn, desc)) continue;
      if (!vendorOk(e.vendor?._id)) continue;

      const vName = e.vendor?.companyName || "—";
      const poRef = e.purchaseOrder
        ? `${e.purchaseOrder.documentType || "PO/PI"} ${e.purchaseOrder.documentNumber || ""}`.trim()
        : "";
      const invRef = e.appliedVia?.invoiceNumber ? `Tax invoice ${e.appliedVia.invoiceNumber}` : "";
      const docRef = [poRef, invRef].filter(Boolean).join(" · ");
      const rep = e.iqcReport || {};
      const iqcDate = rep.inspectedAt || e.appliedAt || e.updatedAt;

      if (wanted.has("received") && inRange(e.createdAt)) {
        events.push({
          date: e.createdAt, type: "received", pn, desc, unit: e.unit || e.part?.unit || "",
          party: vName, ref: docRef, batch: e.batchCode || "", qty: e.quantityReceived,
          status: IQC_STATUS_LABEL[e.iqcStatus] || "", by: e.enteredBy || "", note: e.remarks || "",
        });
      }
      if (e.iqcStatus === "accepted" && wanted.has("iqc_approved") && inRange(iqcDate)) {
        events.push({
          date: iqcDate, type: "iqc_approved", pn, desc, unit: e.unit || e.part?.unit || "",
          party: vName, ref: docRef, batch: e.batchCode || "", qty: e.quantityReceived,
          status: IQC_STATUS_LABEL.accepted, by: rep.inspectedBy || "",
          note:
            rep.originalQuantity != null && rep.originalQuantity !== e.quantityReceived
              ? `Approved ${e.quantityReceived} of ${rep.originalQuantity} received`
              : "",
        });
      }
      if (e.iqcStatus === "rejected" && wanted.has("iqc_rejected") && inRange(iqcDate)) {
        events.push({
          date: iqcDate, type: "iqc_rejected", pn, desc, unit: e.unit || e.part?.unit || "",
          party: vName, ref: docRef, batch: e.batchCode || "", qty: e.quantityReceived,
          status: IQC_STATUS_LABEL.rejected, by: rep.inspectedBy || "",
          note: rep.rejectionReason ? `Reason: ${rep.rejectionReason}` : "",
        });
      }

      if (inRange(e.createdAt) || inRange(iqcDate)) {
        lots.push({
          date: e.createdAt, vendor: vName, po: poRef, invoice: e.appliedVia?.invoiceNumber || "",
          batch: e.batchCode || "", pn, desc, qty: e.quantityReceived,
          unit: e.unit || e.part?.unit || "", rate: e.price ?? "",
          status: IQC_STATUS_LABEL[e.iqcStatus] || "",
          iqcBy: rep.inspectedBy || "", iqcAt: e.iqcStatus === "accepted" || e.iqcStatus === "rejected" ? iqcDate : null,
          reason: rep.rejectionReason || "", enteredBy: e.enteredBy || "",
          kits: (batchUse.get(`${pn}|${e.batchCode || ""}`) || []).join("; "),
        });
      }
    }
  }

  // ---- Kits issued to vendors ----
  if (vendorEventsAllowed && wanted.has("kit_issued")) {
    for (const iss of kitIssues) {
      if (!inRange(iss.createdAt)) continue;
      if (!vendorOk(iss.vendor?._id)) continue;
      for (const line of iss.lines || []) {
        if (!(line.qtyIssued > 0)) continue;
        if (!matchesSearch(line.ttUniquePartNumber, line.itemDescription)) continue;
        events.push({
          date: iss.createdAt, type: "kit_issued", pn: line.ttUniquePartNumber || "",
          desc: line.itemDescription || "", unit: "", party: iss.vendor?.companyName || "—",
          ref: `Kit issue ${iss.issueCode || iss.kitName}`,
          batch: (line.batchBreakdown || [])
            .filter((b) => b.quantity > 0)
            .map((b) => `${b.batchCode || "no batch"}: ${b.quantity}`)
            .join(", "),
          qty: line.qtyIssued, status: line.qtyShort > 0 ? `Short by ${line.qtyShort}` : "",
          by: iss.issuedBy || "", note: iss.remarks || "",
        });
      }
    }
  }

  // ---- R&D issues ----
  if (rndEventsAllowed && wanted.has("rnd_issued")) {
    const rndParts = await Part.find({ "rndIssues.0": { $exists: true } })
      .select("ttUniquePartNumber itemDescription unit rndIssues")
      .lean();
    for (const p of rndParts) {
      if (!matchesSearch(p.ttUniquePartNumber, p.itemDescription)) continue;
      for (const r of p.rndIssues || []) {
        const key = r.person ? String(r.person) : `name:${r.personName}`;
        if (!personOk(key)) continue;
        if (!inRange(r.date)) continue;
        events.push({
          date: r.date, type: "rnd_issued", pn: p.ttUniquePartNumber, desc: p.itemDescription,
          unit: p.unit || "", party: r.personName || "", ref: "R&D issue", batch: "",
          qty: r.quantity, status: "", by: r.issuedBy || "", note: r.remarks || "",
        });
      }
    }
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  lots.sort((a, b) => new Date(a.date) - new Date(b.date));

  // ---------------- workbook ----------------
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stock management";
  const head = (ws) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  };
  const FILL = {
    received: "FFEAF2FB", iqc_approved: "FFE6F4EA", iqc_rejected: "FFFCE8E6",
    rnd_issued: "FFFFF4E0", kit_issued: "FFF1E8FA",
  };

  const led = wb.addWorksheet("Stock movement", { views: [{ state: "frozen", ySplit: 1 }] });
  led.columns = [
    { header: "Date", key: "date", width: 17 },
    { header: "TT part number", key: "pn", width: 20 },
    { header: "Item description", key: "desc", width: 40 },
    { header: "Movement", key: "move", width: 28 },
    { header: "Vendor / Person", key: "party", width: 28 },
    { header: "Document / reference", key: "ref", width: 34 },
    { header: "Batch (WW/YY)", key: "batch", width: 18 },
    { header: "Qty", key: "qty", width: 10 },
    { header: "Unit", key: "unit", width: 7 },
    { header: "Effect on stock", key: "effect", width: 26 },
    { header: "Status", key: "status", width: 30 },
    { header: "Done by", key: "by", width: 18 },
    { header: "Remarks / reason", key: "note", width: 36 },
  ];
  for (const ev of events) {
    const row = led.addRow({
      date: fmt(ev.date), pn: ev.pn, desc: ev.desc, move: MOVEMENT_TYPES[ev.type].label,
      party: ev.party, ref: ev.ref, batch: ev.batch, qty: ev.qty, unit: ev.unit,
      effect: MOVEMENT_TYPES[ev.type].effect, status: ev.status, by: ev.by, note: ev.note,
    });
    row.getCell("move").fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[ev.type] } };
  }
  head(led);
  led.getColumn("qty").alignment = { horizontal: "right" };
  if (events.length > 0) led.autoFilter = { from: "A1", to: `M${events.length + 1}` };

  const lot = wb.addWorksheet("Receipts (lot trace)", { views: [{ state: "frozen", ySplit: 1 }] });
  lot.columns = [
    { header: "Received on", key: "date", width: 17 },
    { header: "Received from (vendor)", key: "vendor", width: 28 },
    { header: "PO / PI", key: "po", width: 20 },
    { header: "Tax invoice no.", key: "invoice", width: 18 },
    { header: "Batch (WW/YY)", key: "batch", width: 14 },
    { header: "TT part number", key: "pn", width: 20 },
    { header: "Item description", key: "desc", width: 40 },
    { header: "Qty", key: "qty", width: 10 },
    { header: "Unit", key: "unit", width: 7 },
    { header: "Rate", key: "rate", width: 10 },
    { header: "Current status", key: "status", width: 32 },
    { header: "IQC by", key: "iqcBy", width: 16 },
    { header: "IQC date", key: "iqcAt", width: 17 },
    { header: "Rejection reason", key: "reason", width: 30 },
    { header: "Entered by", key: "enteredBy", width: 16 },
    { header: "Kits issued from this part + batch", key: "kits", width: 50 },
  ];
  for (const l of lots) lot.addRow({ ...l, date: fmt(l.date), iqcAt: fmt(l.iqcAt) });
  head(lot);
  lot.getColumn("qty").alignment = { horizontal: "right" };
  if (lots.length > 0) lot.autoFilter = { from: "A1", to: `P${lots.length + 1}` };

  // Part-wise summary of the (filtered) movements.
  const byPart = new Map();
  const bucket = (ev) => {
    if (!byPart.has(ev.pn)) {
      byPart.set(ev.pn, {
        pn: ev.pn, desc: ev.desc, received: 0, approved: 0, rejected: 0, rnd: 0, kits: 0,
        from: new Set(), kitTo: new Set(), rndTo: new Set(),
      });
    }
    return byPart.get(ev.pn);
  };
  for (const ev of events) {
    const b = bucket(ev);
    if (ev.type === "received") { b.received += ev.qty; b.from.add(ev.party); }
    if (ev.type === "iqc_approved") b.approved += ev.qty;
    if (ev.type === "iqc_rejected") b.rejected += ev.qty;
    if (ev.type === "rnd_issued") { b.rnd += ev.qty; b.rndTo.add(ev.party); }
    if (ev.type === "kit_issued") { b.kits += ev.qty; b.kitTo.add(ev.party); }
  }
  const sum = wb.addWorksheet("Part-wise summary", { views: [{ state: "frozen", ySplit: 1 }] });
  sum.columns = [
    { header: "TT part number", key: "pn", width: 20 },
    { header: "Item description", key: "desc", width: 40 },
    { header: "Received", key: "received", width: 11 },
    { header: "IQC approved", key: "approved", width: 13 },
    { header: "IQC rejected", key: "rejected", width: 13 },
    { header: "Issued to R&D", key: "rnd", width: 14 },
    { header: "Issued in kits", key: "kits", width: 14 },
    { header: "Received from", key: "from", width: 36 },
    { header: "Kits issued to", key: "kitTo", width: 36 },
    { header: "R&D issued to", key: "rndTo", width: 30 },
  ];
  [...byPart.values()]
    .sort((a, b) => a.pn.localeCompare(b.pn))
    .forEach((b) =>
      sum.addRow({ ...b, from: [...b.from].join(", "), kitTo: [...b.kitTo].join(", "), rndTo: [...b.rndTo].join(", ") })
    );
  head(sum);
  for (const c of ["C", "D", "E", "F", "G"]) sum.getColumn(c).alignment = { horizontal: "right" };
  if (byPart.size > 0) {
    const last = byPart.size + 1;
    const t = sum.addRow({ pn: "TOTAL" });
    for (const c of ["C", "D", "E", "F", "G"]) t.getCell(c).value = { formula: `SUM(${c}2:${c}${last})` };
    t.font = { bold: true };
    sum.autoFilter = { from: "A1", to: `J${last}` };
  }

  const note = wb.addWorksheet("Report filters");
  note.columns = [{ width: 26 }, { width: 80 }];
  [
    ["Report", "Complete stock movement history"],
    ["Movements included", [...wanted].map((t) => MOVEMENT_TYPES[t].label).join(", ")],
    ["Vendor filter", vendorId ? "Selected vendor (receipts from them + kits issued to them)" : "All vendors"],
    ["R&D person filter", personKey ? "Selected person (R&D issues to them)" : "Everyone"],
    ["From", req.query.from || "Beginning"],
    ["To", req.query.to || "Today"],
    ["Part filter", partSet.size ? [...partSet].join(", ") : search || "All parts"],
    ["Movement rows", events.length],
    ["How to read", "Received = booked in from a vendor (pending IQC). IQC approved = credited to main stock. IQC rejected = held aside, not counted. R&D / Kit rows = stock that left main stock."],
    ["Batch / kits column", "Kit issues draw FIFO from batches (WW/YY of the tax invoice). The lot-trace sheet lists, per part + batch, which kit issues (and which vendor) took stock from it; if two receipts of one part share a batch code, both rows show the combined list."],
    ["Generated", `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`],
  ].forEach((r) => note.addRow(r));
  note.getColumn(1).font = { bold: true };

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="stock-movement-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/*
  GET /api/parts/export/issued-stock-xlsx — ADMIN ONLY.
  Custom stock report: where stock has gone OUT to.
    scope=vendor | rnd | both   (default both)
    vendor=<vendorId>           only that vendor (kit issues)
    person=<userId | name:..>   only that R&D person
    from=YYYY-MM-DD&to=YYYY-MM-DD   issue date range (inclusive)
    search=<text>               part number / description contains text
  Vendor side comes from issued kits (every kit edit only ever adds its own
  extra quantity, so summing all issued documents gives the true total).
  R&D side comes from each part's rndIssues ledger. Each side gets a
  line-by-line sheet plus a per-party / per-part summary sheet.
*/
export const exportIssuedStockXlsx = asyncHandler(async (req, res) => {
  const scope = ["vendor", "rnd", "both"].includes(req.query.scope) ? req.query.scope : "both";
  const vendorId = req.query.vendor ? String(req.query.vendor) : "";
  const personKey = req.query.person ? String(req.query.person) : "";
  const search = String(req.query.search || "").trim().toLowerCase();
  const partSet = await resolvePartSet(req.query.parts);

  let fromDate = null;
  let toDate = null;
  if (req.query.from) {
    const d = new Date(`${req.query.from}T00:00:00.000`);
    if (!Number.isNaN(d.getTime())) fromDate = d;
  }
  if (req.query.to) {
    const d = new Date(`${req.query.to}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) toDate = d;
  }
  const inRange = (dt) => {
    const t = new Date(dt).getTime();
    if (fromDate && t < fromDate.getTime()) return false;
    if (toDate && t > toDate.getTime()) return false;
    return true;
  };
  const matchesSearch = (pn, desc) =>
    (partSet.size === 0 || partSet.has(pn)) &&
    (!search || `${pn || ""} ${desc || ""}`.toLowerCase().includes(search));
  const fmtDate = (dt) => new Date(dt).toISOString().slice(0, 16).replace("T", " ");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Stock management";

  const styleHeader = (ws) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  };

  let vendorLineCount = 0;
  let rndLineCount = 0;
  let vendorLabel = "All vendors";
  let personLabel = "Everyone";

  // ---------------- Issued to vendors (kits) ----------------
  if (scope === "vendor" || scope === "both") {
    const filter = { status: "issued", vendor: { $ne: null } };
    if (vendorId && mongoose.Types.ObjectId.isValid(vendorId)) filter.vendor = vendorId;
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = fromDate;
      if (toDate) filter.createdAt.$lte = toDate;
    }
    const issues = await KitIssue.find(filter)
      .populate("vendor", "companyName")
      .sort({ createdAt: 1 })
      .lean();

    const detail = wb.addWorksheet("Issued to vendors", { views: [{ state: "frozen", ySplit: 1 }] });
    detail.columns = [
      { header: "Date", key: "date", width: 17 },
      { header: "Vendor", key: "vendor", width: 30 },
      { header: "Issue code", key: "code", width: 14 },
      { header: "Kit", key: "kit", width: 26 },
      { header: "TT part number", key: "pn", width: 20 },
      { header: "Item description", key: "desc", width: 44 },
      { header: "Qty issued", key: "qty", width: 12 },
      { header: "Qty short", key: "short", width: 11 },
      { header: "Batches (FIFO)", key: "batches", width: 26 },
      { header: "Issued by", key: "by", width: 18 },
      { header: "Remarks", key: "remarks", width: 30 },
    ];

    const summary = new Map(); // vendor|pn -> row
    for (const iss of issues) {
      const vName = iss.vendor?.companyName || "—";
      for (const line of iss.lines || []) {
        if (!(line.qtyIssued > 0)) continue;
        if (!matchesSearch(line.ttUniquePartNumber, line.itemDescription)) continue;
        vendorLineCount += 1;
        detail.addRow({
          date: fmtDate(iss.createdAt),
          vendor: vName,
          code: iss.issueCode || "",
          kit: iss.kitName || "",
          pn: line.ttUniquePartNumber || "",
          desc: line.itemDescription || "",
          qty: line.qtyIssued,
          short: line.qtyShort || 0,
          batches: (line.batchBreakdown || [])
            .map((b) => `${b.batchCode || "no batch"}: ${b.quantity}`)
            .join(", "),
          by: iss.issuedBy || "",
          remarks: iss.remarks || "",
        });
        const key = `${vName}|${line.ttUniquePartNumber}`;
        if (!summary.has(key)) {
          summary.set(key, {
            vendor: vName,
            pn: line.ttUniquePartNumber || "",
            desc: line.itemDescription || "",
            qty: 0,
            issues: new Set(),
          });
        }
        const row = summary.get(key);
        row.qty += line.qtyIssued;
        row.issues.add(String(iss._id));
      }
    }
    styleHeader(detail);
    detail.getColumn("qty").alignment = { horizontal: "right" };
    detail.getColumn("short").alignment = { horizontal: "right" };
    if (vendorLineCount > 0) detail.autoFilter = { from: "A1", to: `K${vendorLineCount + 1}` };

    const sum = wb.addWorksheet("Vendor summary", { views: [{ state: "frozen", ySplit: 1 }] });
    sum.columns = [
      { header: "Vendor", key: "vendor", width: 30 },
      { header: "TT part number", key: "pn", width: 20 },
      { header: "Item description", key: "desc", width: 44 },
      { header: "Total qty issued", key: "qty", width: 16 },
      { header: "No. of kit issues", key: "n", width: 16 },
    ];
    [...summary.values()]
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.pn.localeCompare(b.pn))
      .forEach((r) => sum.addRow({ vendor: r.vendor, pn: r.pn, desc: r.desc, qty: r.qty, n: r.issues.size }));
    styleHeader(sum);
    sum.getColumn("qty").alignment = { horizontal: "right" };
    sum.getColumn("n").alignment = { horizontal: "right" };
    if (summary.size > 0) {
      const last = summary.size + 1;
      const t = sum.addRow({ vendor: "TOTAL" });
      t.getCell("D").value = { formula: `SUM(D2:D${last})` };
      t.font = { bold: true };
      sum.autoFilter = { from: "A1", to: `E${last}` };
    }
    if (vendorId) {
      const v = issues.find((i) => i.vendor)?.vendor;
      vendorLabel = v?.companyName || vendorId;
    }
  }

  // ---------------- Issued to R&D (people) ----------------
  if (scope === "rnd" || scope === "both") {
    const parts = await Part.find({ "rndIssues.0": { $exists: true } })
      .select("ttUniquePartNumber itemDescription unit rndStock rndIssues")
      .sort({ ttUniquePartNumber: 1 })
      .lean();

    const detail = wb.addWorksheet("Issued to R&D", { views: [{ state: "frozen", ySplit: 1 }] });
    detail.columns = [
      { header: "Date", key: "date", width: 17 },
      { header: "Issued to (person)", key: "person", width: 26 },
      { header: "TT part number", key: "pn", width: 20 },
      { header: "Item description", key: "desc", width: 44 },
      { header: "Unit", key: "unit", width: 8 },
      { header: "Qty issued", key: "qty", width: 12 },
      { header: "Issued by", key: "by", width: 18 },
      { header: "Remarks", key: "remarks", width: 30 },
    ];

    const rows = [];
    for (const p of parts) {
      if (!matchesSearch(p.ttUniquePartNumber, p.itemDescription)) continue;
      for (const iss of p.rndIssues || []) {
        const key = iss.person ? String(iss.person) : `name:${iss.personName}`;
        if (personKey && key !== personKey) continue;
        if ((fromDate || toDate) && !inRange(iss.date)) continue;
        rows.push({ p, iss, key });
      }
    }
    rows.sort((a, b) => new Date(a.iss.date) - new Date(b.iss.date));

    const summary = new Map(); // person|pn -> row
    for (const { p, iss, key } of rows) {
      rndLineCount += 1;
      detail.addRow({
        date: fmtDate(iss.date),
        person: iss.personName || "",
        pn: p.ttUniquePartNumber || "",
        desc: p.itemDescription || "",
        unit: p.unit || "",
        qty: iss.quantity,
        by: iss.issuedBy || "",
        remarks: iss.remarks || "",
      });
      const sk = `${key}|${p.ttUniquePartNumber}`;
      if (!summary.has(sk)) {
        summary.set(sk, {
          person: iss.personName || "",
          pn: p.ttUniquePartNumber || "",
          desc: p.itemDescription || "",
          unit: p.unit || "",
          qty: 0,
          n: 0,
        });
      }
      const r = summary.get(sk);
      r.qty += iss.quantity;
      r.n += 1;
      if (personKey) personLabel = iss.personName || personKey;
    }
    styleHeader(detail);
    detail.getColumn("qty").alignment = { horizontal: "right" };
    if (rndLineCount > 0) detail.autoFilter = { from: "A1", to: `H${rndLineCount + 1}` };

    const sum = wb.addWorksheet("R&D summary", { views: [{ state: "frozen", ySplit: 1 }] });
    sum.columns = [
      { header: "Person", key: "person", width: 26 },
      { header: "TT part number", key: "pn", width: 20 },
      { header: "Item description", key: "desc", width: 44 },
      { header: "Unit", key: "unit", width: 8 },
      { header: "Total qty issued", key: "qty", width: 16 },
      { header: "No. of issues", key: "n", width: 14 },
    ];
    [...summary.values()]
      .sort((a, b) => a.person.localeCompare(b.person) || a.pn.localeCompare(b.pn))
      .forEach((r) => sum.addRow(r));
    styleHeader(sum);
    sum.getColumn("qty").alignment = { horizontal: "right" };
    sum.getColumn("n").alignment = { horizontal: "right" };
    if (summary.size > 0) {
      const last = summary.size + 1;
      const t = sum.addRow({ person: "TOTAL" });
      t.getCell("E").value = { formula: `SUM(E2:E${last})` };
      t.font = { bold: true };
      sum.autoFilter = { from: "A1", to: `F${last}` };
    }
  }

  // ---------------- Filters used ----------------
  const note = wb.addWorksheet("Report filters");
  note.columns = [{ width: 28 }, { width: 60 }];
  [
    ["Report", "Custom stock report — issued to vendors / R&D"],
    ["Scope", scope === "both" ? "Vendors and R&D" : scope === "vendor" ? "Vendors only" : "R&D only"],
    ["Vendor", scope === "rnd" ? "n/a" : vendorLabel],
    ["R&D person", scope === "vendor" ? "n/a" : personLabel],
    ["From", req.query.from || "Beginning"],
    ["To", req.query.to || "Today"],
    ["Part filter", partSet.size ? [...partSet].join(", ") : search || "All parts"],
    ["Vendor lines", scope === "rnd" ? "n/a" : vendorLineCount],
    ["R&D lines", scope === "vendor" ? "n/a" : rndLineCount],
    ["Note", "Vendor figures come from issued kits (quantity actually deducted). R&D figures come from R&D stock issues."],
    ["Generated", `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`],
  ].forEach((r) => note.addRow(r));
  note.getColumn(1).font = { bold: true };

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="issued-stock-report-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// GET /api/parts/export/vendor-links-csv — one row per part<->vendor link
// (the "related details" alongside the parts master itself), ADMIN ONLY.
export const exportPartVendorLinksCsv = asyncHandler(async (req, res) => {
  const parts = await Part.find({ vendors: { $exists: true, $ne: [] } })
    .populate("vendors", "companyName taxRegistrationNo phone email activeStatus")
    .sort({ ttUniquePartNumber: 1 })
    .lean();

  const header = [
    "TT unique part number",
    "Item description",
    "Vendor name",
    "Vendor GST / tax reg. no.",
    "Vendor phone",
    "Vendor email",
    "Vendor status",
  ];

  const rows = [];
  for (const p of parts) {
    for (const v of p.vendors || []) {
      if (!v) continue;
      rows.push([
        p.ttUniquePartNumber,
        p.itemDescription || "",
        v.companyName || "",
        v.taxRegistrationNo || "",
        v.phone || "",
        v.email || "",
        v.activeStatus || "",
      ]);
    }
  }

  sendCsv(res, "part-vendor-details", csvFrom(header, rows));
});