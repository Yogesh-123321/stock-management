import asyncHandler from "express-async-handler";
import { uploadFileToCloudinary } from "../config/cloudinary.js";
import Buyer from "../models/Buyer.js";
import { generateVendorFormDocx } from "../utils/generateVendorFormDocx.js";

// Maps the multipart field name -> the buyer field that stores its URL.
// Every one of these is optional.
const DOC_FIELDS = {
  registrationDocument: "registrationDocumentUrl",
  gstDocument: "gstDocumentUrl",
  panDocument: "panDocumentUrl",
  bankRecordDocument: "bankRecordDocumentUrl",
  msmeDocument: "msmeDocumentUrl",
};

// Sub-folder used inside the buyer's own Cloudinary folder, per document type.
const DOC_CATEGORIES = {
  registrationDocument: "registration",
  gstDocument: "gst",
  panDocument: "pan",
  bankRecordDocument: "bank",
  msmeDocument: "msme",
};

// `party` identifies the buyer folder (companyName + GSTIN). On create it is
// built from the submitted form body, on edit from the saved buyer document.
const collectDocUrls = async (req, party) => {
  const urls = {};
  const files = req.files || {};

  for (const [field, target] of Object.entries(DOC_FIELDS)) {
    const uploaded = Array.isArray(files[field]) ? files[field][0] : undefined;
    if (uploaded) {
      urls[target] = await uploadFileToCloudinary(uploaded, {
        party,
        kind: "buyer",
        category: DOC_CATEGORIES[field] || "documents",
      });
    }
  }

  if (req.file) {
    urls.registrationDocumentUrl = await uploadFileToCloudinary(req.file, {
      party,
      kind: "buyer",
      category: "registration",
    });
  }
  return urls;
};

const toBool = (value) => value === true || value === "true" || value === "on" || value === "1";

// GET /api/buyers?search=&status=
export const getBuyers = asyncHandler(async (req, res) => {
  const { search, status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (search) filter.companyName = { $regex: search, $options: "i" };

  const buyers = await Buyer.find(filter).sort({ createdAt: -1 });
  res.json(buyers);
});

// GET /api/buyers/check?name=
export const checkBuyerRegistered = asyncHandler(async (req, res) => {
  const { name } = req.query;
  if (!name) {
    res.status(400);
    throw new Error("Buyer name query param is required");
  }
  const buyer = await Buyer.findOne({
    companyName: { $regex: `^${name.trim()}$`, $options: "i" },
    status: "approved",
  });
  res.json({ registered: !!buyer, buyer: buyer || null });
});

// GET /api/buyers/:id
export const getBuyerById = asyncHandler(async (req, res) => {
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) {
    res.status(404);
    throw new Error("Buyer not found");
  }
  res.json(buyer);
});

// GET /api/buyers/:id/form  (same printable form layout as the vendor one)
export const downloadBuyerForm = asyncHandler(async (req, res) => {
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) {
    res.status(404);
    throw new Error("Buyer not found");
  }

  // The generator expects `vendorRegistrationNo`; everything else is identical.
  const buffer = await generateVendorFormDocx({
    ...buyer.toObject(),
    vendorRegistrationNo: buyer.buyerRegistrationNo,
  });
  const safeName = (buyer.companyName || "Buyer").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  const filename = `${safeName}_Buyer_Registration_Form.docx`;

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

// POST /api/buyers  (register new buyer - starts as pending)
export const registerBuyer = asyncHandler(async (req, res) => {
  const {
    companyName,
    address,
    phone,
    email,
    contactPersonName,
    contactDesignation,
    natureOfCompany,
    natureOfBusiness,
    taxRegistrationNo,
    bankDetails,
    principleCustomers,
    signatoryName,
    signatoryDesignation,
    msmeNumber,
    remarks,
  } = req.body;

  if (!companyName) {
    res.status(400);
    throw new Error("Company name is required");
  }

  const buyerRegistrationNo = `TISPL/PLC/Buyer/${companyName
    .replace(/\s+/g, "")
    .toUpperCase()}/${Date.now()}`;

  const buyer = await Buyer.create({
    buyerRegistrationNo,
    companyName,
    address,
    phone,
    email,
    contactPersonName,
    contactDesignation,
    natureOfCompany,
    natureOfBusiness,
    taxRegistrationNo,
    bankDetails,
    principleCustomers,
    signatoryName,
    signatoryDesignation,
    isMsme: toBool(req.body.isMsme),
    msmeNumber,
    remarks,
    ...(await collectDocUrls(req, {
      companyName: req.body.companyName,
      taxRegistrationNo: req.body.taxRegistrationNo,
    })),
    status: "pending",
  });

  res.status(201).json(buyer);
});

// PUT /api/buyers/:id  (edit an existing buyer)
export const updateBuyer = asyncHandler(async (req, res) => {
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) {
    res.status(404);
    throw new Error("Buyer not found");
  }

  const editableFields = [
    "companyName",
    "address",
    "phone",
    "email",
    "contactPersonName",
    "contactDesignation",
    "natureOfCompany",
    "natureOfBusiness",
    "taxRegistrationNo",
    "bankDetails",
    "principleCustomers",
    "signatoryName",
    "signatoryDesignation",
    "msmeNumber",
    "remarks",
  ];

  if (req.body.companyName !== undefined && !String(req.body.companyName).trim()) {
    res.status(400);
    throw new Error("Company name is required");
  }

  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) buyer[field] = req.body[field];
  });

  if (req.body.isMsme !== undefined) buyer.isMsme = toBool(req.body.isMsme);

  // Only the documents actually re-uploaded get replaced.
  Object.entries(await collectDocUrls(req, buyer)).forEach(([field, url]) => {
    buyer[field] = url;
  });

  await buyer.save();
  res.json(buyer);
});

// PATCH /api/buyers/:id/approve
export const approveBuyer = asyncHandler(async (req, res) => {
  const { approvedBy, approvalComment } = req.body;
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) {
    res.status(404);
    throw new Error("Buyer not found");
  }
  buyer.status = "approved";
  buyer.approvedBy = approvedBy;
  buyer.approvalComment = approvalComment;
  await buyer.save();
  res.json(buyer);
});

// PATCH /api/buyers/:id/reject
export const rejectBuyer = asyncHandler(async (req, res) => {
  const { approvedBy, approvalComment } = req.body;
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) {
    res.status(404);
    throw new Error("Buyer not found");
  }
  buyer.status = "rejected";
  buyer.approvedBy = approvedBy;
  buyer.approvalComment = approvalComment;
  await buyer.save();
  res.json(buyer);
});

// DELETE /api/buyers/:id
export const deleteBuyer = asyncHandler(async (req, res) => {
  const buyer = await Buyer.findById(req.params.id);
  if (!buyer) {
    res.status(404);
    throw new Error("Buyer not found");
  }

  await buyer.deleteOne();
  res.json({ deleted: true, id: buyer._id });
});
