import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {
    vendorRegistrationNo: { type: String, unique: true, sparse: true, trim: true },
    companyName: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true },
    contactPersonName: { type: String, trim: true },
    contactDesignation: { type: String, trim: true },
    natureOfCompany: {
      type: String,
      enum: ["Manufacturer", "Supplier", "Service Provider", "Distributor", "Other"],
      default: "Supplier",
    },
    // Additional fields matching the TISPL / PLC vendor registration form
    natureOfBusiness: { type: String, trim: true }, // e.g. Supplier, Manufacturing, Service Provider
    taxRegistrationNo: { type: String, trim: true }, // GSTIN / Sales Tax reg. no. / PAN
    bankDetails: { type: String, trim: true }, // bank name, branch, A/C no., IFSC
    principleCustomers: { type: String, trim: true },
    exciseRegistrationNo: { type: String, trim: true },
    signatoryName: { type: String, trim: true },
    signatoryDesignation: { type: String, trim: true },

    // MSME declaration
    isMsme: { type: Boolean, default: false },
    msmeNumber: { type: String, trim: true }, // Udyam / MSME registration no. (optional)

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    // Vendors are never deleted — they are marked inactive instead.
    activeStatus: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    inactiveReason: { type: String, trim: true },
    inactiveAt: { type: Date },

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

vendorSchema.index({ companyName: "text" });

export default mongoose.model("Vendor", vendorSchema);
