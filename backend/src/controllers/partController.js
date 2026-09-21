import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Part from "../models/Part.js";
import StockEntry from "../models/StockEntry.js";
import KitIssue from "../models/KitIssue.js";
import User from "../models/User.js";
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

// GET /api/parts/export/parts-csv — every field on the Part Master, ADMIN ONLY.
// GET /api/parts/export/parts-csv — every field on the Part Master, ADMIN ONLY.
export const exportPartsCsv = asyncHandler(async (req, res) => {
  const parts = await Part.find({})
    .populate("vendors", "companyName")
    .populate("alternateOf", "ttUniquePartNumber")
    .sort({ ttUniquePartNumber: 1 })
    .lean({ virtuals: true });

  const header = [
    "TT unique part number",
    "Type of part",
    "Manufacturer part number",
    "Item description",
    "Company code",
    "Category",
    "Part type / batch no.",
    "HSN code",
    "Unit",
    "Quantity in stock",
    "R&D stock",
    "R&D stock issued to",
    "Vendor(s)",
    "Is alternate part",
    "Alternate of",
    "Has photo",
    "Has datasheet",
    "Remarks",
    "Last edited by",
    "Last edited at",
    "Created at",
  ];

  const rows = parts.map((p) => [
    p.ttUniquePartNumber,
    p.typeOfPart || "",
    p.manufacturerPartNumber || "",
    p.itemDescription || "",
    p.companyCode || "",
    p.category || "",
    p.partTypeBatchNo || "",
    p.hsnCode || "",
    p.unit || "",
    p.quantityInStock ?? 0,
    p.rndStock ?? 0,
    (p.rndIssues || [])
      .map((i) => `${i.personName} (${i.quantity})`)
      .filter(Boolean)
      .join(" / "),
    (p.vendors || []).map((v) => v.companyName).filter(Boolean).join(" / "),
    p.isAlternatePart ? "Yes" : "No",
    p.alternateOf?.ttUniquePartNumber || "",
    p.photoUrl ? "Yes" : "No",
    p.datasheetUrl ? "Yes" : "No",
    p.remarks || "",
    p.lastEditedBy || "",
    p.lastEditedAt ? new Date(p.lastEditedAt).toLocaleString("en-IN") : "",
    p.createdAt ? new Date(p.createdAt).toLocaleString("en-IN") : "",
  ]);

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