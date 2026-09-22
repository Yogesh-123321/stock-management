import express from "express";
import {
  getStockEntries,
  createStockEntry,
  deleteStockEntry,
  getStockEntrySuggestions,
  reportQuantityMismatch,
} from "../controllers/stockController.js";
import { parseStockImport, commitStockImport } from "../controllers/stockImportController.js";
import { getIqcStockEntries, submitIqcReport } from "../controllers/iqcInspectionController.js";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadStockSheet } from "../middleware/upload.js";
import { getPartPriceAnalysis } from "../controllers/stockAnalysisController.js";
const router = express.Router();
router.get(
  "/analysis/:partId",
  getPartPriceAnalysis
);
// Specific GET/POST paths first so they aren't shadowed by "/" or "/:id".
router.get("/suggest-warnings", getStockEntrySuggestions);
// `protect` was missing here even though reportQuantityMismatch reads
// req.user?._id to attribute the notification — it was always undefined,
// and the action logged as "Anonymous".
router.post("/report-mismatch", protect, reportQuantityMismatch);

// IQC inspection — lines held in "IQC stock" / "rejected stock" once the tax
// invoice has arrived, and the endpoint used to fill out a checklist and
// resolve one of them (accept -> main stock, reject -> rejected stock).
// Open to every signed-in user (no receive.manage needed): IQC is done by
// whoever is asked to inspect the material, and the inspector is recorded.
router.get("/iqc-stock", protect, getIqcStockEntries);
router.post("/:id/iqc-report", protect, submitIqcReport);

router.get("/", getStockEntries);
// Every other mutating route in this file requires `protect` — this one
// didn't, so booking a stock entry was always logged as "Anonymous".
router.post("/", protect, createStockEntry);
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