import mongoose from "mongoose";

/*
  Each StockEntry is one line of received material tied back to a
  purchase order / proforma invoice and a vendor. It records whether
  the part number already existed (quantity added to existing stack)
  or was newly created, and whether it was registered as an alternate
  of an existing part.
*/
const stockEntrySchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    // Optional: material can arrive before any PO/PI paperwork does.
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", default: null },
    part: { type: mongoose.Schema.Types.ObjectId, ref: "Part", required: true },

    quantityReceived: { type: Number, required: true, min: 1 },

    matchType: {
      type: String,
      enum: ["existing_part_number", "new_part_number", "alternate_part"],
      required: true,
    },
    alternateOfPart: { type: mongoose.Schema.Types.ObjectId, ref: "Part", default: null },

    enteredBy: { type: String, trim: true },
    remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("StockEntry", stockEntrySchema);
