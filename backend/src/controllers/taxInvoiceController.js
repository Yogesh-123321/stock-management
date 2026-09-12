import asyncHandler from "express-async-handler";
import { uploadFileToCloudinary } from "../config/cloudinary.js";
import mongoose from "mongoose";
import TaxInvoice from "../models/TaxInvoice.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Vendor from "../models/Vendor.js";
import StockEntry from "../models/StockEntry.js";
import Part from "../models/Part.js";
import { generateBatchCode } from "../utils/batchCode.js";
import { extractInvoiceLineItems, AiExtractionError } from "../utils/aiDocumentExtract.js";
import { getEmbeddings, cosineSimilarity, EmbeddingError } from "../utils/embeddings.js";

// GET /api/tax-invoices?purchaseOrder=&vendor=
export const getTaxInvoices = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.purchaseOrder) filter.purchaseOrder = req.query.purchaseOrder;
  if (req.query.vendor) filter.vendor = req.query.vendor;

  const invoices = await TaxInvoice.find(filter)
    .populate("vendor purchaseOrder")
    .sort({ createdAt: -1 });
  res.json(invoices);
});

// GET /api/tax-invoices/:id
export const getTaxInvoiceById = asyncHandler(async (req, res) => {
  const invoice = await TaxInvoice.findById(req.params.id).populate("vendor purchaseOrder");
  if (!invoice) {
    res.status(404);
    throw new Error("Tax invoice not found");
  }
  res.json(invoice);
});

// Shared by getTaxInvoiceStockEntries and getTaxInvoiceLineMatch: every
// stock entry booked against this invoice's PO/PI (and its cross-linked
// sibling document), or — when there's no PO/PI on record — every
// PO/PI-less stock entry for the same vendor.
const resolveStockEntriesForInvoice = async (invoice) => {
  const docIds = [];
  const linkedDocs = [];

  if (invoice.purchaseOrder) {
    docIds.push(invoice.purchaseOrder._id);
    linkedDocs.push(invoice.purchaseOrder);

    // The PO and PI of one delivery are cross-linked — stock may have been
    // booked against either of them, so include the sibling as well.
    const sibling =
      (invoice.purchaseOrder.linkedDocument &&
        (await PurchaseOrder.findById(invoice.purchaseOrder.linkedDocument))) ||
      (await PurchaseOrder.findOne({ linkedDocument: invoice.purchaseOrder._id }));

    if (sibling) {
      docIds.push(sibling._id);
      linkedDocs.push(sibling);
    }
  }

  const linkedDocuments = linkedDocs.map((d) => ({
    _id: d._id,
    documentType: d.documentType,
    documentNumber: d.documentNumber,
    totalQuantity: d.totalQuantity,
    lifecycleStatus: d.lifecycleStatus,
  }));

  let entries;
  let matchedBy;

  if (docIds.length > 0) {
    // Normal case: invoice has a PO/PI on record — match stock entries
    // booked against that document (or its cross-linked sibling).
    entries = await StockEntry.find({ purchaseOrder: { $in: docIds } })
      .populate("part")
      .sort({ createdAt: -1 });
    matchedBy = "purchase_order";
  } else {
    // No PO/PI on record for this invoice (material/paperwork arrived
    // without one). StockEntry.purchaseOrder is also optional and can be
    // null in the same situation — so the only safe join left is vendor,
    // restricted to stock entries that are *also* PO/PI-less. Matching by
    // vendor alone would pull in unrelated, properly-linked deliveries.
    entries = await StockEntry.find({ vendor: invoice.vendor?._id, purchaseOrder: null })
      .populate("part")
      .sort({ createdAt: -1 });
    matchedBy = "vendor_without_document";
  }

  return { entries, matchedBy, linkedDocuments };
};

// GET /api/tax-invoices/:id/stock-entries
// Every stock entry booked against the PO/PI (and its cross-linked sibling
// document) that this tax invoice belongs to — shown in the drill-down dialog.
//
// Response shape is dictated by <InvoiceStockDialog/> on the frontend:
//   { invoice, entries, totalQuantity, matchedBy, linkedDocuments }
export const getTaxInvoiceStockEntries = asyncHandler(async (req, res) => {
  const invoice = await TaxInvoice.findById(req.params.id).populate("vendor purchaseOrder");
  if (!invoice) {
    res.status(404);
    throw new Error("Tax invoice not found");
  }

  const { entries, matchedBy, linkedDocuments } = await resolveStockEntriesForInvoice(invoice);

  const totalQuantity = entries.reduce(
    (sum, entry) => sum + (Number(entry.quantityReceived) || 0),
    0
  );

  res.json({ invoice, entries, totalQuantity, matchedBy, linkedDocuments });
});

const isPdfUrlOrName = (invoice) =>
  /\.pdf(\?|$)/i.test(invoice?.documentUrl || "") || /\.pdf$/i.test(invoice?.originalFileName || "");

const partDescriptionOf = (part) => part?.itemDescription || "";
const partNumberOf = (part) => part?.ttUniquePartNumber || part?.manufacturerPartNumber || "";

// Score two things (0-1) by exact match, or a loose "one contains the
// other" fallback for part numbers keyed/printed slightly differently
// (leading zeros, dashes, casing already stripped by toUpperCase/trim).
const partNumberScore = (a, b) => {
  const x = String(a || "").trim().toUpperCase();
  const y = String(b || "").trim().toUpperCase();
  if (!x || !y) return null; // no signal either way
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.6;
  return 0;
};

const quantityScore = (a, b) => {
  if (a == null || b == null) return null; // no signal either way
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x === y) return 1;
  const diff = Math.abs(x - y);
  const base = Math.max(x, y, 1);
  return Math.max(0, 1 - diff / base);
};

// Weighted blend of however many of the three signals are actually
// available for this pair — a signal that's missing on one side (e.g. no
// part number printed on the invoice) is left out of the average rather
// than silently counted as 0, so a good description match on a document
// with no part numbers at all doesn't get unfairly capped.
const combineScores = (descSim, partScore, qtyScore) => {
  const weighted = [
    [descSim, 0.55],
    [partScore, 0.25],
    [qtyScore, 0.2],
  ].filter(([s]) => s != null);
  if (weighted.length === 0) return 0;
  const totalWeight = weighted.reduce((sum, [, w]) => sum + w, 0);
  const sum = weighted.reduce((acc, [s, w]) => acc + s * w, 0);
  return sum / totalWeight;
};

const MIN_MATCH_SIMILARITY = 0.35; // below this, descriptions are treated as unrelated, not a weak match

// GET /api/tax-invoices/:id/line-match?refresh=true
//
// Reads the invoice PDF's own line items (via AI, cached on the invoice
// document afterwards) and semantically matches each one to a stock entry
// booked against this invoice — via embeddings on the description text,
// blended with part-number and quantity agreement into one correctness
// score per pair. Feeds <InvoiceStockDialog/>'s "Matched" and
// "Differences" tabs.
export const getTaxInvoiceLineMatch = asyncHandler(async (req, res) => {
  const invoice = await TaxInvoice.findById(req.params.id).populate("vendor purchaseOrder");
  if (!invoice) {
    res.status(404);
    throw new Error("Tax invoice not found");
  }

  if (!isPdfUrlOrName(invoice)) {
    res.status(400);
    throw new Error("Only PDF invoices can be read for line-item matching right now");
  }

  const forceRefresh = String(req.query.refresh || "") === "true";

  if (!invoice.extractedLines || forceRefresh) {
    let fileResponse;
    try {
      fileResponse = await fetch(invoice.documentUrl);
      if (!fileResponse.ok) throw new Error(`HTTP ${fileResponse.status} fetching invoice file`);
    } catch (err) {
      res.status(502);
      throw new Error(`Couldn't download the invoice file to read it: ${err.message}`);
    }
    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      const { lineItems, modelUsed } = await extractInvoiceLineItems({
        buffer,
        mimeType: "application/pdf",
        fileName: invoice.originalFileName || "invoice.pdf",
      });
      invoice.extractedLines = lineItems;
      invoice.lineExtractionModel = modelUsed;
      invoice.lineExtractedAt = new Date();
      await invoice.save();
    } catch (err) {
      res.status(err instanceof AiExtractionError ? 502 : 500);
      throw new Error(err.message || "Could not read line items from this invoice");
    }
  }

  const { entries: stockEntries } = await resolveStockEntriesForInvoice(invoice);
  const invoiceLines = invoice.extractedLines || [];

  if (invoiceLines.length === 0 || stockEntries.length === 0) {
    return res.json({
      lines: invoiceLines,
      modelUsed: invoice.lineExtractionModel,
      lineExtractedAt: invoice.lineExtractedAt,
      matches: [],
      unmatchedInvoiceLines: invoiceLines,
      unmatchedStockEntries: stockEntries,
    });
  }

  // One batched embeddings call for every invoice-line description and
  // every stock-entry (part) description, in a fixed order we can slice
  // back apart afterwards.
  const invoiceTexts = invoiceLines.map((l) => l.description || l.partNumber || "");
  const stockTexts = stockEntries.map((e) => partDescriptionOf(e.part) || partNumberOf(e.part) || "");

  let invoiceVectors;
  let stockVectors;
  try {
    const allVectors = await getEmbeddings([...invoiceTexts, ...stockTexts]);
    invoiceVectors = allVectors.slice(0, invoiceTexts.length);
    stockVectors = allVectors.slice(invoiceTexts.length);
  } catch (err) {
    res.status(err instanceof EmbeddingError ? 502 : 500);
    throw new Error(err.message || "Could not run semantic matching for this invoice");
  }

  // Score every invoice-line / stock-entry pair, then greedily assign
  // highest-scoring pairs first (each side used at most once) — simple and
  // good enough at the line counts a single delivery invoice has.
  const pairs = [];
  for (let i = 0; i < invoiceLines.length; i++) {
    for (let j = 0; j < stockEntries.length; j++) {
      const descSim = cosineSimilarity(invoiceVectors[i], stockVectors[j]);
      if (descSim < MIN_MATCH_SIMILARITY) continue;
      const partScore = partNumberScore(invoiceLines[i].partNumber, partNumberOf(stockEntries[j].part));
      const qtyScore = quantityScore(invoiceLines[i].quantity, stockEntries[j].quantityReceived);
      pairs.push({
        i,
        j,
        descSim,
        partScore,
        qtyScore,
        score: combineScores(descSim, partScore, qtyScore),
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const usedInvoiceLines = new Set();
  const usedStockEntries = new Set();
  const matches = [];

  for (const pair of pairs) {
    if (usedInvoiceLines.has(pair.i) || usedStockEntries.has(pair.j)) continue;
    usedInvoiceLines.add(pair.i);
    usedStockEntries.add(pair.j);

    const invoiceLine = invoiceLines[pair.i];
    const stockEntry = stockEntries[pair.j];
    const differences = [];
    if (pair.qtyScore != null && pair.qtyScore < 1) {
      differences.push({
        field: "quantity",
        invoiceValue: invoiceLine.quantity,
        enteredValue: stockEntry.quantityReceived,
      });
    }
    if (pair.partScore != null && pair.partScore < 1) {
      differences.push({
        field: "partNumber",
        invoiceValue: invoiceLine.partNumber,
        enteredValue: partNumberOf(stockEntry.part),
      });
    }

    matches.push({
      invoiceLine,
      stockEntry,
      score: Math.round(pair.score * 100),
      descriptionSimilarity: Math.round(pair.descSim * 100),
      differences,
    });
  }

  matches.sort((a, b) => b.score - a.score);

  const unmatchedInvoiceLines = invoiceLines.filter((_, i) => !usedInvoiceLines.has(i));
  const unmatchedStockEntries = stockEntries.filter((_, j) => !usedStockEntries.has(j));

  res.json({
    lines: invoiceLines,
    modelUsed: invoice.lineExtractionModel,
    lineExtractedAt: invoice.lineExtractedAt,
    matches,
    unmatchedInvoiceLines,
    unmatchedStockEntries,
  });
});

// Total quantity actually entered into stock against a PO/PI (and, when the
// PO and PI of the same delivery are cross-linked, against either of them).
const stockQtyForDocs = async (docIds) => {
  const ids = docIds.filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id)));
  if (ids.length === 0) return 0;
  const [row] = await StockEntry.aggregate([
    { $match: { purchaseOrder: { $in: ids } } },
    { $group: { _id: null, total: { $sum: "$quantityReceived" } } },
  ]);
  return row?.total || 0;
};

/*
  Reconcile a delivery once the tax invoice arrives.

  - Collects the PO and the PI of the delivery (they are cross-linked via
    linkedDocument) plus the quantity each of them declares.
  - Sums every stock entry booked against either document.
  - If all declared quantities are present and equal the stock quantity (and
    the invoice quantity, when it was captured), both documents are closed.
  - Otherwise they are deliberately left open so the shortfall/excess can be
    chased, and the mismatch is reported back to the caller.
*/
export const reconcileDelivery = async (primaryDoc, invoiceQuantity) => {
  if (!primaryDoc) return null;

  const docs = [primaryDoc];
  if (primaryDoc.linkedDocument) {
    const sibling = await PurchaseOrder.findById(primaryDoc.linkedDocument);
    if (sibling) docs.push(sibling);
  }

  const stockQty = await stockQtyForDocs(docs.map((d) => d._id));

  const declared = docs
    .filter((d) => d.totalQuantity !== null && d.totalQuantity !== undefined)
    .map((d) => ({ type: d.documentType, number: d.documentNumber || "", qty: Number(d.totalQuantity) }));

  const invQty =
    invoiceQuantity === undefined || invoiceQuantity === null || invoiceQuantity === ""
      ? null
      : Number(invoiceQuantity);

  // Every document of the delivery must declare a quantity, otherwise there is
  // nothing to reconcile against and the documents stay open.
  const allDeclared = declared.length === docs.length && declared.length > 0;
  const quantities = [...declared.map((d) => d.qty), stockQty];
  if (invQty !== null) quantities.push(invQty);

  const matched = allDeclared && quantities.every((q) => q === quantities[0]);

  if (matched) {
    await PurchaseOrder.updateMany(
      { _id: { $in: docs.map((d) => d._id) } },
      {
        lifecycleStatus: "closed",
        closedAt: new Date(),
        closedReason: "Auto-closed: PO / PI, stock entry and tax invoice quantities matched",
        status: "completed",
      }
    );
  }

  return {
    matched,
    stockQuantity: stockQty,
    invoiceQuantity: invQty,
    documents: declared,
    documentsClosed: matched,
    reason: matched
      ? "Quantities matched — PO/PI closed automatically"
      : !allDeclared
      ? "Quantity not recorded on every PO/PI of this delivery — left open"
      : "Quantities do not match — PO/PI left open",
  };
};

/*
  Credits stock for a delivery once its tax invoice has arrived.

  Material entered in Step 4 of the receiving wizard is logged as a
  StockEntry right away, but is deliberately kept OUT of the part's
  quantityInStock (stockApplied: false) until this point — the parts master
  should only ever reflect quantity that has actually been billed.

  Finds every not-yet-applied StockEntry for this delivery — matched the
  same way getTaxInvoiceStockEntries matches them (by PO/PI id, and its
  cross-linked sibling, or by vendor when neither document exists) — credits
  each entry's quantity to its part, marks the entry applied, and stamps it
  with a batch code (WW/YY) built from the invoice's own invoiceDate — see
  utils/batchCode.js. If the invoice didn't carry a date, invoiceDate is
  null and no batch code is generated (left blank rather than guessed from
  "today", since that would be exactly the stock-entry date this is meant
  to be independent of).
*/
const applyPendingStockForInvoice = async (poDoc, vendorId, invoiceId, invoiceDate) => {
  const docIds = [];
  if (poDoc) {
    docIds.push(poDoc._id);
    const sibling =
      (poDoc.linkedDocument && (await PurchaseOrder.findById(poDoc.linkedDocument))) ||
      (await PurchaseOrder.findOne({ linkedDocument: poDoc._id }));
    if (sibling) docIds.push(sibling._id);
  }

  const filter =
    docIds.length > 0
      ? { purchaseOrder: { $in: docIds }, stockApplied: false }
      : { vendor: vendorId, purchaseOrder: null, stockApplied: false };

  const pending = await StockEntry.find(filter).populate("part");
  const batchCode = generateBatchCode(invoiceDate);

  const appliedEntries = [];
  for (const entry of pending) {
    if (entry.part) {
      await Part.findByIdAndUpdate(entry.part._id, {
        $inc: { quantityInStock: Number(entry.quantityReceived) || 0 },
      });
    }
    entry.stockApplied = true;
    entry.appliedAt = new Date();
    entry.appliedVia = invoiceId;
    if (batchCode) entry.batchCode = batchCode;
    await entry.save();
    appliedEntries.push(entry);
  }

  return appliedEntries;
};

// POST /api/tax-invoices (upload the tax invoice for a delivery, after stock entry)
export const uploadTaxInvoice = asyncHandler(async (req, res) => {
  const { vendor, purchaseOrder, invoiceNumber, invoiceDate, notes, invoiceQuantity } = req.body;

  if (!vendor) {
    res.status(400);
    throw new Error("vendor is required");
  }
  if (!req.file) {
    res.status(400);
    throw new Error("Tax invoice file is required");
  }

  // A PO/PI link is optional — the invoice may be the only paperwork received.
  let poDoc = null;
  if (purchaseOrder) {
    poDoc = await PurchaseOrder.findById(purchaseOrder);
    if (!poDoc) {
      res.status(404);
      throw new Error("Purchase order / invoice for this delivery not found");
    }
  }

  // Filed under the vendor's own Cloudinary folder.
  const vendorDoc = await Vendor.findById(vendor).lean();
  const documentUrl = await uploadFileToCloudinary(req.file, {
    party: vendorDoc || { _id: vendor },
    kind: "vendor",
    category: "tax-invoices",
  });

  const invoice = await TaxInvoice.create({
    vendor,
    purchaseOrder: poDoc ? poDoc._id : null,
    invoiceNumber,
    invoiceDate: invoiceDate || undefined,
    notes,
    documentUrl,
    originalFileName: req.file.originalname,
  });

  // The invoice has now arrived — credit every stock entry for this
  // delivery that was still pending, into the parts master, and stamp
  // each with a batch code derived from the invoice's own date.
  const appliedEntries = await applyPendingStockForInvoice(
    poDoc,
    vendor,
    invoice._id,
    invoice.invoiceDate
  );
  const stockApplied = {
    count: appliedEntries.length,
    totalQuantity: appliedEntries.reduce((sum, e) => sum + (Number(e.quantityReceived) || 0), 0),
  };

  // Close the PO/PI automatically when everything lines up, else leave open.
  const reconciliation = await reconcileDelivery(poDoc, invoiceQuantity);

  const populated = await invoice.populate("vendor purchaseOrder");
  res.status(201).json({ ...populated.toObject(), reconciliation, stockApplied });
});