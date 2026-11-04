import express from "express";
import {
  listUsers,
  createUser,
  updateUser,
  resetPassword,
} from "../controllers/userController.js";
import { insightsOverview, userInsights } from "../controllers/userInsightsController.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

router.use(protect, requirePermission("users.manage"));

router.get("/", listUsers);
// Usage dashboard — keep these ABOVE any "/:id" route so "insights" is never read as an id.
router.get("/insights/overview", insightsOverview);
router.get("/insights/:id", userInsights);
router.post("/", createUser);
router.patch("/:id", updateUser);
router.patch("/:id/password", resetPassword);

export default router;