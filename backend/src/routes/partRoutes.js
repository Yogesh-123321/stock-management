import express from "express";
import {
  getParts,
  getPartsCount,
  lookupPart,
  suggestParts,
  getPartById,
  getPartHistory,
  createPart,
  adjustPartStock,
  getDuplicateParts,
  getDuplicateCriteria,
  deletePart,
} from "../controllers/partController.js";
import { updatePart } from "../controllers/partAdminController.js";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadPartDoc } from "../middleware/upload.js";

const router = express.Router();

// A part's photo and datasheet are both optional, re-uploaded to
// Cloudinary only when a new file is actually chosen (see updatePart).
const partDocFields = uploadPartDoc.fields([
  { name: "photo", maxCount: 1 },
  { name: "datasheet", maxCount: 1 },
]);

// Declared before "/:id" so it is never swallowed by the id route.
router.get("/duplicates", getDuplicateParts);
router.get("/duplicate-criteria", getDuplicateCriteria);
router.get("/count", getPartsCount);

router.get("/", getParts);
router.get("/lookup", lookupPart);
router.get("/suggest", suggestParts);
router.get("/:id", getPartById);
router.get("/:id/history", getPartHistory);
router.post("/", createPart);
router.patch("/:id/stock", adjustPartStock);

// Editing and deleting the parts master is ADMIN ONLY — part.approve is
// flagged adminOnly in permissions.js.
router.patch("/:id", protect, requirePermission("part.approve"), partDocFields, updatePart);
router.delete("/:id", protect, requirePermission("part.approve"), deletePart);

export default router;