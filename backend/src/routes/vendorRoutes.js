import express from "express";
import {
  getVendors,
  checkVendorRegistered,
  getVendorById,
  downloadVendorForm,
  registerVendor,
  updateVendor,
  approveVendor,
  rejectVendor,
  setVendorActiveStatus,
  getVendorItems,
} from "../controllers/vendorController.js";
import { uploadVendorDoc } from "../middleware/upload.js";

const router = express.Router();

// All supporting documents are optional.
const vendorDocFields = uploadVendorDoc.fields([
  { name: "registrationDocument", maxCount: 1 },
  { name: "gstDocument", maxCount: 1 },
  { name: "panDocument", maxCount: 1 },
  { name: "bankRecordDocument", maxCount: 1 },
  { name: "msmeDocument", maxCount: 1 },
]);

router.get("/", getVendors);
router.get("/check", checkVendorRegistered);
router.get("/:id/form", downloadVendorForm);
router.get("/:id/items", getVendorItems);
router.get("/:id", getVendorById);
router.post("/", vendorDocFields, registerVendor);
router.put("/:id", vendorDocFields, updateVendor);
router.patch("/:id/approve", approveVendor);
router.patch("/:id/reject", rejectVendor);
// Vendors are never deleted — they are activated / deactivated instead.
router.patch("/:id/active-status", setVendorActiveStatus);

export default router;
