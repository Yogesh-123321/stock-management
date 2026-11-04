import ActivityLog from "../models/ActivityLog.js";
import User from "../models/User.js";
import { safeMeta, clientIp } from "../utils/activityLog.js";
import { resolveRequestUser } from "./auth.js";

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

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** Keys a controller may wrap the saved record in: { po }, { invoice }, { issue } ... */
const WRAPPER_KEYS = [
  "po", "pi", "purchaseOrder", "proformaInvoice", "invoice", "taxInvoice", "part",
  "vendor", "buyer", "issue", "kitIssue", "kit", "entry", "stockEntry", "session",
  "approval", "request", "data", "result", "document",
];

/** Fields on a saved record that read as a human reference (PO no, part no, ...). */
const LABEL_KEYS = [
  "voucherNo", "invoiceNo", "invoiceNumber", "billNo", "documentNumber",
  "ttUniquePartNumber", "companyName", "issueCode", "kitName", "kitCode", "title", "name",
];

const asId = (v) => {
  if (!v) return null;
  const s = typeof v === "object" && v._id ? String(v._id) : String(v);
  return OBJECT_ID.test(s) ? s : null;
};

/** First 24-hex segment of the URL, e.g. /api/billing/65f.../pay -> 65f... */
const idFromPath = (url = "") =>
  String(url).split("?")[0].split("/").find((seg) => OBJECT_ID.test(seg)) || null;

/** The record the controller sent back (or the one wrapped inside the reply). */
function pickDoc(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (body._id) return body;
  for (const key of WRAPPER_KEYS) {
    const child = body[key];
    if (child && typeof child === "object" && !Array.isArray(child) && child._id) return child;
  }
  return null;
}

const labelFromDoc = (doc) => {
  if (!doc) return "";
  for (const key of LABEL_KEYS) {
    if (typeof doc[key] === "string" && doc[key].trim()) return doc[key].trim();
  }
  return "";
};

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
  "payment-bills": "payment",
  billing: "payment",
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
  payment: "purchase invoice",
  user: "user",
  auth: "session",
  other: "record",
};

// "reject" + "d" used to give "rejectd" — spell the past tense out properly.
const PAST_TENSE = {
  approve: "approved",
  reject: "rejected",
  consume: "consumed",
  close: "closed",
  activate: "activated",
  deactivate: "deactivated",
  copy: "copied",
  issue: "issued",
  edit: "edited",
  revert: "reverted stock of",
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
    "revert",
  ];
  if (tail === "pay") return `marked the ${LABEL[entityType]} as paid`;
  if (tail === "resubmit") return `resubmitted the ${LABEL[entityType]}`;
  if (actionish.includes(tail)) return `${PAST_TENSE[tail]} the ${LABEL[entityType]}`;
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
    "revert",
    "pay",
    "resubmit",
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

    // Remember what the controller replied with. That reply is the record the
    // action produced or changed, so it gives us the id of a record that was
    // JUST created (the URL of a POST has no id) — which is what lets the
    // activity log open the matching document.
    let responseBody;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };

    res.on("finish", async () => {
      // Snapshot the body here, once the request has fully run its course —
      // not before `next()`. Taking it earlier missed every multipart/
      // form-data request (vendor/buyer docs, kit & stock imports, IQC
      // templates, ...), because those bodies are only populated by multer
      // further down the chain, well after this middleware first runs.
      const bodySnapshot = safeMeta(req.body || {});
      let entityType = ENTITY_BY_SEGMENT[segment] || "other";
      const responseDoc = pickDoc(responseBody);

      // An approval decision is really about the PO / PI / vendor / buyer being
      // approved — log it against THAT document so it can be opened from the log.
      const approvalDoc =
        segment === "approvals" &&
        responseDoc &&
        ["po", "pi", "vendor", "buyer"].includes(responseDoc.entityType) &&
        asId(responseDoc.entityId)
          ? responseDoc
          : null;
      if (approvalDoc) entityType = approvalDoc.entityType;

      const entityId = approvalDoc
        ? asId(approvalDoc.entityId)
        : asId(responseDoc?._id) || asId(req.params?.id) || idFromPath(req.originalUrl);

      const entityLabel = String(
        approvalDoc?.title ||
          bodySnapshot?.voucherNo ||
          bodySnapshot?.invoiceNo ||
          bodySnapshot?.billNo ||
          bodySnapshot?.ttUniquePartNumber ||
          bodySnapshot?.companyName ||
          bodySnapshot?.kitName ||
          bodySnapshot?.kitCode ||
          bodySnapshot?.name ||
          labelFromDoc(responseDoc) ||
          ""
      ).slice(0, 120);

      // Who did it: the user a route already attached, else whoever the bearer
      // token names (covers routes that don't use `protect`), else — for a
      // sign-in — the account the username belongs to.
      let user = await resolveRequestUser(req);
      if (!user && segment === "auth" && req.body?.username) {
        try {
          user = await User.findOne({ username: String(req.body.username).trim().toLowerCase() });
        } catch {
          /* leave unattributed */
        }
      }
      const success = res.statusCode < 400;

      ActivityLog.create({
        user: user?._id || null,
        userName: user?.name || user?.username || "Unknown (not signed in)",
        userRole: user?.role || "",
        action: isDownload ? `${segment}.download` : actionKey(req, segment),
        description: `${user?.name || user?.username || "A visitor who was not signed in"} ${
          isDownload ? `downloaded a ${LABEL[entityType]}` : describe(req, segment, entityType)
        }${entityLabel && segment !== "auth" ? ` (${entityLabel})` : ""}${success ? "" : " — failed"}`,
        entityType,
        entityId,
        entityLabel,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        success,
        ip: clientIp(req),
        userAgent: (req.headers["user-agent"] || "").slice(0, 250),
        meta: MUTATING.includes(req.method)
          ? {
              ...bodySnapshot,
              // Which document an approval was about (the log page opens it).
              ...(approvalDoc
                ? { _docRef: { kind: approvalDoc.entityType, id: asId(approvalDoc.entityId) } }
                : {}),
            }
          : {},
      }).catch((err) => console.error("activity log failed:", err.message));
    });

    next();
  };
}

export default activityLogger;