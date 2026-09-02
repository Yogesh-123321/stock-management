import express from "express";
import {
  getBuyers,
  checkBuyerRegistered,
  getBuyerById,
  downloadBuyerForm,
  registerBuyer,
  updateBuyer,
  approveBuyer,
  rejectBuyer,
} from "../controllers/buyerController.js";
import { uploadBuyerDoc } from "../middleware/upload.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

// Signed-in only — the notifications need to know who did what.
router.use(protect);

// All supporting documents are optional.
const buyerDocFields = uploadBuyerDoc.fields([
  { name: "registrationDocument", maxCount: 1 },
  { name: "gstDocument", maxCount: 1 },
  { name: "panDocument", maxCount: 1 },
  { name: "bankRecordDocument", maxCount: 1 },
  { name: "msmeDocument", maxCount: 1 },
]);

/** The approver is always taken from the token, never from the body. */
function stampApprover(req, _res, next) {
  req.body = req.body || {};
  req.body.approvedBy = req.user?.name || req.user?.username || "Admin";
  next();
}

router.get("/", getBuyers);
router.get("/check", checkBuyerRegistered);
router.get("/:id/form", downloadBuyerForm);
router.get("/:id", getBuyerById);

router.post("/", requirePermission("buyer.create"), buyerDocFields, registerBuyer);
router.put("/:id", requirePermission("buyer.create"), buyerDocFields, updateBuyer);

// buyer.approve is adminOnly in config/permissions.js — users can never hold it.
router.patch("/:id/approve", requirePermission("buyer.approve"), stampApprover, approveBuyer);
router.patch("/:id/reject", requirePermission("buyer.approve"), stampApprover, rejectBuyer);
// Buyers cannot be deleted.

export default router;
