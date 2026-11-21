// backend/src/controllers/challanController.js
import DeliveryChallan from "../models/DeliveryChallan.js";
import Vendor from "../models/Vendor.js";
import Buyer from "../models/Buyer.js";
import { generateChallanPdf, COMPANY_STATE_CODE } from "../utils/generateChallanPdf.js";
import { numberToWordsIndian } from "../utils/numberToWordsIndian.js";
import { stateFromGstin } from "../utils/gstStates.js";

const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ---------------------------------------------------------------------------
   Challan numbering — TISPL/<seq>/<FY>, e.g. TISPL/12/26-27.
   The sequence restarts for every financial year (April–March). For a brand
   new financial year / fresh database the first number is CHALLAN_START_SEQ
   (env, default 1); afterwards it is simply the highest number on record + 1.
--------------------------------------------------------------------------- */
function fyString(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

async function suggestChallanNo(date = new Date()) {
  const fy = fyString(date);
  const docs = await DeliveryChallan.find(
    { challanNo: new RegExp(`^TISPL/\\d+/${escapeRegex(fy)}$`) },
    "challanNo"
  ).lean();
  let maxSeq = (Number(process.env.CHALLAN_START_SEQ) || 1) - 1;
  for (const d of docs) {
    const m = String(d.challanNo).match(/^TISPL\/(\d+)\//);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  return `TISPL/${String(maxSeq + 1).padStart(2, "0")}/${fy}`;
}

// "INR Eighteen Thousand Four Hundred Eight Only" (paise handled too)
function inrWords(value) {
  const totalPaise = Math.round((Number(value) || 0) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  let words = `INR ${numberToWordsIndian(rupees)}`;
  if (paise) words += ` and ${numberToWordsIndian(paise)} Paise`;
  return `${words} Only`;
}

const cleanParty = (p = {}) => {
  const gstin = String(p.gstin || "").trim().toUpperCase();
  const derived = stateFromGstin(gstin);
  return {
    name: String(p.name || "").trim(),
    address: String(p.address || "").trim(),
    gstin,
    stateName: String(p.stateName || "").trim() || derived.stateName,
    stateCode: String(p.stateCode || "").trim() || derived.stateCode,
  };
};

const validDate = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// GET /api/challan-generator/parties?q=
export async function searchParties(req, res) {
  try {
    const q = String(req.query.q ?? req.query.search ?? "").trim();
    const filter = q
      ? { $or: [{ companyName: new RegExp(escapeRegex(q), "i") }, { taxRegistrationNo: new RegExp(escapeRegex(q), "i") }] }
      : {};
    const pick = (doc, type) => {
      const gstin = doc.taxRegistrationNo || "";
      return {
        _id: doc._id,
        type,
        name: doc.companyName || "",
        gstin,
        address: doc.address || "",
        ...stateFromGstin(gstin),
      };
    };
    const [buyers, vendors] = await Promise.all([
      Buyer.find(filter).sort({ companyName: 1 }).limit(10).lean(),
      Vendor.find(filter).sort({ companyName: 1 }).limit(10).lean(),
    ]);
    res.json([...buyers.map((d) => pick(d, "buyer")), ...vendors.map((d) => pick(d, "vendor"))]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/challan-generator/next-no?date=
export async function nextNumber(req, res) {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    res.json({ challanNo: await suggestChallanNo(Number.isNaN(date.getTime()) ? new Date() : date) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// POST /api/challan-generator
export async function generateChallan(req, res) {
  try {
    const body = req.body || {};
    const challanNo = String(body.challanNo || "").trim();
    if (!challanNo) return res.status(400).json({ message: "Challan number is required" });

    const dispatchTo = cleanParty(body.dispatchTo);
    if (!dispatchTo.name) return res.status(400).json({ message: "Dispatch-to party name is required" });
    // "Party" defaults to the dispatch-to party when left blank.
    const party = body.party?.name?.trim() ? cleanParty(body.party) : { ...dispatchTo };

    if (await DeliveryChallan.exists({ challanNo })) {
      return res.status(409).json({ message: `Challan ${challanNo} already exists. Use a different number.` });
    }

    const items = (Array.isArray(body.items) ? body.items : [])
      .filter((it) => String(it.description || "").trim())
      .map((it) => {
        const quantity = Number(it.quantity) || 0;
        const rate = Number(it.rate) || 0;
        return {
          description: String(it.description).trim(),
          hsnSac: String(it.hsnSac || "").trim(),
          quantity,
          unit: String(it.unit || "NOS").trim().toUpperCase() || "NOS",
          rate,
          amount: Number((quantity * rate).toFixed(2)),
        };
      });
    if (!items.length) return res.status(400).json({ message: "At least one item is required" });

    // Intra-state (same state code as TISPL) -> CGST+SGST, otherwise IGST.
    // An explicit choice from the form wins; "NONE" means a no-tax challan.
    const gstin = party.gstin || dispatchTo.gstin;
    const derivedType = gstin && !gstin.startsWith(COMPANY_STATE_CODE) ? "IGST" : gstin ? "CGST_SGST" : "IGST";
    const taxType = ["IGST", "CGST_SGST", "NONE"].includes(body.taxType) ? body.taxType : derivedType;
    const taxRate = taxType === "NONE" ? 0 : Number(body.taxRate) || 0;

    const subTotal = Number(items.reduce((s, it) => s + it.amount, 0).toFixed(2));
    const taxAmount = Number(((subTotal * taxRate) / 100).toFixed(2));
    const totalAmount = Number((subTotal + taxAmount).toFixed(2));

    const challan = await DeliveryChallan.create({
      challanNo,
      challanType: body.challanType === "NON-RETURNABLE" ? "NON-RETURNABLE" : "RETURNABLE",
      challanDate: validDate(body.challanDate) || new Date(),
      dateTimeOfIssue: validDate(body.dateTimeOfIssue) || new Date(),
      dispatchTo,
      party,
      referenceNoDate: body.referenceNoDate,
      buyersOrderNo: body.buyersOrderNo,
      buyersOrderDate: validDate(body.buyersOrderDate),
      dispatchDocNo: body.dispatchDocNo,
      dispatchedThrough: body.dispatchedThrough,
      destination: body.destination,
      motorVehicleNo: body.motorVehicleNo,
      modeTermsOfPayment: body.modeTermsOfPayment,
      otherReferences: body.otherReferences,
      durationOfProcess: body.durationOfProcess,
      natureOfProcessing: body.natureOfProcessing,
      items,
      taxType,
      taxRate,
      subTotal,
      taxAmount,
      totalAmount,
      amountInWords: inrWords(totalAmount),
      taxAmountInWords: taxAmount > 0 ? inrWords(taxAmount) : "",
      createdByUser: req.user?._id,
    });

    res.status(201).json(challan);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Challan number already exists" });
    res.status(500).json({ message: err.message });
  }
}

// GET /api/challan-generator?q=&status=
export async function listChallans(req, res) {
  try {
    const q = String(req.query.q ?? req.query.search ?? "").trim();
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ challanNo: rx }, { "dispatchTo.name": rx }, { "party.name": rx }];
    }
    res.json(await DeliveryChallan.find(filter).sort({ createdAt: -1 }).limit(200).lean());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/challan-generator/:id
export async function getChallan(req, res) {
  try {
    const challan = await DeliveryChallan.findById(req.params.id).lean();
    if (!challan) return res.status(404).json({ message: "Challan not found" });
    res.json(challan);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/challan-generator/:id/copy — the data of an earlier challan with a fresh number
export async function copyChallan(req, res) {
  try {
    const src = await DeliveryChallan.findById(req.params.id).lean();
    if (!src) return res.status(404).json({ message: "Challan not found" });
    const copy = { ...src };
    delete copy._id;
    delete copy.createdAt;
    delete copy.updatedAt;
    delete copy.__v;
    delete copy.status;
    delete copy.closedAt;
    copy.challanNo = await suggestChallanNo(new Date());
    copy.challanDate = new Date();
    copy.dateTimeOfIssue = new Date();
    res.json({ ...copy, copiedFrom: { challanNo: src.challanNo } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// PATCH /api/challan-generator/:id/status  { status: "open" | "closed" }
export async function setChallanStatus(req, res) {
  try {
    const status = req.body?.status === "closed" ? "closed" : "open";
    const challan = await DeliveryChallan.findByIdAndUpdate(
      req.params.id,
      { status, closedAt: status === "closed" ? new Date() : null },
      { new: true }
    ).lean();
    if (!challan) return res.status(404).json({ message: "Challan not found" });
    res.json(challan);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// GET /api/challan-generator/:id/download
export async function downloadChallan(req, res) {
  try {
    const challan = await DeliveryChallan.findById(req.params.id).lean();
    if (!challan) return res.status(404).json({ message: "Challan not found" });
    const buffer = await generateChallanPdf(challan);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${challan.challanNo.replace(/\//g, "-")}.pdf"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}