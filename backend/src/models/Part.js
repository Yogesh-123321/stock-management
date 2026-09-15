import mongoose from "mongoose";

/*
  Mirrors the structure of the Master Part Database workbook:
  TT UNIQUE PART NUMBER = COMPANY CODE + CATEGORY + PART TYPE/BATCH NO.
  e.g. TT + AY + FAN => TTAYFAN
*/
const partSchema = new mongoose.Schema(
  {
    ttUniquePartNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
    typeOfPart: { type: String, trim: true }, // e.g. PCB, MECHANICAL
    manufacturerPartNumber: { type: String, trim: true },
    itemDescription: { type: String, required: true, trim: true },
    companyCode: { type: String, required: true, trim: true, uppercase: true }, // PART 1 - fixed (e.g. TT)
    category: { type: String, required: true, trim: true, uppercase: true }, // PART 2 - predefined list
    partTypeBatchNo: { type: String, required: true, trim: true, uppercase: true }, // PART 3 - predefined list
    // Historical field — the part number used to end in an auto-incrementing
    // serial (PART 4). It no longer does (see utils/generatePartNumber.js);
    // kept only so older rows imported before that change still show theirs.
    runningSerialNo: { type: String, trim: true, default: "" },

    hsnCode: { type: String, trim: true, default: "" },
    unit: { type: String, trim: true, default: "" },

    // Reference files kept alongside the part record — both optional,
    // uploaded to Cloudinary the same way vendor/buyer documents are (see
    // config/cloudinary.js). photoUrl is a JPEG image of the part;
    // datasheetUrl is its manufacturer/technical datasheet PDF.
    photoUrl: { type: String, trim: true, default: "" },
    datasheetUrl: { type: String, trim: true, default: "" },

    // Free-text notes about the part. Pre-filled from the "remarks for the
    // approver" the operator typed when raising the new-part / alternate-part
    // request (see PartApprovalRequest.requestRemarks and
    // utils/stockBooking.js), and editable afterwards from the parts master
    // edit popup (see controllers/partAdminController.js). Shown read-only
    // in the part details popup.
    remarks: { type: String, trim: true, default: "" },
    lastEditedBy: { type: String, trim: true, default: "" },
    lastEditedAt: { type: Date, default: null },

    quantityInStock: { type: Number, default: 0, min: 0 },

    // Every vendor this part has ever been received from. Populated with
    // companyName and rendered as "VendorA / VendorB" wherever the part is
    // displayed. New vendors are appended (deduped) each time stock for this
    // part is received from a vendor not already on the list.
    vendors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vendor" }],

    // Alternate-part linkage: if this part is an accepted substitute for another
    isAlternatePart: { type: Boolean, default: false },
    alternateOf: { type: mongoose.Schema.Types.ObjectId, ref: "Part", default: null },
    alternateParts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Part" }],
  },
  { timestamps: true }
);

partSchema.index({ itemDescription: "text", manufacturerPartNumber: "text" });

// Requires `vendors` to be populated with companyName first.
// e.g. part.populate("vendors", "companyName") -> part.vendorNamesJoined
partSchema.virtual("vendorNamesJoined").get(function () {
  if (!Array.isArray(this.vendors)) return "";
  return this.vendors
    .map((v) => (v && v.companyName ? v.companyName : null))
    .filter(Boolean)
    .join(" / ");
});
partSchema.set("toJSON", { virtuals: true });

export default mongoose.model("Part", partSchema);