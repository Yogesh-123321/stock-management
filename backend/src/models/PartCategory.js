import mongoose from "mongoose";

/*
  The predefined "PART 2" list used when building a TT UNIQUE PART NUMBER
  (see utils/generatePartNumber.js and Part.js) — e.g. RS, RT, AY, SY ...

  Seeded from the current Technotrendz abbreviation sheet
  (see data/partCategories.seed.json / utils/seedPartCategories.js), and
  extendable at runtime by an admin from the "Part categories" utility —
  every category added there is inserted here and immediately shows up
  everywhere the category picker is used (new-part requests, admin part
  edits, receiving flow, excel import).
*/
const partCategorySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    description: { type: String, required: true, trim: true },
    addedBy: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("PartCategory", partCategorySchema);