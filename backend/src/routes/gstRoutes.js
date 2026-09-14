import express from "express";
import { verifyGstin } from "../controllers/gstController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// Signed-in only, same as vendor/buyer registration itself.
router.use(protect);

// GET /api/gst/verify/:gstin
router.get("/verify/:gstin", verifyGstin);

export default router;