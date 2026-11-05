import express from "express";
import {
  getTaxInvoices,
  getTaxInvoiceById,
  uploadTaxInvoice,
  getTaxInvoiceStockEntries,
  getTaxInvoiceLineMatch,
  checkTaxInvoiceDuplicate,
  deleteTaxInvoice,
} from "../controllers/taxInvoiceController.js";
import { uploadTaxInvoiceDoc } from "../middleware/upload.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

// Every tax-invoice route now needs a signed-in user. Without this, uploading an
// invoice was logged as "Anonymous" and the routes were open to anyone.
router.use(protect);

router.route("/")
  .get(getTaxInvoices)
  .post(uploadTaxInvoiceDoc.single("document"), uploadTaxInvoice);

// Must come before "/:id" so "check-duplicate" isn't swallowed as an :id.
router.get("/check-duplicate", checkTaxInvoiceDuplicate);

router.get("/:id/stock-entries", getTaxInvoiceStockEntries);
router.get("/:id/line-match", getTaxInvoiceLineMatch);

router.get("/:id", getTaxInvoiceById);

// Deleting an invoice also deletes the stock booked against it — ADMIN ONLY.
router.delete("/:id", requirePermission("part.approve"), deleteTaxInvoice);

export default router;