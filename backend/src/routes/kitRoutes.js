import express from "express";
import {
  getKitTemplates,
  getKitTemplateById,
  createKitTemplate,
  updateKitTemplate,
  deleteKitTemplate,
  parseKitImport,
  getIssuesForTemplate,
  getKitIssues,
  getKitIssueById,
  issueKit,
  deleteKitIssueLine,
} from "../controllers/kitController.js";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadKitSheet } from "../middleware/upload.js";

const router = express.Router();

// Declared before "/:id" so they're never swallowed by the id route.
router.get("/issues", getKitIssues);
router.get("/issues/:id", getKitIssueById);
router.delete(
  "/issues/:issueId/lines/:lineId",
  protect,
  requirePermission("kit.issue", "kit.manage"),
  deleteKitIssueLine
);

// Reading templates / checking stock is open to anyone signed into the
// app, same as parts and stock entries — only creating/editing a template
// or issuing a kit needs a specific permission.
router.get("/", getKitTemplates);
router.get("/:id", getKitTemplateById);
router.get("/:id/issues", getIssuesForTemplate);

router.post("/", protect, requirePermission("kit.manage"), createKitTemplate);
router.patch("/:id", protect, requirePermission("kit.manage"), updateKitTemplate);
router.delete("/:id", protect, requirePermission("kit.manage"), deleteKitTemplate);

// Import a kit / BOM workbook. Parsing is read-only; the admin reviews and
// edits the rows client-side, then submits them to POST "/" like any other
// new template — there is no separate "commit" endpoint to keep in sync.
router.post(
  "/import/parse",
  protect,
  requirePermission("kit.manage"),
  uploadKitSheet.single("file"),
  parseKitImport
);

router.post("/:id/issue", protect, requirePermission("kit.issue"), issueKit);

export default router;