import mongoose from "mongoose";

/*
  Mirrors the structure of the Master Part Database workbook:
  TT UNIQUE PART NUMBER = COMPANY CODE + CATEGORY + PART TYPE/BATCH NO. + RUNNING SERIAL NO.
  e.g. TT + AY + FAN + 001 => TTAYFAN001
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
    runningSerialNo: { type: String, required: true, trim: true }, // PART 4 - auto increment

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