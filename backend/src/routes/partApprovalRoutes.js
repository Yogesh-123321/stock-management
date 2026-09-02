import express from "express";
import { protect, requirePermission } from "../middleware/auth.js";
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

// Anyone signed in can see their own requests; approvers see everything
// (filtering happens inside the controller).
router.get("/", listRequests);
router.get("/pending-count", pendingCount);

// Raising a request needs the "raise part request" right.
router.post("/", requirePermission("part.request"), createRequest);

// Deciding is ADMIN ONLY — part.approve is flagged adminOnly in permissions.js
router.patch("/:id/approve", requirePermission("part.approve"), approveRequest);
router.patch("/:id/reject", requirePermission("part.approve"), rejectRequest);

// Closing an approved request after the stock entry is booked.
router.patch("/:id/consume", requirePermission("receive.manage"), consumeRequest);

// Editing a request (pending / approved / rejected) — ADMIN ONLY.
// Declared last so it never shadows the /:id/<action> routes above.
router.patch("/:id", requirePermission("part.approve"), updateRequest);

export default router;
