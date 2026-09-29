import express from "express";
import {
  createBill,
  listBills,
  pendingCount,
  approveBill,
  rejectBill,
  payBill,
  resubmitBill,
} from "../controllers/paymentBillController.js";
import { protect, requirePermission } from "../middleware/auth.js";
import { uploadPaymentBillDoc } from "../middleware/upload.js";

const router = express.Router();

// Everything here needs a signed-in user.
router.use(protect);

// Any signed-in user can open the list — the controller narrows it to their own
// uploads unless they are an admin or a cashier.
router.get("/", listBills);
router.get("/pending-count", pendingCount);

// Step 1 — upload the bill.
router.post("/", requirePermission("payment.submit"), uploadPaymentBillDoc.single("document"), createBill);

// Step 2 — admin decides (payment.approve is admin-only).
router.patch("/:id/approve", requirePermission("payment.approve"), approveBill);
router.patch("/:id/reject", requirePermission("payment.approve"), rejectBill);

// Step 3 — cashier pays and enters the transaction ID; the entry closes.
router.patch("/:id/pay", requirePermission("payment.pay"), payBill);

// Rejected? The uploader fixes it and sends it back.
router.patch(
  "/:id/resubmit",
  requirePermission("payment.submit"),
  uploadPaymentBillDoc.single("document"),
  resubmitBill
);

export default router;