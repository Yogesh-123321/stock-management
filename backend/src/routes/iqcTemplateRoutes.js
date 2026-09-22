import express from "express";
import {
  getIqcTemplates,
  getIqcTemplateById,
  createIqcTemplate,
  updateIqcTemplate,
  deleteIqcTemplate,
} from "../controllers/iqcTemplateController.js";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadIqcTemplateDoc } from "../middleware/upload.js";

const router = express.Router();

// Read is open the same way /api/part-categories is — anyone using the
// receiving/inspection flow needs the list to run an IQC check.
router.get("/", getIqcTemplates);
router.get("/:id", getIqcTemplateById);

// Creating / editing / removing an IQC template is admin-only — "iqc.manage"
// is flagged adminOnly in permissions.js, so only an admin ever holds it.
// `uploadIqcTemplateDoc.single("referenceFile")` accepts the optional
// reference image/PDF attached alongside the material name + parameters.
router.post(
  "/",
  protect,
  requirePermission("iqc.manage"),
  uploadIqcTemplateDoc.single("referenceFile"),
  createIqcTemplate
);
router.patch(
  "/:id",
  protect,
  requirePermission("iqc.manage"),
  uploadIqcTemplateDoc.single("referenceFile"),
  updateIqcTemplate
);
router.delete("/:id", protect, requirePermission("iqc.manage"), deleteIqcTemplate);

export default router;