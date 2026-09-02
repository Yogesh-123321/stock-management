import mongoose from "mongoose";

const buyerSchema = new mongoose.Schema(
  {
    buyerRegistrationNo: { type: String, unique: true, sparse: true, trim: true },
    companyName: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true },
    contactPersonName: { type: String, trim: true },
    contactDesignation: { type: String, trim: true },
    natureOfCompany: {
      type: String,
      enum: ["Manufacturer", "Supplier", "Service Provider", "Distributor", "Other"],
      default: "Distributor",
    },
    // Same field set as the TISPL / PLC registration form used for vendors
    natureOfBusiness: { type: String, trim: true },
    taxRegistrationNo: { type: String, trim: true }, // GSTIN / Sales Tax reg. no. / PAN
    bankDetails: { type: String, trim: true },
    principleCustomers: { type: String, trim: true },
    exciseRegistrationNo: { type: String, trim: true },
    signatoryName: { type: String, trim: true },
    signatoryDesignation: { type: String, trim: true },

    // MSME declaration
    isMsme: { type: Boolean, default: false },
    msmeNumber: { type: String, trim: true },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    approvedBy: { type: String, trim: true },
    approvalComment: { type: String, trim: true },

    // Supporting documents — all optional
    registrationDocumentUrl: { type: String },
    gstDocumentUrl: { type: String },
    panDocumentUrl: { type: String },
    bankRecordDocumentUrl: { type: String },
    msmeDocumentUrl: { type: String },

    remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

buyerSchema.index({ companyName: "text" });

export default mongoose.model("Buyer", buyerSchema);
