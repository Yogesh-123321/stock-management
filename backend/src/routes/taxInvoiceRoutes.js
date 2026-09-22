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
import { protect } from "../middleware/auth.js";

const router = express.Router();

// Every one of these is only ever called from inside the logged-in app
// (see /documents, /receive in App.jsx) — `protect` was missing here, so
// req.user was never set and every PO upload/status change was recorded
// as "Anonymous" in the activity log.
router.use(protect);

router.get("/", getPurchaseOrders);
// Static path before /:id so it isn't swallowed by the id route
router.get("/open", getOpenDocuments);
router.get("/:id", getPurchaseOrderById);
router.post("/", uploadPODoc.single("document"), uploadPurchaseOrder);
router.patch("/:id/status", updatePOStatus);
router.patch("/:id/lifecycle", updatePOLifecycle);
router.patch("/:id/quantity", updatePOQuantity);

export default router;