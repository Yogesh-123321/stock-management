import mongoose from "mongoose";

/*
  IQC (Incoming Quality Control) template.

  Defines, for a given material, the list of parameters that must be
  checked when it is received — e.g. for "Aluminium Enclosure":
  dimensions, surface finish, paint thickness, etc.

  ADMIN ONLY creates / edits / deletes these (see iqcTemplateRoutes.js —
  same "part.approve"-style admin gate, using its own "iqc.manage"
  permission). Anyone signed in can read the list, the same way part
  categories are readable by everyone but only editable by an admin —
  this is what will power the IQC checklist shown during material
  receiving/inspection.
*/
const iqcParameterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    specification: { type: String, trim: true, default: "" }, // acceptance criteria, e.g. "±0.1mm"
    unit: { type: String, trim: true, default: "" }, // e.g. "mm", "V", "Ω"
  },
  { _id: false }
);

const iqcTemplateSchema = new mongoose.Schema(
  {
    materialName: { type: String, required: true, trim: true },
    parameters: {
      type: [iqcParameterSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one parameter is required",
      },
    },
    addedBy: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("IqcTemplate", iqcTemplateSchema);