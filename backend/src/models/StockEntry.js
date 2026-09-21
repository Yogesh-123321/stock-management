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
    // The "Receive material" wizard session this line was logged under, if
    // any (entries booked outside that wizard — e.g. the Excel bulk import
    // — leave this null). Most deliveries never get a PO/PI attached, so
    // this is the reliable way to know which lines belong to which
    // in-progress delivery: it lets a "Save & exit" + "Resume" restore the
    // lines already logged even when there's no document to key off of.
    receivingSession: { type: mongoose.Schema.Types.ObjectId, ref: "ReceivingSession", default: null },
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

    // Unit of measure and per-unit rate for THIS delivery, as entered at
    // receiving time — optional, and deliberately separate from the part
    // master's own Part.price/unit (which is just one current registered
    // rate shared by every part). Recording it here means each delivery
    // can carry its own real price, which is what lets Part history and
    // the AI Price Analyzer show genuine price movement over time instead
    // of the same static master rate repeated for every line.
    unit: { type: String, trim: true, default: "" },
    price: { type: Number, min: 0, default: null },

    // A stock entry is logged the moment material is entered in Step 4 of the
    // receiving wizard, but the quantity is only credited to the part's
    // quantityInStock once it has cleared IQC (Incoming Quality Control) —
    // see iqcStatus below. stockApplied is only ever set true by an
    // "accepted" IQC decision (see submitIqcReport in
    // iqcInspectionController.js); a rejected or still-pending IQC line
    // never touches Part.quantityInStock.
    stockApplied: { type: Boolean, default: false },
    appliedAt: { type: Date, default: null },
    // The tax invoice whose upload moved this line out of "awaiting_invoice"
    // and into IQC (see moveDeliveryStockToIqc in taxInvoiceController.js).
    appliedVia: { type: mongoose.Schema.Types.ObjectId, ref: "TaxInvoice", default: null },

    // IQC (Incoming Quality Control) status for this line:
    //   awaiting_invoice - tax invoice hasn't arrived yet; not yet eligible
    //                       for inspection (the pre-existing "pending" state)
    //   in_iqc_stock      - the tax invoice has arrived but no IQC report has
    //                        been filled (or it just hasn't been resolved
    //                        yet) — held in "IQC stock", separate from the
    //                        part's main stock, until someone inspects it
    //   accepted          - an IQC report was filled, every point on it was
    //                        checked, and it was marked accepted -> credited
    //                        to Part.quantityInStock (stockApplied: true)
    //   rejected          - an IQC report was filled, every point on it was
    //                        checked, and it was marked rejected -> never
    //                        credited to main stock; held in "rejected stock"
    iqcStatus: {
      type: String,
      enum: ["awaiting_invoice", "in_iqc_stock", "accepted", "rejected"],
      default: "awaiting_invoice",
    },

    // The filled-out IQC checklist for this line, if one was done. Points
    // are copied from an IqcTemplate (models/IqcTemplate.js) at the moment
    // of inspection, so this stays a true record of what was checked even
    // if the template is edited or deleted afterwards.
    iqcReport: {
      template: { type: mongoose.Schema.Types.ObjectId, ref: "IqcTemplate", default: null },
      materialName: { type: String, trim: true, default: "" },
      items: {
        type: [
          {
            name: { type: String, trim: true },
            specification: { type: String, trim: true, default: "" },
            unit: { type: String, trim: true, default: "" },
            checked: { type: Boolean, default: false },
          },
        ],
        default: [],
      },
      decision: { type: String, enum: ["accepted", "rejected", null], default: null },
      // Partial approval: the inspector enters how much of the delivered
      // quantity they approve; the rest is rejected and needs a reason.
      // When only part of a line is approved the line is split in two
      // (see submitIqcReport): the accepted line keeps the approved
      // quantity and a new rejected line holds the remainder — both carry
      // the same figures below so either one tells the whole story.
      originalQuantity: { type: Number, default: null },
      acceptedQuantity: { type: Number, default: null },
      rejectedQuantity: { type: Number, default: null },
      rejectionReason: { type: String, trim: true, default: "" },
      // Who ran the inspection — stamped from the signed-in user by
      // submitIqcReport (never taken from the request body). The name is
      // copied onto the line so the record survives a renamed / removed
      // account; the id links back to the User.
      inspectedBy: { type: String, trim: true, default: "" },
      inspectedByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      inspectedAt: { type: Date, default: null },
    },

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