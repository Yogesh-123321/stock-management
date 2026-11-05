import express from "express";
import {
  issueSamples,
  getSampleIssues,
  getSampleIssueById,
  getSampleStock,
  receiveSamplesBack,
} from "../controllers/sampleController.js";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadSampleDoc } from "../middleware/upload.js";

const router = express.Router();

// Everything here needs a signed-in user (issuer / receiver is recorded).
router.use(protect);

// Reading: open to every signed-in user, same as the issued-kits history.
// Declared before "/:id" so "/stock" is never read as an id.
router.get("/stock", getSampleStock);
router.get("/", getSampleIssues);
router.get("/:id", getSampleIssueById);

// Issuing samples / receiving them back needs the "sample.issue" right.
// The challan is mandatory when issuing; return documents are optional.
router.post("/", requirePermission("sample.issue"), uploadSampleDoc.array("challans", 10), issueSamples);
router.post(
  "/:id/return",
  requirePermission("sample.issue"),
  uploadSampleDoc.array("documents", 10),
  receiveSamplesBack
);

export default router;