import mongoose from "mongoose";

const purchaseOrderSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    documentType: { type: String, enum: ["Purchase Order", "Proforma Invoice"], required: true },
    // Set when this receiving document was created by the PO Generator.
    generatedSource: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseOrderGen",
      unique: true,
      sparse: true,
    },
    documentNumber: { type: String, trim: true },
    documentUrl: { type: String, required: true },
    originalFileName: { type: String },
    receivedDate: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["uploaded", "stock_entry_in_progress", "completed"],
      default: "uploaded",
    },

    // Total quantity of material this document covers (sum of all its line
    // items). Used to reconcile PO vs PI vs the quantity actually entered in
    // stock: a mismatch raises a warning during receiving, and a match lets
    // the tax invoice step close the document automatically.
    // null = not captured (older documents), so no reconciliation is done.
    totalQuantity: { type: Number, default: null },

    // Business lifecycle of the document itself, independent of where the
    // receiving flow has got to: an "open" PO/PI is still live (material or
    // invoicing pending) and is what shows up in the "open PO/PI" dropdowns;
    // "closed" is settled and hidden from those pickers by default.
    lifecycleStatus: { type: String, enum: ["open", "closed"], default: "open" },
    closedAt: { type: Date, default: null },
    closedReason: { type: String, trim: true, default: "" },

    notes: { type: String, trim: true },

    // A single delivery can now come with both a PO and a Proforma Invoice
    // (each uploaded on its own step, either one skippable). When both are
    // present for the same delivery, they're cross-linked here so their
    // status stays in sync and stock entry / tax invoice only need to be
    // tied to one "primary" document.
    linkedDocument: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("PurchaseOrder", purchaseOrderSchema);
