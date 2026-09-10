import multer from "multer";
import path from "path";

/**
 * Files are no longer written to the local `uploads/` folder — they are kept
 * in memory just long enough to be streamed up to Cloudinary by
 * `uploadFileToCloudinary()` inside the controllers.
 */
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".xlsx", ".xls"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error("Unsupported file type: " + ext));
};

const makeUploader = () =>
  multer({ storage, fileFilter, limits: { fileSize: 15 * 1024 * 1024 } });

export const uploadVendorDoc = makeUploader();

// Buyer registration documents (GST / PAN / bank record / MSME / other)
export const uploadBuyerDoc = makeUploader();

export const uploadPODoc = makeUploader();

export const uploadTaxInvoiceDoc = makeUploader();

// Vendor "inward stock" workbooks (e.g. the KKTRON sheet) used by the
// Stock Entry -> "Import from vendor sheet" utility. Kept in memory only
// long enough to be parsed — never written to disk or Cloudinary.
export const uploadStockSheet = makeUploader();
