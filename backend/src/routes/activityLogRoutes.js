import express from "express";
import { protect, requirePermission } from "../middleware/auth.js";
import {
  listLogs,
  logFilters,
  logSummary,
  exportLogs,
} from "../controllers/activityLogController.js";

const router = express.Router();

router.use(protect);

// `logs.view` is flagged adminOnly in permissions.js — only the central admin
// can ever hold it, so these endpoints are admin-only end to end.
router.get("/filters", requirePermission("logs.view"), logFilters);
router.get("/summary", requirePermission("logs.view"), logSummary);
router.get("/export", requirePermission("logs.view"), exportLogs);
router.get("/", requirePermission("logs.view"), listLogs);

export default router;
