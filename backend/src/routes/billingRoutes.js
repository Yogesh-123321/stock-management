import express from "express";
import { listInvoices, pendingCount, markPaid, updatePayment, deletePayment, getReport, exportReport, exportFullReport, retryAmountBackfill } from "../controllers/billingController.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Sidebar badge — open to any signed-in user, answers 0 if they have no access.
router.get("/pending-count", pendingCount);

// Everything else is for admins and people who were given the billing right.
// There is deliberately NO upload route: invoices come from stock entry.
router.use(requirePermission("payment.pay"));
router.get("/", listInvoices);
router.get("/report", getReport);
router.get("/report/export", exportReport);
router.get("/report/full-export", exportFullReport);
router.post("/backfill-amounts", retryAmountBackfill);
router.patch("/:id/pay", markPaid);
router.patch("/:id/payment", updatePayment);
router.delete("/:id/payment", deletePayment);

export default router;