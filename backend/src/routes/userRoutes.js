import express from "express";
import {
  listUsers,
  createUser,
  updateUser,
  resetPassword,
} from "../controllers/userController.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

router.use(protect, requirePermission("users.manage"));

router.get("/", listUsers);
router.post("/", createUser);
router.patch("/:id", updateUser);
router.patch("/:id/password", resetPassword);

export default router;
