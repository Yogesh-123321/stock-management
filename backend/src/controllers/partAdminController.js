import mongoose from "mongoose";
import Part from "../models/Part.js";
import { uploadFileToCloudinary } from "../config/cloudinary.js";

/**
 * Admin-only editing of the parts master.
 *
 * Wired in backend/src/routes/partRoutes.js:
 *   router.patch("/:id", protect, requirePermission("part.approve"), partDocFields, updatePart);
 */

/** Fields an admin may change from the parts master edit popup. */
const EDITABLE = [
  "ttUniquePartNumber",
  "itemDescription",
  "manufacturerPartNumber",
  "typeOfPart",
  "companyCode",
  "category",
  "partTypeBatchNo",
  "hsnCode",
  "unit",
  "price",
  "isAlternatePart",
  "remarks",
];

/*
  Appends a documentHistory entry to `part` (in memory — caller must still
  .save() it) if the field's URL actually changed. Call this BEFORE
  overwriting part.photoUrl / part.datasheetUrl with the new value, so
  `previousUrl` still reflects what was there before this edit.

  action is inferred from the before/after state:
    no url -> a url         = "added"
    a url  -> no url        = "removed"
    a url  -> a different url = "replaced"
    a url  -> the same url  = no-op, nothing logged
*/
function logDocumentChange(part, field, nextUrl, changedBy) {
  const previousUrl = part[field] || null;
  const resolvedNext = nextUrl || null;
  if (previousUrl === resolvedNext) return; // nothing actually changed

  const action = !previousUrl ? "added" : !resolvedNext ? "removed" : "replaced";

  part.documentHistory.push({
    field,
    action,
    url: resolvedNext,
    previousUrl,
    changedBy: changedBy || "",
  });
}

export const updatePart = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid part id" });

    const part = await Part.findById(id);
    if (!part) return res.status(404).json({ message: "Part not found" });

    const payload = {};
    for (const field of EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        payload[field] =
          typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
      }
    }

    if (payload.itemDescription === "")
      return res.status(400).json({ message: "Description cannot be empty" });

    // price arrives as a string (multipart form) — cast to a number, or
    // null when cleared, rather than letting an empty string hit the
    // schema's Number field directly.
    if (Object.prototype.hasOwnProperty.call(payload, "price")) {
      payload.price = payload.price === "" ? null : Number(payload.price);
      if (payload.price !== null && Number.isNaN(payload.price)) {
        return res.status(400).json({ message: "Price must be a number" });
      }
    }

    // The TT part number must stay unique across the master.
    if (payload.ttUniquePartNumber && payload.ttUniquePartNumber !== part.ttUniquePartNumber) {
      const clash = await Part.findOne({
        _id: { $ne: part._id },
        ttUniquePartNumber: payload.ttUniquePartNumber,
      }).select("_id");
      if (clash)
        return res
          .status(409)
          .json({ message: `Part number ${payload.ttUniquePartNumber} already exists` });
    }

    // Vendors can be re-linked from the popup (array of vendor ids).
    if (Array.isArray(req.body.vendorIds)) {
      payload.vendors = req.body.vendorIds.filter((v) => mongoose.Types.ObjectId.isValid(v));
    }

    const changedByName = req.user?.name || req.user?.username || "";

    // Photo (JPEG) and datasheet (PDF) — only replaced when a new file is
    // actually attached to this request; leaving the input empty keeps
    // whatever is already on the part. Each swap is logged to
    // documentHistory BEFORE the field is overwritten, so previousUrl
    // still points at the outgoing file.
    const photoFile = req.files?.photo?.[0];
    const datasheetFile = req.files?.datasheet?.[0];
    if (photoFile) {
      payload.photoUrl = await uploadFileToCloudinary(photoFile, { category: "parts/photos" });
      logDocumentChange(part, "photo", payload.photoUrl, changedByName);
    }
    if (datasheetFile) {
      payload.datasheetUrl = await uploadFileToCloudinary(datasheetFile, {
        category: "parts/datasheets",
      });
      logDocumentChange(part, "datasheet", payload.datasheetUrl, changedByName);
    }

    Object.assign(part, payload);
    part.lastEditedBy = changedByName;
    part.lastEditedAt = new Date();
    await part.save();

    const populated = await Part.findById(part._id).populate("vendors", "companyName");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not update the part" });
  }
};

export default { updatePart };