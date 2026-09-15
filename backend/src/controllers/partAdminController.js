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
  "isAlternatePart",
  "remarks",
];

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

    // Photo (JPEG) and datasheet (PDF) — only replaced when a new file is
    // actually attached to this request; leaving the input empty keeps
    // whatever is already on the part.
    const photoFile = req.files?.photo?.[0];
    const datasheetFile = req.files?.datasheet?.[0];
    if (photoFile) {
      payload.photoUrl = await uploadFileToCloudinary(photoFile, { category: "parts/photos" });
    }
    if (datasheetFile) {
      payload.datasheetUrl = await uploadFileToCloudinary(datasheetFile, {
        category: "parts/datasheets",
      });
    }

    Object.assign(part, payload);
    part.lastEditedBy = req.user?.name || req.user?.username || "";
    part.lastEditedAt = new Date();
    await part.save();

    const populated = await Part.findById(part._id).populate("vendors", "companyName");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not update the part" });
  }
};

export default { updatePart };