import asyncHandler from "express-async-handler";
import { uploadFileToCloudinary } from "../config/cloudinary.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Vendor from "../models/Vendor.js";
import PurchaseOrderGen from "../models/PurchaseOrderGen.js";

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toQty = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// GET /api/purchase-orders?vendor=&status=&documentType=&lifecycleStatus=&search=
// documentType: "Purchase Order" | "Proforma Invoice"  (POs and PIs are listed separately)
// lifecycleStatus: "open" | "closed"
export const getPurchaseOrders = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.vendor) filter.vendor = req.query.vendor;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.documentType) filter.documentType = req.query.documentType;
  if (req.query.lifecycleStatus) filter.lifecycleStatus = req.query.lifecycleStatus;
  if (req.query.search) {
    filter.documentNumber = { $regex: escapeRegex(req.query.search.trim()), $options: "i" };
  }

  const pos = await PurchaseOrder.find(filter).populate("vendor").sort({ createdAt: -1 });
  res.json(pos);
});

// GET /api/purchase-orders/open?documentType=Proforma Invoice
// Convenience list for the "pick an open PO / open PI" dropdowns.
export const getOpenDocuments = asyncHandler(async (req, res) => {
  // Backfill generated POs created before generator/receiving integration.
  // Prefer the stored vendor id; GSTIN/name matching only repairs older rows.
  if ((!req.query.documentType || req.query.documentType === "Purchase Order") && req.query.vendor) {
    const vendor = await Vendor.findById(req.query.vendor).lean();
    if (vendor) {
      const identity = [{ supplierVendor: vendor._id }];
      if (vendor.taxRegistrationNo) identity.push({ supplierGSTIN: vendor.taxRegistrationNo });
      if (vendor.companyName) identity.push({ supplierName: vendor.companyName });

      // Only admin-approved generated POs are usable in receiving.
      const generated = await PurchaseOrderGen.find({
        status: "open",
        approvalStatus: "approved",
        $or: identity,
      }).lean();

      await Promise.all(
        generated.map((po) =>
          PurchaseOrder.updateOne(
            { generatedSource: po._id },
            {
              $setOnInsert: {
                vendor: vendor._id,
                documentType: "Purchase Order",
                documentNumber: po.voucherNo,
                documentUrl: `/api/po-generator/${po._id}/download`,
                originalFileName: `${String(po.voucherNo).replace(/[\/:*?"<>|]/g, "-")}.pdf`,
                totalQuantity: po.totalQuantity,
                lifecycleStatus: "open",
                generatedSource: po._id,
                notes: "Created in Purchase Order Generator",
              },
            },
            { upsert: true },
          ),
        ),
      );
    }
  }

  // Records created before lifecycle tracking was introduced do not have a
  // lifecycleStatus field. They are still active documents, so treat them as
  // open until a user explicitly closes them.
  const filters = [
    {
      $or: [
        { lifecycleStatus: "open" },
        { lifecycleStatus: { $exists: false } },
        { lifecycleStatus: null },
      ],
    },
  ];

  if (req.query.documentType) filters.push({ documentType: req.query.documentType });
  if (req.query.vendor) filters.push({ vendor: req.query.vendor });

  const docs = await PurchaseOrder.find({ $and: filters })
    .populate("vendor")
    .sort({ createdAt: -1 })
    .limit(200);

  res.json(docs);
});

// GET /api/purchase-orders/:id
export const getPurchaseOrderById = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id).populate("vendor");
  if (!po) {
    res.status(404);
    throw new Error("Purchase order / invoice not found");
  }
  res.json(po);
});

// POST /api/purchase-orders (upload PO or Proforma Invoice for an approved vendor)
export const uploadPurchaseOrder = asyncHandler(async (req, res) => {
  const { vendor, documentType, documentNumber, notes, linkedDocument, totalQuantity } = req.body;

  if (!vendor || !documentType) {
    res.status(400);
    throw new Error("vendor and documentType are required");
  }
  if (!req.file) {
    res.status(400);
    throw new Error("Purchase order / proforma invoice file is required");
  }

  const vendorDoc = await Vendor.findById(vendor);
  if (!vendorDoc || vendorDoc.status !== "approved") {
    res.status(400);
    throw new Error("Vendor must be a registered and approved vendor before uploading a PO/invoice");
  }

  // Filed under the vendor's own folder, split by document type.
  const documentUrl = await uploadFileToCloudinary(req.file, {
    party: vendorDoc,
    kind: "vendor",
    category: documentType === "Proforma Invoice" ? "proforma-invoices" : "purchase-orders",
  });

  const po = await PurchaseOrder.create({
    vendor,
    documentType,
    documentNumber,
    notes,
    totalQuantity: toQty(totalQuantity),
    documentUrl,
    originalFileName: req.file.originalname,
    linkedDocument: linkedDocument || null,
    lifecycleStatus: "open",
  });

  // Cross-link the sibling document (e.g. the PO already uploaded for this
  // same delivery, right before the PI step) so their status stays in sync.
  if (linkedDocument) {
    await PurchaseOrder.findByIdAndUpdate(linkedDocument, { linkedDocument: po._id });
  }

  res.status(201).json(po);
});

// PATCH /api/purchase-orders/:id/quantity  { totalQuantity }
// Lets the receiving flow capture (or correct) the quantity on a document
// that was uploaded before quantities were tracked.
export const updatePOQuantity = asyncHandler(async (req, res) => {
  const qty = toQty(req.body.totalQuantity);
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error("Purchase order / invoice not found");
  }
  po.totalQuantity = qty;
  await po.save();
  res.json(po);
});

// PATCH /api/purchase-orders/:id/status  (receiving-flow status)
export const updatePOStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error("Purchase order / invoice not found");
  }
  po.status = status;
  await po.save();

  // Keep a linked PO/PI pair (same delivery) in the same status.
  if (po.linkedDocument) {
    await PurchaseOrder.findByIdAndUpdate(po.linkedDocument, { status });
  }

  res.json(po);
});

// PATCH /api/purchase-orders/:id/lifecycle  { lifecycleStatus: "open" | "closed" }
export const updatePOLifecycle = asyncHandler(async (req, res) => {
  const { lifecycleStatus, closedReason } = req.body;
  if (!["open", "closed"].includes(lifecycleStatus)) {
    res.status(400);
    throw new Error("lifecycleStatus must be 'open' or 'closed'");
  }

  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error("Purchase order / invoice not found");
  }

  po.lifecycleStatus = lifecycleStatus;
  po.closedAt = lifecycleStatus === "closed" ? new Date() : null;
  po.closedReason = lifecycleStatus === "closed" ? closedReason || "Closed manually" : "";
  await po.save();

  // A PO and its paired PI belong to the same delivery — close/open together.
  if (po.linkedDocument) {
    await PurchaseOrder.findByIdAndUpdate(po.linkedDocument, {
      lifecycleStatus,
      closedAt: po.closedAt,
      closedReason: po.closedReason,
    });
  }

  const populated = await po.populate("vendor");
  res.json(populated);
});
