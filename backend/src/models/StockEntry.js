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

    // A stock entry is logged the moment material is entered in Step 4 of the
    // receiving wizard, but the quantity is only credited to the part's
    // quantityInStock once the tax invoice for the same delivery arrives.
    // Until then this line sits here as a "pending" record so nothing shows
    // up in the parts master that hasn't been billed yet.
    stockApplied: { type: Boolean, default: false },
    appliedAt: { type: Date, default: null },
    // The tax invoice whose upload caused this line to be credited to stock.
    appliedVia: { type: mongoose.Schema.Types.ObjectId, ref: "TaxInvoice", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("StockEntry", stockEntrySchema);