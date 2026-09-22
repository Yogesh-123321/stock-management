import asyncHandler from "express-async-handler";
import IqcTemplate from "../models/IqcTemplate.js";
import { uploadFileToCloudinary } from "../config/cloudinary.js";

// `parameters` arrives as a real array on a plain JSON request, but as a
// JSON-encoded string when the form is submitted as multipart/form-data
// (needed so the reference file can travel in the same request) — handle
// both.
const sanitizeParameters = (input) => {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  raw = Array.isArray(raw) ? raw : [];
  return raw
    .map((p) => ({
      name: String(p?.name || "").trim(),
      specification: String(p?.specification || "").trim(),
      unit: String(p?.unit || "").trim(),
    }))
    .filter((p) => p.name);
};

// GET /api/iqc-templates
// Open to anyone signed in — same read-open pattern as /api/part-categories.
// This is what will power the IQC checklist during material receiving.
export const getIqcTemplates = asyncHandler(async (req, res) => {
  const templates = await IqcTemplate.find().sort({ materialName: 1 });
  res.json(templates);
});

// GET /api/iqc-templates/:id
export const getIqcTemplateById = asyncHandler(async (req, res) => {
  const template = await IqcTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("IQC template not found");
  }
  res.json(template);
});

// POST /api/iqc-templates  (ADMIN ONLY — see iqcTemplateRoutes.js)
// The admin's "create an IQC template" utility — material name, the list
// of parameters to be checked for it, and an optional reference image/PDF
// (e.g. an approved-sample photo or drawing) uploaded via multipart/form-data
// as `referenceFile` (see uploadIqcTemplateDoc in middleware/upload.js).
export const createIqcTemplate = asyncHandler(async (req, res) => {
  const materialName = String(req.body.materialName || "").trim();
  const parameters = sanitizeParameters(req.body.parameters);

  if (!materialName) {
    res.status(400);
    throw new Error("Material name is required");
  }
  if (parameters.length === 0) {
    res.status(400);
    throw new Error("At least one parameter is required");
  }

  const existing = await IqcTemplate.findOne({
    materialName: { $regex: `^${materialName}$`, $options: "i" },
  });
  if (existing) {
    res.status(409);
    throw new Error(`An IQC template already exists for "${materialName}"`);
  }

  let referenceFileUrl = "";
  let referenceFileName = "";
  if (req.file) {
    referenceFileUrl = await uploadFileToCloudinary(req.file, { category: "iqc-templates" });
    referenceFileName = req.file.originalname || "";
  }

  const template = await IqcTemplate.create({
    materialName,
    parameters,
    referenceFileUrl,
    referenceFileName,
    addedBy: req.user?.name || req.user?.username || "",
  });
  res.status(201).json(template);
});

// PATCH /api/iqc-templates/:id  (ADMIN ONLY)
// A new `referenceFile` replaces the existing one; sending
// `removeReferenceFile: "true"` with no new file clears it instead.
// Leaving both out keeps whatever reference file is already on the template.
export const updateIqcTemplate = asyncHandler(async (req, res) => {
  const template = await IqcTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("IQC template not found");
  }

  const nextMaterialName =
    req.body.materialName !== undefined
      ? String(req.body.materialName).trim()
      : template.materialName;
  if (!nextMaterialName) {
    res.status(400);
    throw new Error("Material name is required");
  }

  if (nextMaterialName.toLowerCase() !== template.materialName.toLowerCase()) {
    const dupe = await IqcTemplate.findOne({
      _id: { $ne: template._id },
      materialName: { $regex: `^${nextMaterialName}$`, $options: "i" },
    });
    if (dupe) {
      res.status(409);
      throw new Error(`An IQC template already exists for "${nextMaterialName}"`);
    }
  }

  const nextParameters =
    req.body.parameters !== undefined
      ? sanitizeParameters(req.body.parameters)
      : template.parameters;
  if (nextParameters.length === 0) {
    res.status(400);
    throw new Error("At least one parameter is required");
  }

  template.materialName = nextMaterialName;
  template.parameters = nextParameters;

  if (req.file) {
    template.referenceFileUrl = await uploadFileToCloudinary(req.file, { category: "iqc-templates" });
    template.referenceFileName = req.file.originalname || "";
  } else if (String(req.body.removeReferenceFile || "") === "true") {
    template.referenceFileUrl = "";
    template.referenceFileName = "";
  }

  await template.save();

  res.json(template);
});

// DELETE /api/iqc-templates/:id  (ADMIN ONLY)
export const deleteIqcTemplate = asyncHandler(async (req, res) => {
  const template = await IqcTemplate.findById(req.params.id);
  if (!template) {
    res.status(404);
    throw new Error("IQC template not found");
  }

  await template.deleteOne();
  res.json({ deleted: true, id: template._id });
});