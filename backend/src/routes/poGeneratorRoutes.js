import express from "express";
import {
  listPurchaseOrdersGen,
  getPurchaseOrderGen,
  getNextVoucherNo,
  searchParties,
  createPurchaseOrderGen,
  copyPurchaseOrderGen,
  setPurchaseOrderGenStatus,
  downloadPurchaseOrderGen,
} from "../controllers/poGeneratorController.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

// Everything here needs a signed-in user; creating needs the po.create right.
router.use(protect);

router.get("/next-no", getNextVoucherNo);
router.get("/parties", searchParties);
router.get("/", listPurchaseOrdersGen);
router.get("/:id/copy", copyPurchaseOrderGen);
router.get("/:id/download", downloadPurchaseOrderGen);
router.post("/", requirePermission("po.create"), createPurchaseOrderGen);
router.patch("/:id/status", setPurchaseOrderGenStatus);
router.get("/:id", getPurchaseOrderGen);

export default router;
