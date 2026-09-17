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

    // Decimal-friendly — quantities aren't always whole numbers (e.g.
    // metres of cable, kilograms of a bulk item). min is a small epsilon
    // rather than 0 so a genuinely empty/zero entry is still rejected.
    quantityReceived: { type: Number, required: true, min: 0.001 },

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

    // Lot code in WW/YY format (ISO week / 2-digit year), stamped on once
    // the tax invoice arrives and this entry is applied to stock — see
    // utils/batchCode.js. Built from the invoice's own invoiceDate, never
    // from when this entry was keyed in or applied, so it always reflects
    // when the delivery was actually billed. Stays empty while the entry
    // is still pending (stockApplied: false). Not to be confused with a
    // part's own partTypeBatchNo, which identifies a part *type*, not a
    // delivery lot. Reserved for later use when issuing kit stock.
    batchCode: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("StockEntry", stockEntrySchema);