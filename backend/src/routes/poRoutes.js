import express from "express";
import {
  getPurchaseOrders,
  getOpenDocuments,
  getPurchaseOrderById,
  uploadPurchaseOrder,
  updatePOStatus,
  updatePOLifecycle,
  updatePOQuantity,
} from "../controllers/poController.js";
import { uploadPODoc } from "../middleware/upload.js";

const router = express.Router();

router.get("/", getPurchaseOrders);
// Static path before /:id so it isn't swallowed by the id route
router.get("/open", getOpenDocuments);
router.get("/:id", getPurchaseOrderById);
router.post("/", uploadPODoc.single("document"), uploadPurchaseOrder);
router.patch("/:id/status", updatePOStatus);
router.patch("/:id/lifecycle", updatePOLifecycle);
router.patch("/:id/quantity", updatePOQuantity);

export default router;
