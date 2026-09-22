import ActivityLog from "../models/ActivityLog.js";
import { safeMeta, clientIp } from "../utils/activityLog.js";

/**
 * Automatic audit trail.
 *
 * Mount ONCE, right after the body parser and before the API routes:
 *   app.use("/api", activityLogger());
 *
 * Every mutating request (POST / PUT / PATCH / DELETE) is written to the log
 * after the response is sent, so it never slows the request down. GETs are
 * skipped except for downloads, which are worth auditing.
 */

const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];

/** /api/<segment>/... -> entity + a readable verb. */
const ENTITY_BY_SEGMENT = {
  "po-generator": "po",
  "purchase-orders": "po",
  "pi-generator": "pi",
  "proforma-invoices": "pi",
  parts: "part",
  "part-approvals": "part",
  vendors: "vendor",
  buyers: "buyer",
  stock: "stock",
  "stock-entries": "stock",
  kits: "kit",
  receiving: "receiving",
  "receiving-sessions": "receiving",
  receive: "receiving",
  invoices: "invoice",
  "tax-invoices": "invoice",
  users: "user",
  auth: "auth",
  approvals: "other",
  notifications: "other",
};

const VERB = { POST: "created", PUT: "updated", PATCH: "updated", DELETE: "deleted" };

const LABEL = {
  po: "purchase order",
  pi: "proforma invoice",
  part: "part",
  vendor: "vendor",
  buyer: "buyer",
  stock: "stock entry",
  kit: "kit",
  receiving: "material receipt",
  invoice: "tax invoice",
  user: "user",
  auth: "session",
  other: "record",
};

function describe(req, segment, entityType) {
  const tail = req.path.split("/").filter(Boolean).pop() || "";
  const actionish = [
    "approve",
    "reject",
    "consume",
    "close",
    "activate",
    "deactivate",
    "copy",
    "issue",
    "edit",
  ];
  if (actionish.includes(tail)) return `${tail}d the ${LABEL[entityType]}`.replace("eed", "ed");
  if (segment === "auth" && tail === "login") return "signed in";
  if (segment === "auth" && tail === "logout") return "signed out";
  if (segment === "auth") return `changed account settings (${tail || "auth"})`;
  return `${VERB[req.method] || "changed"} a ${LABEL[entityType]}`;
}

function actionKey(req, segment) {
  const tail = req.path.split("/").filter(Boolean).pop() || "";
  const known = [
    "approve",
    "reject",
    "consume",
    "close",
    "copy",
    "login",
    "logout",
    "download",
    "issue",
    "edit",
  ];
  const suffix = known.includes(tail)
    ? tail
    : { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete", GET: "read" }[
        req.method
      ] || "action";
  return `${segment || "api"}.${suffix}`;
}

export function activityLogger(options = {}) {
  const skip = new Set([
    ...(options.skipSegments || []),
    "activity-logs",
    "notifications",
    "health",
  ]);

  return function activityLoggerMiddleware(req, res, next) {
    const startedAt = Date.now();
    const segment = (req.path.split("/").filter(Boolean)[0] || "").toLowerCase();
    const isDownload = req.method === "GET" && /\/(download|export)(\/|$)/.test(req.path);
    const shouldLog = (MUTATING.includes(req.method) || isDownload) && !skip.has(segment);

    if (!shouldLog) return next();

    res.on("finish", () => {
      // Snapshot the body here, once the request has fully run its course —
      // not before `next()`. Taking it earlier missed every multipart/
      // form-data request (vendor/buyer docs, kit & stock imports, IQC
      // templates, ...), because those bodies are only populated by multer
      // further down the chain, well after this middleware first runs.
      const bodySnapshot = safeMeta(req.body || {});
      const entityType = ENTITY_BY_SEGMENT[segment] || "other";
      const user = req.user || null;
      const success = res.statusCode < 400;

      ActivityLog.create({
        user: user?._id || null,
        userName: user?.name || user?.username || "Anonymous",
        userRole: user?.role || "",
        action: isDownload ? `${segment}.download` : actionKey(req, segment),
        description: `${user?.name || user?.username || "Someone"} ${
          isDownload ? `downloaded a ${LABEL[entityType]}` : describe(req, segment, entityType)
        }${success ? "" : " — failed"}`,
        entityType,
        entityId: /^[0-9a-fA-F]{24}$/.test(req.params?.id || "") ? req.params.id : null,
        entityLabel:
          bodySnapshot?.voucherNo ||
          bodySnapshot?.invoiceNo ||
          bodySnapshot?.ttUniquePartNumber ||
          bodySnapshot?.companyName ||
          bodySnapshot?.kitName ||
          bodySnapshot?.kitCode ||
          bodySnapshot?.name ||
          "",
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        success,
        ip: clientIp(req),
        userAgent: (req.headers["user-agent"] || "").slice(0, 250),
        meta: MUTATING.includes(req.method) ? bodySnapshot : {},
      }).catch((err) => console.error("activity log failed:", err.message));
    });

    next();
  };
}

export default activityLogger;