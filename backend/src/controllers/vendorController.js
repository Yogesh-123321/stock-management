import asyncHandler from "express-async-handler";
import { uploadFileToCloudinary } from "../config/cloudinary.js";
import Vendor from "../models/Vendor.js";
import { generateVendorFormDocx } from "../utils/generateVendorFormDocx.js";

// Maps the multipart field name -> the vendor field that stores its URL.
// Every one of these is optional.
const DOC_FIELDS = {
  registrationDocument: "registrationDocumentUrl",
  gstDocument: "gstDocumentUrl",
  panDocument: "panDocumentUrl",
  bankRecordDocument: "bankRecordDocumentUrl",
  msmeDocument: "msmeDocumentUrl",
};

// Works with both upload.single() (req.file) and upload.fields() (req.files)
// Sub-folder used inside the vendor's own Cloudinary folder, per document type.
const DOC_CATEGORIES = {
  registrationDocument: "registration",
  gstDocument: "gst",
  panDocument: "pan",
  bankRecordDocument: "bank",
  msmeDocument: "msme",
};

// `party` identifies the vendor folder (companyName + GSTIN). On create it is
// built from the submitted form body, on edit from the saved vendor document.
const collectDocUrls = async (req, party) => {
  const urls = {};
  const files = req.files || {};

  for (const [field, target] of Object.entries(DOC_FIELDS)) {
    const uploaded = Array.isArray(files[field]) ? files[field][0] : undefined;
    if (uploaded) {
      urls[target] = await uploadFileToCloudinary(uploaded, {
        party,
        kind: "vendor",
        category: DOC_CATEGORIES[field] || "documents",
      });
    }
  }

  if (req.file) {
    urls.registrationDocumentUrl = await uploadFileToCloudinary(req.file, {
      party,
      kind: "vendor",
      category: "registration",
    });
  }
  return urls;
};

const toBool = (value) => value === true || value === "true" || value === "on" || value === "1";

// GET /api/vendors?search=&status=
export const getVendors = asyncHandler(async (req, res) => {
  const { search, status, activeStatus } = req.query;
  const filter = {};
  if (status) filter.status = status;
  // Legacy vendors saved before this field existed are treated as active.
  if (activeStatus === "active") filter.activeStatus = { $ne: "inactive" };
  else if (activeStatus === "inactive") filter.activeStatus = "inactive";
  if (search) filter.companyName = { $regex: search, $options: "i" };

  const vendors = await Vendor.find(filter).sort({ createdAt: -1 });
  res.json(vendors);
});

// GET /api/vendors/check?name=
export const checkVendorRegistered = asyncHandler(async (req, res) => {
  const { name } = req.query;
  if (!name) {
    res.status(400);
    throw new Error("Vendor name query param is required");
  }
  const vendor = await Vendor.findOne({
    companyName: { $regex: `^${name.trim()}$`, $options: "i" },
    status: "approved",
  });
  res.json({ registered: !!vendor, vendor: vendor || null });
});

// GET /api/vendors/:id
export const getVendorById = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) {
    res.status(404);
    throw new Error("Vendor not found");
  }
  res.json(vendor);
});

// GET /api/vendors/:id/form  (download the Supplier Evaluation Form as .docx, pre-filled)
export const downloadVendorForm = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) {
    res.status(404);
    throw new Error("Vendor not found");
  }

  const buffer = await generateVendorFormDocx(vendor);
  const safeName = (vendor.companyName || "Vendor").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  const filename = `${safeName}_Supplier_Evaluation_Form.docx`;

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

// POST /api/vendors  (register new vendor - starts as pending)
export const registerVendor = asyncHandler(async (req, res) => {
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

  const vendorRegistrationNo = `TISPL/PLC/Vendor/${companyName
    .replace(/\s+/g, "")
    .toUpperCase()}/${Date.now()}`;

  const vendor = await Vendor.create({
    vendorRegistrationNo,
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

  res.status(201).json(vendor);
});

// PUT /api/vendors/:id  (edit an existing vendor)
export const updateVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) {
    res.status(404);
    throw new Error("Vendor not found");
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

  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) vendor[field] = req.body[field];
  });

  if (req.body.isMsme !== undefined) vendor.isMsme = toBool(req.body.isMsme);

  if (req.body.companyName !== undefined && !String(req.body.companyName).trim()) {
    res.status(400);
    throw new Error("Company name is required");
  }

  // Only the documents actually re-uploaded get replaced; the rest stay as they were.
  Object.entries(await collectDocUrls(req, vendor)).forEach(([field, url]) => {
    vendor[field] = url;
  });

  await vendor.save();
  res.json(vendor);
});

// PATCH /api/vendors/:id/approve
export const approveVendor = asyncHandler(async (req, res) => {
  const { approvedBy, approvalComment } = req.body;
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) {
    res.status(404);
    throw new Error("Vendor not found");
  }
  vendor.status = "approved";
  vendor.approvedBy = approvedBy;
  vendor.approvalComment = approvalComment;
  await vendor.save();
  res.json(vendor);
});

// PATCH /api/vendors/:id/reject
export const rejectVendor = asyncHandler(async (req, res) => {
  const { approvedBy, approvalComment } = req.body;
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) {
    res.status(404);
    throw new Error("Vendor not found");
  }
  vendor.status = "rejected";
  vendor.approvedBy = approvedBy;
  vendor.approvalComment = approvalComment;
  await vendor.save();
  res.json(vendor);
});

// PATCH /api/vendors/:id/active-status   body: { activeStatus: "active" | "inactive", reason }
// Vendors are never deleted — deactivating keeps every PO / stock history intact.
export const setVendorActiveStatus = asyncHandler(async (req, res) => {
  const { activeStatus, reason } = req.body;
  if (!["active", "inactive"].includes(activeStatus)) {
    res.status(400);
    throw new Error('activeStatus must be either "active" or "inactive"');
  }

  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) {
    res.status(404);
    throw new Error("Vendor not found");
  }

  vendor.activeStatus = activeStatus;
  vendor.inactiveReason = activeStatus === "inactive" ? reason || "" : "";
  vendor.inactiveAt = activeStatus === "inactive" ? new Date() : undefined;
  await vendor.save();

  res.json(vendor);
});

// GET /api/vendors/:id/items — items previously purchased from this vendor.
// Kept here because vendorRoutes.js imports this named export for the hover card.
export const getVendorItems = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id).select("_id").lean();
  if (!vendor) {
    res.status(404);
    throw new Error("Vendor not found");
  }

  const [{ default: PurchaseOrder }, { default: StockEntry }] = await Promise.all([
    import("../models/PurchaseOrder.js"),
    import("../models/StockEntry.js"),
  ]);

  const [purchaseOrders, stockEntries] = await Promise.all([
    PurchaseOrder.find({ vendor: req.params.id })
      .select("items createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    StockEntry.find({ vendor: req.params.id })
      .populate("part")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const itemMap = new Map();
  const addItem = (source, purchasedAt) => {
    const part = source?.part || {};
    const partNumber =
      source?.partNumber ||
      source?.ttUniquePartNumber ||
      source?.manufacturerPartNumber ||
      part?.ttUniquePartNumber ||
      part?.manufacturerPartNumber ||
      part?.partNumber ||
      "";
    const description =
      source?.description ||
      source?.itemDescription ||
      part?.itemDescription ||
      part?.description ||
      "";

    if (!partNumber && !description) return;
    const key = `${partNumber}|${description}`.toLowerCase();
    const existing = itemMap.get(key);
    if (existing) {
      existing.timesPurchased += 1;
      if (purchasedAt && (!existing.lastPurchasedAt || purchasedAt > existing.lastPurchasedAt)) {
        existing.lastPurchasedAt = purchasedAt;
      }
      return;
    }

    itemMap.set(key, {
      partNumber: partNumber || null,
      description: description || null,
      lastPurchasedAt: purchasedAt || null,
      timesPurchased: 1,
    });
  };

  for (const purchaseOrder of purchaseOrders) {
    for (const item of purchaseOrder.items || []) addItem(item, purchaseOrder.createdAt);
  }
  for (const stockEntry of stockEntries) addItem(stockEntry, stockEntry.createdAt);

  const items = [...itemMap.values()]
    .sort((a, b) => new Date(b.lastPurchasedAt || 0) - new Date(a.lastPurchasedAt || 0))
    .slice(0, 25);

  res.json({ items });
});
