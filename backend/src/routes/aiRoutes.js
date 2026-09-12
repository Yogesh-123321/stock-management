import express from "express";
import { extractDocument } from "../controllers/aiExtractController.js";
import { uploadForAiExtract } from "../middleware/upload.js";

const router = express.Router();

// POST /api/ai/extract-document (multipart, field name "file")
router.post("/extract-document", uploadForAiExtract.single("file"), extractDocument);

export default router;