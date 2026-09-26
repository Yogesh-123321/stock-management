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
  exportKitIssueById,
  getKitIssueById,
  issueKit,
  editKitIssue,
  getKitIssueChainTotals,
  deleteKitIssueLine,
  saveKitDraft,
  updateKitDraft,
  getKitDrafts,
  getKitDraftById,
  deleteKitDraft,
  issueKitDraft,
} from "../controllers/kitController.js";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadKitSheet } from "../middleware/upload.js";

const router = express.Router();

// Declared before "/:id" so they're never swallowed by the id route.
router.get("/issues", getKitIssues);
// Excel download of ONE issued kit (who it went to, who issued it, every
// material) — a per-kit slip, never a dump of all kits.
router.get("/issues/:id/export", protect, exportKitIssueById);
// Cumulative per-part totals across every earlier version of this kit's
// edit chain — see getKitIssueChainTotals. Declared before "/issues/:id"
// for the same reason as "/export" above.
router.get("/issues/:id/previous-quantities", getKitIssueChainTotals);
router.get("/issues/:id", getKitIssueById);
// Never touches the original entry — always creates a new KitIssue in
// that entry's edit series (see editKitIssue). Same permission as issuing
// a kit in the first place.
router.post(
  "/issues/:issueId/edit",
  protect,
  requirePermission("kit.issue", "kit.manage"),
  editKitIssue
);
router.delete(
  "/issues/:issueId/lines/:lineId",
  protect,
  requirePermission("kit.issue", "kit.manage"),
  deleteKitIssueLine
);

// Saved (draft) kit issues — declared before "/:id" for the same reason
// as "/issues" above. Saving/updating/issuing a draft needs the same
// permission as issuing a kit directly; reading the list is open to
// anyone signed in, same as the issued-kits history.
router.get("/drafts", getKitDrafts);
router.get("/drafts/:draftId", getKitDraftById);
router.post("/:id/draft", protect, requirePermission("kit.issue"), saveKitDraft);
router.patch(
  "/drafts/:draftId",
  protect,
  requirePermission("kit.issue", "kit.manage"),
  updateKitDraft
);
router.delete(
  "/drafts/:draftId",
  protect,
  requirePermission("kit.issue", "kit.manage"),
  deleteKitDraft
);
router.post("/drafts/:draftId/issue", protect, requirePermission("kit.issue"), issueKitDraft);

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