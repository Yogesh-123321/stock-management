import express from "express";
import { extractDocument } from "../controllers/aiExtractController.js";
import { uploadForAiExtract } from "../middleware/upload.js";
import { protect } from "../middleware/auth.js";
import { getAiUsage } from "../utils/aiQuota.js";
import { GEMINI_MODELS, OPENROUTER_MODELS, isGeminiConfigured, isOpenRouterConfigured } from "../config/aiConfig.js";

const router = express.Router();

// POST /api/ai/extract-document (multipart, field name "file")
router.post("/extract-document", uploadForAiExtract.single("file"), extractDocument);

// GET /api/ai/usage — which free AI sources are configured, how many requests
// each handled today, and which are currently paused (limit hit) and until
// when. In-memory, so it resets when the server restarts.
router.get("/usage", protect, (req, res) => {
  res.json({
    configured: {
      gemini: isGeminiConfigured() ? GEMINI_MODELS : false,
      openrouter: isOpenRouterConfigured() ? OPENROUTER_MODELS : false,
    },
    ...getAiUsage(),
  });
});

export default router;