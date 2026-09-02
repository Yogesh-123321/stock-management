import express from "express";
import {
  getTaxInvoices,
  getTaxInvoiceById,
  uploadTaxInvoice,
  getTaxInvoiceStockEntries,
} from "../controllers/taxInvoiceController.js";
import { uploadTaxInvoiceDoc } from "../middleware/upload.js";

const router = express.Router();

router.route("/")
  .get(getTaxInvoices)
  .post(uploadTaxInvoiceDoc.single("document"), uploadTaxInvoice);

router.get("/:id/stock-entries", getTaxInvoiceStockEntries);

router.get("/:id", getTaxInvoiceById);

export default router;
