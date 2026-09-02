// backend/src/controllers/piGeneratorController.js
import ProformaInvoiceGen from "../models/ProformaInvoiceGen.js";
import Vendor from "../models/Vendor.js";
import Buyer from "../models/Buyer.js";
import { generatePiPdf } from "../utils/generatePiPdf.js";
import { amountInWordsRupees } from "../utils/numberToWordsIndian.js";
import { createDocumentApproval } from "../utils/documentApproval.js";
import { uploadFileToCloudinary } from "../config/cloudinary.js";

const COMPANY_GST_PREFIX = "06"; // Haryana — CGST+SGST when buyer GST starts with this

function escapeRegex(s = "") {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------------------------------------------------------------------------
   Invoice numbering — TISPL/PI/<seq>/<FY>, e.g. TISPL/PI/07/26-27.
   TISPL/PI/07/26-27 and TISPL/PI/07A/26-27 both belong to sequence 7; the
   trailing letters are a revision of that same PI, not a new number, so they
   never consume a slot in the main series.
--------------------------------------------------------------------------- */
function fyString(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-based; April = 3
  const start = m >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// "" → "A", "A" → "B", "Z" → "AA" — a plain spreadsheet-style column bump.
function nextRevisionLetter(revision) {
  if (!revision) return "A";
  const chars = revision.toUpperCase().split("");
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
  return "A" + chars.join("");
}

/* ---------------------------------------------------------------------------
   Cloudinary archival — the generated PDF is uploaded to the buyer's folder
   (buyers/<buyer-slug>-<gstin>/generated-pi/) once the PI is created, and the
   permanent URL is stored on the record as `pdfUrl`. Downloads then redirect
   to that archived file, so the exact PDF survives deploys/restarts.
--------------------------------------------------------------------------- */
async function archivePiPdf(pi) {
  const buffer = await generatePiPdf(pi);
  const safeInvoiceNo = (pi.invoiceNo || "PI").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");

  const pdfUrl = await uploadFileToCloudinary(
    { buffer, mimetype: "application/pdf", originalname: `${safeInvoiceNo}.pdf` },
    {
      // The PI buyer is not a reference — build the folder straight from the
      // name + GSTIN captured on the invoice, exactly like partyFolder does.
      party: { companyName: pi.buyerName, taxRegistrationNo: pi.buyerGSTIN },
      kind: "buyer",
      category: "generated-pi",
    },
  );

  pi.pdfUrl = pdfUrl;
  await pi.save();
  return pdfUrl;
}

// Archival must never block PI creation/approval — if Cloudinary is
// down/misconfigured the PI is still saved and the download falls back to
// on-the-fly generation.
async function tryArchivePiPdf(pi) {
  try {
    return await archivePiPdf(pi);
  } catch (err) {
    console.error(`[pi-generator] Cloudinary archive failed for ${pi.invoiceNo}:`, err.message);
    return null;
  }
}

// GET /api/pi-generator/parties?q=...
export async function searchParties(req, res) {
  try {
    const q = String(req.query.q ?? req.query.search ?? "").trim();
    const rx = q ? new RegExp(escapeRegex(q), "i") : null;
    const pick = (doc, type) => ({
      _id: doc._id,
      type,
      name: doc.companyName || doc.name || "",
      gstin: doc.taxRegistrationNo || doc.gstin || "",
      address: doc.address || "",
      contactPerson: doc.contactPerson || "",
      phone: doc.phone || "",
      email: doc.email || "",
    });
    const filter = rx ? { $or: [{ companyName: rx }, { taxRegistrationNo: rx }] } : {};
    const [vendors, buyers] = await Promise.all([
      Vendor.find(filter).sort({ companyName: 1 }).limit(10).lean(),
      Buyer.find(filter).sort({ companyName: 1 }).limit(10).lean(),
    ]);
    res.json([
      ...buyers.map((d) => pick(d, "buyer")),
      ...vendors.map((d) => pick(d, "vendor")),
    ]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/pi-generator/next-number
export async function nextNumber(req, res) {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const fy = fyString(Number.isNaN(date.getTime()) ? new Date() : date);
    const docs = await ProformaInvoiceGen.find(
      { invoiceNo: new RegExp(`^TISPL/PI/\\d+[A-Z]*/${escapeRegex(fy)}$`) },
      "invoiceNo",
    ).lean();
    let maxSeq = 6;
    for (const doc of docs) {
      const match = String(doc.invoiceNo).match(/^TISPL\/PI\/(\d+)/);
      if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
    }
    res.json({ invoiceNo: `TISPL/PI/${String(maxSeq + 1).padStart(2, "0")}/${fy}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/pi-generator/generate
export async function generatePi(req, res) {
  try {
    const body = req.body || {};
    if (!body.invoiceNo) return res.status(400).json({ message: "Invoice number is required" });
    if (!body.buyerName) return res.status(400).json({ message: "Buyer name is required" });
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ message: "At least one item is required" });
    }

    // duplicate guard — same base invoice number gets a revision letter
    const exists = await ProformaInvoiceGen.findOne({ invoiceNo: body.invoiceNo }).lean();
    if (exists) {
      return res.status(409).json({
        message: `Invoice ${body.invoiceNo} already exists. Use a new number or copy it as a revision.`,
      });
    }

    const items = body.items
      .filter((item) => String(item.description || "").trim())
      .map((item) => {
        const quantity = Number(item.quantity) || 0;
        const rate = Number(item.rate) || 0;
        return {
          description: String(item.description).trim(),
          hsnSac: String(item.hsnSac || "").trim(),
          quantity,
          rate,
          amount: Number((quantity * rate).toFixed(2)),
        };
      });
    if (!items.length) return res.status(400).json({ message: "At least one valid item is required" });

    const gstin = String(body.buyerGSTIN || body.buyerGstin || "").trim();
    const sameState = gstin.startsWith(COMPANY_GST_PREFIX);
    const taxType = body.taxType === "NONE" ? "NONE" : sameState ? "CGST_SGST" : "IGST";
    const taxRate = taxType === "NONE" ? 0 : Number(body.taxRate) || 0;
    const subTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    const taxAmount = Number(((subTotal * taxRate) / 100).toFixed(2));
    const totalAmount = Number((subTotal + taxAmount).toFixed(2));

    const userRole = req.user?.role;
    const isAdmin = userRole === "admin";

    const pi = await ProformaInvoiceGen.create({
      ...body,
      buyerGSTIN: gstin,
      items,
      taxType,
      taxRate,
      subTotal,
      taxAmount,
      totalAmount,
      amountInWords: amountInWordsRupees(totalAmount),
      approvalStatus: isAdmin ? "approved" : "pending",
      createdByUser: req.user?._id,
    });

    if (!isAdmin) {
      await createDocumentApproval({
        docType: "PI",
        docId: pi._id,
        refNo: pi.invoiceNo,
        requestedBy: req.user,
      });
    } else {
      // Admin-created PIs are approved immediately, so archive right away.
      // Non-admin PIs archive once the admin approves (mirror the PO flow).
      await tryArchivePiPdf(pi);
    }

    res.status(201).json(pi);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "Invoice number already exists" });
    }
    res.status(500).json({ message: err.message });
  }
}

// GET /api/pi-generator/list
export async function listPis(req, res) {
  try {
    const q = String(req.query.q ?? req.query.search ?? "").trim();
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ invoiceNo: rx }, { buyerName: rx }];
    }
    const list = await ProformaInvoiceGen.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// PATCH /api/pi-generator/:id/status
export async function setPiStatus(req, res) {
  try {
    const status = req.body?.status === "closed" ? "closed" : "open";
    const pi = await ProformaInvoiceGen.findByIdAndUpdate(
      req.params.id,
      { status, closedAt: status === "closed" ? new Date() : null },
      { new: true },
    ).lean();
    if (!pi) return res.status(404).json({ message: "PI not found" });
    res.json(pi);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/pi-generator/:id
export async function getPi(req, res) {
  try {
    const pi = await ProformaInvoiceGen.findById(req.params.id).lean();
    if (!pi) return res.status(404).json({ message: "PI not found" });
    res.json(pi);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/pi-generator/:id/copy
// Returns the PI data with a new revision number (07 -> 07A, 07A -> 07B, ...)
export async function copyPi(req, res) {
  try {
    const src = await ProformaInvoiceGen.findById(req.params.id).lean();
    if (!src) return res.status(404).json({ message: "PI not found" });

    const m = src.invoiceNo.match(/^(TISPL\/PI\/)(\d+)([A-Z]*)(\/\d{2}-\d{2})$/);
    let newNo;
    if (m) {
      const [, prefix, seq, rev, fy] = m;
      const nextRev = nextRevisionLetter(rev);
      newNo = `${prefix}${seq}${nextRev}${fy}`;
    } else {
      newNo = `${src.invoiceNo}-R1`;
    }

    const copy = { ...src };
    delete copy._id;
    delete copy.createdAt;
    delete copy.updatedAt;
    copy.invoiceNo = newNo;
    copy.approvalStatus = undefined;
    copy.pdfUrl = undefined;

    res.json({ ...copy, suggestedInvoiceNo: newNo });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/pi-generator/:id/download
// Only an approved PI may leave the building. Serves the archived Cloudinary
// PDF when present (the same file, surviving restarts); otherwise generates
// on the fly and lazily archives it for next time.
export async function downloadPi(req, res) {
  try {
    const pi = await ProformaInvoiceGen.findById(req.params.id);
    if (!pi) return res.status(404).json({ message: "PI not found" });

    if (pi.approvalStatus && pi.approvalStatus !== "approved" && req.user?.role !== "admin") {
      return res.status(403).json({
        message: `This PI is ${pi.approvalStatus}. PDF download unlocks after admin approval.`,
      });
    }

    if (pi.pdfUrl) {
      return res.redirect(pi.pdfUrl);
    }

    const buffer = await generatePiPdf(pi.toObject ? pi.toObject() : pi);

    // Lazy archive for approved PIs that don't have a pdfUrl yet.
    tryArchivePiPdf(pi);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${pi.invoiceNo.replace(/\//g, "-")}.pdf"`
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}