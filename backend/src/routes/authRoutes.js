import express from "express";
import {
  login,
  me,
  changePassword,
  bootstrapAdmin,
  setupState,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.get("/setup-state", setupState);
router.post("/bootstrap", bootstrapAdmin);
router.post("/login", login);
router.get("/me", protect, me);
router.patch("/password", protect, changePassword);

export default router;
