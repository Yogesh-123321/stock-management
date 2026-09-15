import PartApprovalRequest from "../models/PartApprovalRequest.js";
import { notifyApprovers, notifyRequester } from "../utils/notify.js";
import { createPartFromApprovedRequest } from "../utils/stockBooking.js";
import { uploadFileToCloudinary } from "../config/cloudinary.js";

const partLabel = (doc) =>
  [doc.newPart?.itemDescription, doc.newPart?.manufacturerPartNumber]
    .filter(Boolean)
    .join(" · ") || "part number";

/**
 * POST /api/part-approvals
 * Raise a request to register a new part number, or an alternate of an
 * existing part. Raised from the stock-entry step; no stock is booked here.
 * Every admin (and anyone holding `part.approve`) gets a notification.
 *
 * Accepts either a plain JSON body with a nested `newPart` object (the
 * original shape, still used by the Receive-material screen) or a
 * multipart/form-data body with `newPart`'s fields flattened to the top
 * level plus optional `photo` (JPEG) / `datasheet` (PDF) files — used by
 * the Parts master's "new part request" dialog, which is the only place
 * these files can be attached at request time.
 */
export const createRequest = async (req, res) => {
  try {
    const {
      requestType,
      alternateOfPartId = null,
      vendorId = null,
      purchaseOrderId = null,
      searchTerm = "",
      proposedQuantity = null,
      requestedBy = "",
      requestRemarks = "",
    } = req.body;

    const newPart = req.body.newPart || {
      typeOfPart: req.body.typeOfPart || "",
      manufacturerPartNumber: req.body.manufacturerPartNumber || "",
      itemDescription: req.body.itemDescription || "",
      companyCode: req.body.companyCode || "",
      category: req.body.category || "",
      partTypeBatchNo: req.body.partTypeBatchNo || "",
    };

    if (!["new_part_number", "alternate_part"].includes(requestType)) {
      return res.status(400).json({ message: "Invalid request type" });
    }
    const required = ["itemDescription", "companyCode", "category", "partTypeBatchNo"];
    const missing = required.filter((f) => !String(newPart[f] || "").trim());
    if (missing.length) {
      return res.status(400).json({ message: `Missing field(s): ${missing.join(", ")}` });
    }
    if (requestType === "alternate_part" && !alternateOfPartId) {
      return res.status(400).json({ message: "Select the part this is an alternate of" });
    }

    const duplicate = await PartApprovalRequest.findOne({
      status: { $in: ["pending", "approved"] },
      "newPart.itemDescription": String(newPart.itemDescription).trim(),
      "newPart.companyCode": String(newPart.companyCode).trim(),
      "newPart.category": String(newPart.category).trim(),
      "newPart.partTypeBatchNo": String(newPart.partTypeBatchNo).trim(),
    });
    if (duplicate) {
      return res.status(409).json({
        message:
          duplicate.status === "pending"
            ? "This part is already waiting for approval."
            : "This part has already been approved — pick it from the approved list.",
        request: duplicate,
      });
    }

    // Both files are optional. Uploaded once here — the URLs are copied
    // straight onto the Part record when this request is later approved
    // (see createPartFromApprovedRequest in utils/stockBooking.js).
    const photoFile = req.files?.photo?.[0];
    const datasheetFile = req.files?.datasheet?.[0];
    const [photoUrl, datasheetUrl] = await Promise.all([
      photoFile ? uploadFileToCloudinary(photoFile, { category: "parts/photos" }) : Promise.resolve(""),
      datasheetFile
        ? uploadFileToCloudinary(datasheetFile, { category: "parts/datasheets" })
        : Promise.resolve(""),
    ]);

    const doc = await PartApprovalRequest.create({
      requestType,
      newPart: {
        typeOfPart: newPart.typeOfPart || "",
        manufacturerPartNumber: newPart.manufacturerPartNumber || "",
        itemDescription: newPart.itemDescription,
        companyCode: newPart.companyCode,
        category: newPart.category,
        partTypeBatchNo: newPart.partTypeBatchNo,
        photoUrl: photoUrl || "",
        datasheetUrl: datasheetUrl || "",
      },
      alternateOfPart: requestType === "alternate_part" ? alternateOfPartId : null,
      vendor: vendorId || null,
      purchaseOrder: purchaseOrderId || null,
      searchTerm,
      proposedQuantity: proposedQuantity == null || proposedQuantity === "" ? null : Number(proposedQuantity),
      requestedBy: requestedBy || req.user?.name || req.user?.username || "",
      requestedByUser: req.user?._id || null,
      requestRemarks,
    });

    // Notify every approver (admins) that a part number is waiting.
    try {
      await notifyApprovers({
        permission: "part.approve",
        actorId: req.user?._id,
        title:
          requestType === "alternate_part"
            ? "Alternate part number needs approval"
            : "New part number needs approval",
        message: `${partLabel(doc)} raised by ${
          doc.requestedBy || "a user"
        } is waiting for your approval.`,
        link: "/parts",
        entityType: "part",
        entityId: doc._id,
      });
    } catch (e) {
      console.error("part approval notification failed:", e.message);
    }

    const populated = await doc.populate([
      { path: "alternateOfPart", select: "ttUniquePartNumber itemDescription" },
      { path: "vendor", select: "companyName" },
    ]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not raise the approval request" });
  }
};

/**
 * GET /api/part-approvals?status=pending&vendor=<id>&search=<text>&mine=1
 * Non-approvers only ever see their own requests.
 */
export const listRequests = async (req, res) => {
  try {
    const { status = "pending", vendor, search, mine } = req.query;
    const filter = {};
    if (status && status !== "all") {
      const list = String(status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = list.length > 1 ? { $in: list } : list[0];
    }
    if (vendor) filter.vendor = vendor;

    const canApprove = (req.permissions || []).includes("part.approve");
    if (!canApprove || mine === "1") {
      filter.requestedByUser = req.user?._id || null;
    }

    if (search && search.trim()) {
      const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { "newPart.itemDescription": rx },
        { "newPart.manufacturerPartNumber": rx },
        { "newPart.partTypeBatchNo": rx },
        { "newPart.category": rx },
        { searchTerm: rx },
      ];
    }

    const requests = await PartApprovalRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("alternateOfPart", "ttUniquePartNumber itemDescription")
      .populate("vendor", "companyName")
      .populate("createdPart", "ttUniquePartNumber");
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not load approval requests" });
  }
};

/** GET /api/part-approvals/pending-count — badge helper (approvers only) */
export const pendingCount = async (req, res) => {
  try {
    const canApprove = (req.permissions || []).includes("part.approve");
    const filter = { status: "pending" };
    if (!canApprove) filter.requestedByUser = req.user?._id || null;
    const count = await PartApprovalRequest.countDocuments(filter);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/** PATCH /api/part-approvals/:id/approve  { reviewRemarks } — admin only */
export const approveRequest = async (req, res) => {
  try {
    const doc = await PartApprovalRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Request not found" });
    if (doc.status === "consumed")
      return res.status(400).json({ message: "This request has already been used" });
    if (doc.status === "approved") return res.json(doc);

    doc.status = "approved";
    doc.reviewedBy = req.user?.name || req.user?.username || req.body.reviewedBy || "";
    doc.reviewedByUser = req.user?._id || null;
    doc.reviewRemarks = req.body.reviewRemarks || "";
    doc.reviewedAt = new Date();

    // Put the part number straight into the Parts master the moment it's
    // approved — it should not have to wait for someone to book a stock
    // entry against it. Never runs on rejection. Skipped if a part was
    // already created for this request (e.g. re-approving after an edit).
    if (!doc.createdPart) {
      const partDoc = await createPartFromApprovedRequest(doc);
      doc.createdPart = partDoc._id;
    }

    await doc.save();

    try {
      await notifyRequester({
        recipientId: doc.requestedByUser,
        approved: true,
        actorId: req.user?._id,
        title: "Part number approved",
        message: `${partLabel(doc)} was approved by ${
          doc.reviewedBy || "the admin"
        } and added to the parts master. You can now book the stock quantity.`,
        link: "/receive",
        entityType: "part",
        entityId: doc._id,
      });
    } catch (e) {
      console.error("part approval notification failed:", e.message);
    }

    const populated = await PartApprovalRequest.findById(doc._id)
      .populate("alternateOfPart", "ttUniquePartNumber itemDescription")
      .populate("vendor", "companyName")
      .populate("createdPart", "ttUniquePartNumber");
    res.json(populated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Could not approve the request" });
  }
};

/** PATCH /api/part-approvals/:id/reject  { reviewRemarks } — admin only */
export const rejectRequest = async (req, res) => {
  try {
    const doc = await PartApprovalRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Request not found" });
    if (doc.status === "consumed")
      return res.status(400).json({ message: "This request has already been used" });

    doc.status = "rejected";
    doc.reviewedBy = req.user?.name || req.user?.username || req.body.reviewedBy || "";
    doc.reviewedByUser = req.user?._id || null;
    doc.reviewRemarks = req.body.reviewRemarks || "";
    doc.reviewedAt = new Date();
    await doc.save();

    try {
      await notifyRequester({
        recipientId: doc.requestedByUser,
        approved: false,
        actorId: req.user?._id,
        title: "Part number rejected",
        message: `${partLabel(doc)} was rejected${
          doc.reviewRemarks ? `: ${doc.reviewRemarks}` : "."
        }`,
        link: "/receive",
        entityType: "part",
        entityId: doc._id,
      });
    } catch (e) {
      console.error("part rejection notification failed:", e.message);
    }

    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not reject the request" });
  }
};

/**
 * PATCH /api/part-approvals/:id/consume  { partId }
 * Called right after the stock entry succeeded.
 */
export const consumeRequest = async (req, res) => {
  try {
    const doc = await PartApprovalRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Request not found" });
    if (doc.status !== "approved")
      return res.status(400).json({ message: "Only an approved request can be consumed" });

    doc.status = "consumed";
    doc.createdPart = req.body.partId || null;
    doc.consumedAt = new Date();
    await doc.save();
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not close the request" });
  }
};

/**
 * PATCH /api/part-approvals/:id  — ADMIN ONLY
 * Edit a request from the Parts master approvals panel. Works on pending,
 * approved AND rejected rows, so a wrong description / mfr number / category
 * can be corrected after the decision was taken.
 *
 * Body: { newPart: {...}, proposedQuantity, requestRemarks, reviewRemarks, status }
 * `status` may be moved between pending | approved | rejected (a consumed
 * request is locked because stock was already booked against it).
 */
const EDITABLE_PART_FIELDS = [
  "typeOfPart",
  "manufacturerPartNumber",
  "itemDescription",
  "companyCode",
  "category",
  "partTypeBatchNo",
];

export const updateRequest = async (req, res) => {
  try {
    const doc = await PartApprovalRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Request not found" });
    if (doc.status === "consumed")
      return res
        .status(400)
        .json({ message: "Stock is already booked against this request — it cannot be edited" });

    const incoming = req.body.newPart || {};
    for (const f of EDITABLE_PART_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(incoming, f)) {
        doc.newPart[f] = String(incoming[f] ?? "").trim();
      }
    }
    if (!String(doc.newPart.itemDescription || "").trim())
      return res.status(400).json({ message: "Description cannot be empty" });

    if (Object.prototype.hasOwnProperty.call(req.body, "proposedQuantity")) {
      const q = req.body.proposedQuantity;
      doc.proposedQuantity = q === "" || q == null ? null : Number(q);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "requestRemarks"))
      doc.requestRemarks = String(req.body.requestRemarks || "");
    if (Object.prototype.hasOwnProperty.call(req.body, "reviewRemarks"))
      doc.reviewRemarks = String(req.body.reviewRemarks || "");

    let statusChanged = false;
    if (req.body.status && req.body.status !== doc.status) {
      if (!["pending", "approved", "rejected"].includes(req.body.status))
        return res.status(400).json({ message: "Invalid status" });
      doc.status = req.body.status;
      statusChanged = true;
      if (doc.status === "pending") {
        doc.reviewedAt = null;
        doc.reviewedBy = "";
        doc.reviewedByUser = null;
      } else {
        doc.reviewedAt = new Date();
        doc.reviewedBy = req.user?.name || req.user?.username || "";
        doc.reviewedByUser = req.user?._id || null;
      }
    }

    // Same as approveRequest: a request moved to "approved" from here (the
    // admin edit panel) should also get its part created immediately, not
    // just one approved through the normal Approve button.
    if (doc.status === "approved" && !doc.createdPart) {
      const partDoc = await createPartFromApprovedRequest(doc);
      doc.createdPart = partDoc._id;
    }

    doc.markModified("newPart");
    await doc.save();

    // Keep the requester in the loop about any admin edit.
    try {
      await notifyRequester({
        recipientId: doc.requestedByUser,
        approved: doc.status === "approved",
        actorId: req.user?._id,
        title: statusChanged ? `Part request marked ${doc.status}` : "Part request updated",
        message: `${partLabel(doc)} was edited by ${
          req.user?.name || req.user?.username || "the admin"
        }${statusChanged ? ` and is now ${doc.status}` : ""}.`,
        link: "/parts",
        entityType: "part",
        entityId: doc._id,
      });
    } catch (e) {
      console.error("part request edit notification failed:", e.message);
    }

    const populated = await PartApprovalRequest.findById(doc._id)
      .populate("alternateOfPart", "ttUniquePartNumber itemDescription")
      .populate("vendor", "companyName")
      .populate("createdPart", "ttUniquePartNumber");
    res.json(populated);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Could not update the request" });
  }
};