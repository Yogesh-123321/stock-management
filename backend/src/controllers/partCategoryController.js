import asyncHandler from "express-async-handler";
import PartCategory from "../models/PartCategory.js";

// GET /api/part-categories
// Open to anyone signed in (same read-open pattern as /api/parts) — this is
// what powers the category dropdown wherever a part is being registered,
// for both a normal user and an admin.
export const getPartCategories = asyncHandler(async (req, res) => {
  const categories = await PartCategory.find().sort({ code: 1 });
  res.json(categories);
});

// POST /api/part-categories  (ADMIN ONLY — see partCategoryRoutes.js)
// The admin's "add a new part category" utility. Newly added categories
// are appended to the list returned above immediately — no separate
// publish step.
export const createPartCategory = asyncHandler(async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const description = String(req.body.description || "").trim();

  if (!code || !description) {
    res.status(400);
    throw new Error("Category code and description are required");
  }
  if (!/^[A-Z0-9]{1,10}$/.test(code)) {
    res.status(400);
    throw new Error("Category code should be letters/numbers only (max 10 characters)");
  }

  const existing = await PartCategory.findOne({ code: { $regex: `^${code}$`, $options: "i" } });
  if (existing) {
    res.status(409);
    throw new Error(`Category "${code}" already exists — ${existing.description}`);
  }

  const category = await PartCategory.create({
    code,
    description,
    addedBy: req.user?.name || req.user?.username || "",
  });
  res.status(201).json(category);
});

// PATCH /api/part-categories/:id  (ADMIN ONLY)
// Description can always be corrected. Changing the code renames it
// everywhere: every part currently filed under the old code is
// re-pointed to the new one (Part.category), so the master stays
// consistent with the category list. The TT UNIQUE PART NUMBER on those
// parts is never touched — it was fixed at creation time
// (COMPANY CODE + CATEGORY + PART TYPE/BATCH NO.) and stays exactly as
// it is, so existing part numbers, POs, stock history, etc. keep working
// unchanged. Only the part's `category` field (PART 2) moves to the new
// code.
export const updatePartCategory = asyncHandler(async (req, res) => {
  const category = await PartCategory.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  const nextDescription =
    req.body.description !== undefined ? String(req.body.description).trim() : category.description;
  if (!nextDescription) {
    res.status(400);
    throw new Error("Description is required");
  }

  const nextCode =
    req.body.code !== undefined ? String(req.body.code).trim().toUpperCase() : category.code;

  let partsUpdated = 0;

  if (nextCode !== category.code) {
    if (!/^[A-Z0-9]{1,10}$/.test(nextCode)) {
      res.status(400);
      throw new Error("Category code should be letters/numbers only (max 10 characters)");
    }

    const dupe = await PartCategory.findOne({
      _id: { $ne: category._id },
      code: { $regex: `^${nextCode}$`, $options: "i" },
    });
    if (dupe) {
      res.status(409);
      throw new Error(`Category "${nextCode}" already exists — ${dupe.description}`);
    }

    const oldCode = category.code;
    const Part = (await import("../models/Part.js")).default;

    // Re-file every part under the new code. `ttUniquePartNumber` is
    // intentionally left out of this update — only `category` changes.
    const result = await Part.updateMany({ category: oldCode }, { $set: { category: nextCode } });
    partsUpdated = result.modifiedCount || 0;

    category.code = nextCode;
  }

  category.description = nextDescription;
  await category.save();

  res.json({ ...category.toObject(), partsUpdated });
});

// DELETE /api/part-categories/:id  (ADMIN ONLY)
// Only ever removes a category that no part currently uses — kept as a
// narrow undo for a category added by mistake, not a general delete.
export const deletePartCategory = asyncHandler(async (req, res) => {
  const category = await PartCategory.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  const Part = (await import("../models/Part.js")).default;
  const inUse = await Part.exists({ category: category.code });
  if (inUse) {
    res.status(409);
    throw new Error(`Category "${category.code}" is already used by parts in the master and can't be removed`);
  }

  await category.deleteOne();
  res.json({ deleted: true, id: category._id });
});