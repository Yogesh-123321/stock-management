import express from "express";
import { listInvoices, pendingCount, markPaid } from "../controllers/billingController.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Sidebar badge — open to any signed-in user, answers 0 if they have no access.
router.get("/pending-count", pendingCount);

// Everything else is for admins and people who were given the billing right.
// There is deliberately NO upload route: invoices come from stock entry.
router.use(requirePermission("payment.pay"));
router.get("/", listInvoices);
router.patch("/:id/pay", markPaid);

export default router;