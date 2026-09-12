import express from "express";
import {
  getTaxInvoices,
  getTaxInvoiceById,
  uploadTaxInvoice,
  getTaxInvoiceStockEntries,
  getTaxInvoiceLineMatch,
} from "../controllers/taxInvoiceController.js";
import { uploadTaxInvoiceDoc } from "../middleware/upload.js";

const router = express.Router();

router.route("/")
  .get(getTaxInvoices)
  .post(uploadTaxInvoiceDoc.single("document"), uploadTaxInvoice);

router.get("/:id/stock-entries", getTaxInvoiceStockEntries);
router.get("/:id/line-match", getTaxInvoiceLineMatch);

router.get("/:id", getTaxInvoiceById);

export default router;