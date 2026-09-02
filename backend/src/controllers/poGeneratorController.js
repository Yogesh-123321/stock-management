import PurchaseOrderGen from "../models/PurchaseOrderGen.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Vendor from "../models/Vendor.js";
import Buyer from "../models/Buyer.js";
import { generatePoPdf, PO_COMPANY, DEFAULT_DECLARATION } from "../utils/generatePoPdf.js";
import { amountInWordsRupees } from "../utils/numberToWordsIndian.js";
import { requestDocumentApproval } from "../utils/documentApproval.js";
import { uploadFileToCloudinary } from "../config/cloudinary.js";

/* ------------------------------------------------------------------ *
 * Voucher numbering — TISPL/PO/07/26-27, then 08, 09 …                *
 * Revisions of an existing PO become 07A, 07B, … without disturbing   *
 * the running series, exactly like the PI generator.                  *
 * ------------------------------------------------------------------ */
const PREFIX = "TISPL/PO";
const START_SEQ = 7;

export function financialYearLabel(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const start = d.getMonth() + 1 >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// TISPL/PO/07A/26-27 -> { seq: 7, revision: "A", fy: "26-27" }
export function parseVoucherNo(voucherNo) {
  const m = String(voucherNo || "").match(/^(.*)\/(\d+)([A-Z]*)\/(\d{2}-\d{2})$/);
  if (!m) return null;
  return { prefix: m[1], seq: Number(m[2]), revision: m[3] || "", fy: m[4] };
}

const buildVoucherNo = ({ prefix = PREFIX, seq, revision = "", fy }) =>
  `${prefix}/${String(seq).padStart(2, "0")}${revision}/${fy}`;

// "" -> A, A -> B, Z -> AA, AA -> AB …
function nextRevision(revision) {
  if (!revision) return "A";
  const chars = revision.split("");
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === "Z") {
      chars[i] = "A";
      i -= 1;
    } else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join("");
    }
  }
  return `A${chars.join("")}`;
}

async function computeNextVoucherNo(date = new Date()) {
  const fy = financialYearLabel(date);
  const docs = await PurchaseOrderGen.find({ voucherNo: new RegExp(`/${fy}$`) }, "voucherNo").lean();
  let maxSeq = START_SEQ - 1;
  for (const d of docs) {
    const parsed = parseVoucherNo(d.voucherNo);
    if (parsed && parsed.seq > maxSeq) maxSeq = parsed.seq;
  }
  return buildVoucherNo({ seq: maxSeq + 1, fy });
}

async function computeNextRevision(voucherNo) {
  const parsed = parseVoucherNo(voucherNo);
  if (!parsed) return `${voucherNo}-A`;
  let revision = nextRevision(parsed.revision);
  // Skip revisions that already exist.
  for (let guard = 0; guard < 100; guard += 1) {
    const candidate = buildVoucherNo({ ...parsed, revision });
    // eslint-disable-next-line no-await-in-loop
    const exists = await PurchaseOrderGen.exists({ voucherNo: candidate });
    if (!exists) return candidate;
    revision = nextRevision(revision);
  }
  return buildVoucherNo({ ...parsed, revision });
}

/* ------------------------------------------------------------------ *
 * Cloudinary archival — the generated PDF is uploaded to the          *
 * supplier's folder (vendors/<supplier-slug>-<gstin>/generated-po/)   *
 * once the PO is admin-approved, and the permanent URL is stored on   *
 * the record as `pdfUrl`. Downloads redirect to the archived file.    *
 * ------------------------------------------------------------------ */
async function archivePoPdf(doc) {
  const buffer = await generatePoPdf(doc);
  const safeName = String(doc.voucherNo).replace(/[\\/:*?"<>|]/g, "-");

  const pdfUrl = await uploadFileToCloudinary(
    { buffer, mimetype: "application/pdf", originalname: `${safeName}.pdf` },
    {
      party: { companyName: doc.supplierName, taxRegistrationNo: doc.supplierGSTIN },
      kind: "vendor",
      category: "generated-po",
    },
  );

  doc.pdfUrl = pdfUrl;
  await doc.save();
  return pdfUrl;
}

// Archival must never block approval/creation — if Cloudinary is
// down/misconfigured the PO is still saved and the download falls back to
// on-the-fly generation.
async function tryArchivePoPdf(doc) {
  try {
    return await archivePoPdf(doc);
  } catch (err) {
    console.error(`[po-generator] Cloudinary archive failed for ${doc.voucherNo}:`, err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Totals                                                              *
 * ------------------------------------------------------------------ */
function computeTotals(body) {
  const items = (body.items || [])
    .filter((it) => (it.description || "").trim())
    .map((it) => {
      const quantity = Number(it.quantity) || 0;
      const rate = Number(it.rate) || 0;
      return {
        description: (it.description || "").trim(),
        partNo: (it.partNo || "").trim(),
        hsnSac: (it.hsnSac || "").trim(),
        dueOn: it.dueOn || body.voucherDate || null,
        quantity,
        unit: (it.unit || "NOS").trim(),
        rate,
        per: (it.per || it.unit || "NOS").trim(),
        amount: Number((quantity * rate).toFixed(2)),
      };
    });

  const subTotal = Number(items.reduce((s, it) => s + it.amount, 0).toFixed(2));
  const taxType = body.taxType || "IGST";
  const taxRate = taxType === "NONE" ? 0 : Number(body.taxRate) || 0;
  const taxAmount = Number(((subTotal * taxRate) / 100).toFixed(2));
  const gross = subTotal + taxAmount;
  const rounded = Math.round(gross);
  const roundOff = Number((rounded - gross).toFixed(2));

  return {
    items,
    subTotal,
    taxType,
    taxRate,
    taxAmount,
    roundOff,
    totalAmount: rounded,
    totalQuantity: Number(items.reduce((s, it) => s + it.quantity, 0).toFixed(2)),
    amountInWords: amountInWordsRupees(rounded),
  };
}

/* ------------------------------------------------------------------ *
 * Handlers                                                            *
 * ------------------------------------------------------------------ */
export const listPurchaseOrdersGen = async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const docs = await PurchaseOrderGen.find(filter).sort({ createdAt: -1 }).lean();
  res.json(docs);
};

export const getPurchaseOrderGen = async (req, res) => {
  const doc = await PurchaseOrderGen.findById(req.params.id).lean();
  if (!doc) return res.status(404).json({ message: "Purchase order not found" });
  res.json(doc);
};

export const getNextVoucherNo = async (req, res) => {
  const voucherNo = await computeNextVoucherNo(req.query.date ? new Date(req.query.date) : new Date());
  res.json({ voucherNo, company: PO_COMPANY, declaration: DEFAULT_DECLARATION });
};

/** Search vendors *and* buyers for the supplier dropdown. */
export const searchParties = async (req, res) => {
  // The frontend may send either ?q= or ?search=
  const q = String(req.query.q ?? req.query.search ?? "").trim();
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  // Vendors/buyers store the company name in `companyName` and the GSTIN in
  // `taxRegistrationNo` — matching on `name`/`gstin` returned nothing.
  const filter = rx
    ? { $or: [{ companyName: rx }, { taxRegistrationNo: rx }, { contactPersonName: rx }] }
    : {};

  const [vendors, buyers] = await Promise.all([
    Vendor.find(filter).sort({ companyName: 1 }).limit(15).lean(),
    Buyer.find(filter).sort({ companyName: 1 }).limit(15).lean(),
  ]);

  const map = (list, source) =>
    list.map((p) => ({
      id: String(p._id),
      source,
      name: p.companyName || p.name || "",
      address: p.address || "",
      gstin: p.taxRegistrationNo || "",
      stateName: p.stateName || "",
      contact: p.phone || p.contactNumber || "",
      contactPersonName: p.contactPersonName || "",
      email: p.email || "",
      activeStatus: p.activeStatus || "active",
    }));

  const options = [...map(vendors, "vendor"), ...map(buyers, "buyer")].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  res.json(options);
};

export const createPurchaseOrderGen = async (req, res) => {
  const body = req.body || {};
  const voucherNo = (body.voucherNo || "").trim() || (await computeNextVoucherNo(body.voucherDate));

  const clash = await PurchaseOrderGen.exists({ voucherNo });
  if (clash) return res.status(409).json({ message: `Voucher no. ${voucherNo} already exists.` });

  if (!(body.supplierName || "").trim()) return res.status(400).json({ message: "Supplier name is required." });

  let supplierVendor = null;
  if (body.supplierSource === "vendor" && body.supplierId) {
    const vendor = await Vendor.findById(body.supplierId).lean();
    if (!vendor) return res.status(400).json({ message: "Selected vendor no longer exists." });
    supplierVendor = vendor._id;
  }

  const totals = computeTotals(body);
  if (totals.items.length === 0) return res.status(400).json({ message: "Add at least one item." });

  const doc = await PurchaseOrderGen.create({
    voucherNo,
    voucherDate: body.voucherDate || new Date(),
    paymentTerms: body.paymentTerms,
    referenceNo: body.referenceNo,
    otherReferences: body.otherReferences,
    dispatchedThrough: body.dispatchedThrough,
    destination: body.destination,
    termsOfDelivery: body.termsOfDelivery,
    supplierVendor,
    supplierName: body.supplierName,
    supplierAddress: body.supplierAddress,
    supplierGSTIN: body.supplierGSTIN,
    supplierStateName: body.supplierStateName,
    supplierStateCode: body.supplierStateCode,
    consigneeName: body.consigneeName,
    consigneeAddress: body.consigneeAddress,
    consigneeEmail: body.consigneeEmail,
    consigneeGSTIN: body.consigneeGSTIN,
    consigneeStateName: body.consigneeStateName,
    consigneeStateCode: body.consigneeStateCode,
    declaration: body.declaration || DEFAULT_DECLARATION,
    approvalStatus: "pending",
    createdByUser: req.user?._id || null,
    ...totals,
  });

  // The PO is NOT live yet — the central admin has to approve it first. Only
  // then is it archived to Cloudinary and mirrored into receiving (see
  // mirrorGeneratedPoToReceiving, called from the approvals controller) and
  // only then can it be downloaded.
  await requestDocumentApproval({
    entityType: "po",
    entityId: doc._id,
    title: `PO ${voucherNo}`,
    summary: `${doc.supplierName} — ${totals.items.length} item(s), ${totals.totalQuantity} qty`,
    amount: totals.totalAmount,
    payload: { voucherNo, supplierName: doc.supplierName },
    user: req.user,
  });

  res.status(201).json(doc.toObject());
};

/**
 * Mirrors an approved generated PO into the PurchaseOrder collection so it
 * shows up in the vendor's open-PO dropdown during material receiving, and
 * archives the PDF to Cloudinary. Called once the admin approves the PO —
 * never before.
 */
export async function mirrorGeneratedPoToReceiving(poId) {
  const doc = await PurchaseOrderGen.findById(poId);
  if (!doc || !doc.supplierVendor) return null;

  const already = await PurchaseOrder.findOne({ generatedSource: doc._id });
  if (already) return already;

  // Archival must never block approval — falls back to on-the-fly generation
  // at download time if Cloudinary is unavailable.
  const pdfUrl = await tryArchivePoPdf(doc);

  return PurchaseOrder.create({
    vendor: doc.supplierVendor,
    documentType: "Purchase Order",
    documentNumber: doc.voucherNo,
    documentUrl: pdfUrl || `/api/po-generator/${doc._id}/download`,
    originalFileName: `${String(doc.voucherNo).replace(/[\/:*?"<>|]/g, "-")}.pdf`,
    totalQuantity: doc.totalQuantity,
    lifecycleStatus: "open",
    generatedSource: doc._id,
    notes: "Created in Purchase Order Generator (admin approved)",
  });
}

/** Returns an existing PO pre-loaded for editing, with the next revision no. */
export const copyPurchaseOrderGen = async (req, res) => {
  const source = await PurchaseOrderGen.findById(req.params.id).lean();
  if (!source) return res.status(404).json({ message: "Purchase order not found" });
  const voucherNo = await computeNextRevision(source.voucherNo);
  res.json({
    ...source,
    _id: undefined,
    pdfUrl: undefined,
    voucherNo,
    sourceVoucherNo: source.voucherNo,
    status: "open",
    approvalStatus: "pending",
  });
};

export const setPurchaseOrderGenStatus = async (req, res) => {
  const status = req.body?.status === "closed" ? "closed" : "open";
  const doc = await PurchaseOrderGen.findByIdAndUpdate(
    req.params.id,
    { status, closedAt: status === "closed" ? new Date() : null },
    { new: true },
  ).lean();
  if (!doc) return res.status(404).json({ message: "Purchase order not found" });
  res.json(doc);
};

// GET /api/po-generator/:id/download
// Only an admin-approved PO may leave the building. Serves the archived
// Cloudinary PDF when present (the same file, surviving restarts);
// otherwise generates on the fly and lazily archives it for next time.
export const downloadPurchaseOrderGen = async (req, res) => {
  const doc = await PurchaseOrderGen.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: "Purchase order not found" });

  if (doc.approvalStatus !== "approved") {
    return res.status(403).json({
      message:
        doc.approvalStatus === "rejected"
          ? "This purchase order was rejected by the admin and cannot be downloaded."
          : "This purchase order is waiting for admin approval — it can be downloaded once approved.",
      approvalStatus: doc.approvalStatus,
    });
  }

  if (doc.pdfUrl) {
    return res.redirect(doc.pdfUrl);
  }

  const buffer = await generatePoPdf(doc.toObject());
  const safeName = String(doc.voucherNo).replace(/[\\/:*?"<>|]/g, "-");

  // Lazy archive for approved POs that don't have a pdfUrl yet (e.g. the
  // archive attempt during approval failed).
  tryArchivePoPdf(doc);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
  res.setHeader("Content-Length", buffer.length);
  res.send(buffer);
};