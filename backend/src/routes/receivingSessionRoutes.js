import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getReceivingSessions,
  getReceivingSessionById,
  createReceivingSession,
  updateReceivingSession,
  deleteReceivingSession,
} from "../controllers/receivingSessionController.js";

const router = express.Router();

router.use(protect);   // ← sets req.user for every route below

router.get("/", getReceivingSessions);
router.get("/:id", getReceivingSessionById);
router.post("/", createReceivingSession);
router.put("/:id", updateReceivingSession);
router.delete("/:id", deleteReceivingSession);

export default router;
