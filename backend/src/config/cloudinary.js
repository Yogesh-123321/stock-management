import { v2 as cloudinary } from "cloudinary";

/**
 * Cloudinary is configured from environment variables:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   CLOUDINARY_FOLDER   (optional, defaults to "inventory-platform")
 *
 * Folder structure created on Cloudinary:
 *
 *   inventory-platform/
 *     vendors/
 *       acme-industries-06AABCU9603R1ZX/
 *         registration/
 *         gst/
 *         pan/
 *         bank/
 *         msme/
 *         purchase-orders/
 *         proforma-invoices/
 *         tax-invoices/
 *     buyers/
 *       bharat-motors-27AAACB2894G1ZT/
 *         registration/ ...
 *     misc/
 *       parts/
 *         photos/
 *         datasheets/
 */
const isConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_URL ||
      (process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET)
  );

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
} else {
  // Falls back to the CLOUDINARY_URL connection string when present.
  cloudinary.config({ secure: true });
}

const ROOT_FOLDER = process.env.CLOUDINARY_FOLDER || "inventory-platform";

const sanitize = (name = "file") =>
  String(name)
    .replace(/\.[^./\\]+$/, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";

const slug = (value, fallback = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;

/**
 * Builds the stable per-party folder segment, e.g.
 *   vendors/acme-industries-06aabcu9603r1zx
 * The GSTIN (or, when missing, the mongo id) keeps two vendors with the same
 * trading name in separate folders, and keeps the folder stable across renames
 * only when the GSTIN is present — which is the identifier the business uses.
 */
export const partyFolder = (party = {}, kind = "vendor") => {
  const bucket = kind === "buyer" ? "buyers" : "vendors";
  const name = slug(party.companyName || party.name, "unnamed");
  const idPart = slug(party.taxRegistrationNo || party.gstin || party._id || party.id);
  return `${bucket}/${idPart ? `${name}-${idPart}` : name}`;
};

// PDFs are uploaded as `image` so Cloudinary serves them inline with
// Content-Type: application/pdf instead of forcing a download.
const isPreviewable = (mimetype = "") =>
  mimetype.startsWith("image/") || mimetype === "application/pdf";

/**
 * Uploads a multer (memoryStorage) file to Cloudinary.
 *
 * Accepts either the legacy string subfolder:
 *     uploadFileToCloudinary(file, "vendor-docs")
 * or an options object for vendor-wise foldering:
 *     uploadFileToCloudinary(file, {
 *       party: vendorDoc,          // any object with companyName / taxRegistrationNo / _id
 *       kind: "vendor",            // "vendor" | "buyer"
 *       category: "gst",           // sub-folder inside the party folder
 *     })
 *
 * Returns the permanent https URL stored on the document record.
 */
export const uploadFileToCloudinary = (file, options = "misc") =>
  new Promise((resolve, reject) => {
    if (!file) return resolve(undefined);
    if (!file.buffer) {
      return reject(
        new Error("Upload middleware must use memoryStorage for Cloudinary uploads")
      );
    }
    if (!isConfigured()) {
      return reject(
        new Error(
          "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET."
        )
      );
    }

    let subfolder;
    if (typeof options === "string") {
      subfolder = options || "misc";
    } else {
      const { party, kind = "vendor", category = "documents" } = options || {};
      subfolder = party
        ? `${partyFolder(party, kind)}/${slug(category, "documents")}`
        : `misc/${slug(category, "documents")}`;
    }

    const folder = `${ROOT_FOLDER}/${subfolder}`;

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: isPreviewable(file.mimetype || "") ? "image" : "raw",
        public_id: `${Date.now()}-${sanitize(file.originalname)}`,
        use_filename: false,
        unique_filename: false,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );

    stream.end(file.buffer);
  });

export default cloudinary;