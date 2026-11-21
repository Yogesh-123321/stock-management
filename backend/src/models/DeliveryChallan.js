// backend/src/models/DeliveryChallan.js
import mongoose from "mongoose";

/*
  A Delivery Challan issued by TISPL (returnable or non-returnable) for goods
  sent to a party — built from the "DELIVERY CHALLAN" template.
*/
const partySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    gstin: { type: String, trim: true, default: "" },
    stateName: { type: String, trim: true, default: "" },
    stateCode: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    hsnSac: { type: String, trim: true, default: "" },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, trim: true, default: "NOS" },
    rate: { type: Number, min: 0, default: 0 },
    amount: { type: Number, min: 0, default: 0 }, // quantity * rate, computed server-side
  },
  { _id: false }
);

const deliveryChallanSchema = new mongoose.Schema(
  {
    challanNo: { type: String, required: true, trim: true, unique: true },
    challanType: { type: String, enum: ["RETURNABLE", "NON-RETURNABLE"], default: "RETURNABLE" },
    challanDate: { type: Date, required: true },
    dateTimeOfIssue: { type: Date, default: Date.now },

    dispatchTo: { type: partySchema, default: () => ({}) },
    party: { type: partySchema, default: () => ({}) },

    referenceNoDate: { type: String, trim: true },
    buyersOrderNo: { type: String, trim: true },
    buyersOrderDate: { type: Date },
    dispatchDocNo: { type: String, trim: true },
    dispatchedThrough: { type: String, trim: true },
    destination: { type: String, trim: true },
    motorVehicleNo: { type: String, trim: true },
    modeTermsOfPayment: { type: String, trim: true },
    otherReferences: { type: String, trim: true },
    durationOfProcess: { type: String, trim: true },
    natureOfProcessing: { type: String, trim: true },

    items: { type: [itemSchema], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },

    taxType: { type: String, enum: ["IGST", "CGST_SGST", "NONE"], default: "IGST" },
    taxRate: { type: Number, default: 18, min: 0, max: 100 },

    subTotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    amountInWords: { type: String, required: true },
    taxAmountInWords: { type: String, default: "" },

    // "open" = goods still out with the party; "closed" = returned / settled.
    status: { type: String, enum: ["open", "closed"], default: "open" },
    closedAt: { type: Date, default: null },
    createdByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("DeliveryChallan", deliveryChallanSchema);