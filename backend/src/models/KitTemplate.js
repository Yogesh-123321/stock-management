import mongoose from "mongoose";

/*
  A KitTemplate is the admin-authored "recipe" for a kit — e.g. the
  iMoniCAM Sub-Assy BOM. It never stores a live reference to a Part
  document; every line is matched to the parts master purely by
  ttUniquePartNumber (the distinguishing factor, per the master part
  database convention — see Part.js). That keeps a template correct even
  if the underlying Part record is edited or re-created, and lets an admin
  build a template for a part number that doesn't exist in the master yet
  (it will simply show as "not in master" until it does).
*/
const kitItemSchema = new mongoose.Schema(
  {
    srNo: { type: Number, default: null },
    // Reference designator(s) on the board this line covers, e.g. "C1" or
    // "C15, C16, C17" — free text, exactly as it appears on the BOM.
    referenceDesignator: { type: String, trim: true, default: "" },
    value: { type: String, trim: true, default: "" }, // e.g. "10 µF (10V, ±10%)"
    partType: { type: String, trim: true, default: "" }, // e.g. Capacitor, Resistor, Connector

    ttUniquePartNumber: { type: String, required: true, trim: true, uppercase: true },

    // Reference-only fields carried over from the BOM for readability —
    // never used for matching (ttUniquePartNumber is the only key that is).
    manufacturerPartNumber: { type: String, trim: true, default: "" },
    manufacturer: { type: String, trim: true, default: "" },
    footprint: { type: String, trim: true, default: "" },

    qtyPerKit: { type: Number, required: true, min: 0 },
    // "Do Not Populate" — kept on the template for reference but excluded
    // from stock checks and from what gets deducted when a kit is issued.
    dnp: { type: Boolean, default: false },
    remarks: { type: String, trim: true, default: "" },
  },
  { _id: true }
);

const kitTemplateSchema = new mongoose.Schema(
  {
    kitName: { type: String, required: true, trim: true },
    // Optional human document/kit code, e.g. "TMPL_XXXX_iMONICAM_BOM".
    kitCode: { type: String, trim: true, default: "" },
    revision: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },

    items: { type: [kitItemSchema], default: [] },

    isActive: { type: Boolean, default: true },

    createdBy: { type: String, trim: true, default: "" },
    createdByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

kitTemplateSchema.index({ kitName: "text", kitCode: "text" });

kitTemplateSchema.virtual("itemCount").get(function () {
  return Array.isArray(this.items) ? this.items.length : 0;
});
kitTemplateSchema.set("toJSON", { virtuals: true });
kitTemplateSchema.set("toObject", { virtuals: true });

export default mongoose.model("KitTemplate", kitTemplateSchema);