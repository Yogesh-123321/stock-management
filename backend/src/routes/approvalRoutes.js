import express from "express";
import {
  createApproval,
  listApprovals,
  pendingApprovalCount,
  approve,
  reject,
} from "../controllers/approvalController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

router.get("/", listApprovals);
router.get("/pending-count", pendingApprovalCount);
router.post("/", createApproval);
router.patch("/:id/approve", approve);
router.patch("/:id/reject", reject);

export default router;
