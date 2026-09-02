import asyncHandler from "express-async-handler";
import { uploadFileToCloudinary } from "../config/cloudinary.js";
import mongoose from "mongoose";
import TaxInvoice from "../models/TaxInvoice.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Vendor from "../models/Vendor.js";
import StockEntry from "../models/StockEntry.js";

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

  const totalQuantity = entries.reduce(
    (sum, entry) => sum + (Number(entry.quantityReceived) || 0),
    0
  );

  res.json({ invoice, entries, totalQuantity, matchedBy, linkedDocuments });
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

  // Close the PO/PI automatically when everything lines up, else leave open.
  const reconciliation = await reconcileDelivery(poDoc, invoiceQuantity);

  const populated = await invoice.populate("vendor purchaseOrder");
  res.status(201).json({ ...populated.toObject(), reconciliation });
});