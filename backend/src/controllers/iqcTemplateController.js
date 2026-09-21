import asyncHandler from "express-async-handler";
import IqcTemplate from "../models/IqcTemplate.js";

const sanitizeParameters = (input) => {
  const raw = Array.isArray(input) ? input : [];
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
// The admin's "create an IQC template" utility — material name plus the
// list of parameters to be checked for it.
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

  const template = await IqcTemplate.create({
    materialName,
    parameters,
    addedBy: req.user?.name || req.user?.username || "",
  });
  res.status(201).json(template);
});

// PATCH /api/iqc-templates/:id  (ADMIN ONLY)
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