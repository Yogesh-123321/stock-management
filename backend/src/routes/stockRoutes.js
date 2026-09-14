import express from "express";
import {
  getStockEntries,
  createStockEntry,
  deleteStockEntry,
  getStockEntrySuggestions,
  reportQuantityMismatch,
} from "../controllers/stockController.js";
import { parseStockImport, commitStockImport } from "../controllers/stockImportController.js";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadStockSheet } from "../middleware/upload.js";

const router = express.Router();

// Specific GET/POST paths first so they aren't shadowed by "/" or "/:id".
router.get("/suggest-warnings", getStockEntrySuggestions);
router.post("/report-mismatch", reportQuantityMismatch);

router.get("/", getStockEntries);
router.post("/", createStockEntry);
router.delete("/:id", protect, requirePermission("receive.manage"), deleteStockEntry);

// Bulk import from a vendor's own inward-stock workbook (e.g. the KKTRON
// sheet). Parsing is read-only; nothing is booked until "commit" is called,
// and "commit" itself never puts a new part number into stock without an
// approval — see stockImportController.js.
router.post(
  "/import/parse",
  protect,
  requirePermission("receive.manage"),
  uploadStockSheet.single("file"),
  parseStockImport
);
router.post("/import/commit", protect, requirePermission("receive.manage"), commitStockImport);

export default router;