import express from "express";
import { getStockEntries, createStockEntry } from "../controllers/stockController.js";

const router = express.Router();

router.get("/", getStockEntries);
router.post("/", createStockEntry);

export default router;
