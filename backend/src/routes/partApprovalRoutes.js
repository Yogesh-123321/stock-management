import express from "express";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadPartDoc } from "../middleware/upload.js";
import {
  listRequests,
  pendingCount,
  createRequest,
  approveRequest,
  rejectRequest,
  consumeRequest,
  updateRequest,
} from "../controllers/partApprovalController.js";

const router = express.Router();

router.use(protect);

// A part's photo and datasheet are both optional, uploaded straight to
// Cloudinary when the request is raised (see createRequest).
const partDocFields = uploadPartDoc.fields([
  { name: "photo", maxCount: 1 },
  { name: "datasheet", maxCount: 1 },
]);

// Anyone signed in can see their own requests; approvers see everything
// (filtering happens inside the controller).
router.get("/", listRequests);
router.get("/pending-count", pendingCount);

// Raising a request needs the "raise part request" right.
router.post("/", requirePermission("part.request"), partDocFields, createRequest);

// Deciding is ADMIN ONLY — part.approve is flagged adminOnly in permissions.js
router.patch("/:id/approve", requirePermission("part.approve"), approveRequest);
router.patch("/:id/reject", requirePermission("part.approve"), rejectRequest);

// Closing an approved request after the stock entry is booked.
router.patch("/:id/consume", requirePermission("receive.manage"), consumeRequest);

// Editing a request (pending / approved / rejected) — ADMIN ONLY.
// Declared last so it never shadows the /:id/<action> routes above.
router.patch("/:id", requirePermission("part.approve"), updateRequest);

export default router;