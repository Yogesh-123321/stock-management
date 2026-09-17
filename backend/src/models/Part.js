import mongoose from "mongoose";

/*
  One entry per time a part's photo or datasheet was added, replaced, or
  removed — a lightweight audit trail separate from the stock ledger
  (StockEntry / KitIssue). Appended by updatePart (partAdminController.js)
  whenever photoUrl/datasheetUrl actually change value; read back by
  GET /api/parts/:id/document-history (partController.js).
*/
const documentHistoryEntrySchema = new mongoose.Schema(
  {
    field: { type: String, enum: ["photo", "datasheet"], required: true },
    action: { type: String, enum: ["added", "replaced", "removed"], required: true },
    // The file in place after this change (null if the action was "removed").
    url: { type: String, default: null },
    // The file that was in place before this change (null if "added").
    previousUrl: { type: String, default: null },
    changedBy: { type: String, trim: true, default: "" },
  },
  { timestamps: { createdAt: "date", updatedAt: false } }
);

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

    // Unit price / rate for this part — captured when the part is
    // registered (see PartApprovalRequest.newPart.price and
    // utils/stockBooking.js) and editable afterwards from the parts
    // master edit popup, same as hsnCode/unit above. Always a per-`unit`
    // rate (e.g. price per PCS / per KG / per MTR), not a total — a
    // line's total amount on a tax invoice is quantity * price. Matched
    // against the unitPrice AI-extracts from a vendor's tax invoice line
    // items using the same embeddings-based matching pipeline used for
    // description/quantity — see controllers/taxInvoiceController.js.
    price: { type: Number, min: 0, default: null },

    // Reference files kept alongside the part record — both optional,
    // uploaded to Cloudinary the same way vendor/buyer documents are (see
    // config/cloudinary.js). photoUrl is a JPEG image of the part;
    // datasheetUrl is its manufacturer/technical datasheet PDF.
    photoUrl: { type: String, trim: true, default: "" },
    datasheetUrl: { type: String, trim: true, default: "" },

    // Audit trail of every add/replace/remove of photoUrl or datasheetUrl —
    // see documentHistoryEntrySchema above. Populated by updatePart, read
    // by GET /api/parts/:id/document-history.
    documentHistory: { type: [documentHistoryEntrySchema], default: [] },

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