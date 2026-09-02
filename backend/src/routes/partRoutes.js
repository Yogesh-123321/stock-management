import express from "express";
import {
  getParts,
  lookupPart,
  getPartById,
  createPart,
  adjustPartStock,
} from "../controllers/partController.js";

const router = express.Router();

router.get("/", getParts);
router.get("/lookup", lookupPart);
router.get("/:id", getPartById);
router.post("/", createPart);
router.patch("/:id/stock", adjustPartStock);

export default router;
