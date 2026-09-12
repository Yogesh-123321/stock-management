import express from "express";
import {
  getPartCategories,
  createPartCategory,
  updatePartCategory,
  deletePartCategory,
} from "../controllers/partCategoryController.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

// Read is open the same way /api/parts is — anyone using the "new part"
// forms needs the list to populate the category dropdown.
router.get("/", getPartCategories);

// Adding / removing a category is the admin utility — part.approve is
// flagged adminOnly in permissions.js, same right that already gates
// editing/deleting the parts master.
router.post("/", protect, requirePermission("part.approve"), createPartCategory);
router.patch("/:id", protect, requirePermission("part.approve"), updatePartCategory);
router.delete("/:id", protect, requirePermission("part.approve"), deletePartCategory);

export default router;