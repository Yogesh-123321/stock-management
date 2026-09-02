import ActivityLog from "../models/ActivityLog.js";

/** Fields that must never end up in the log. */
const REDACTED = [
  "password",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "token",
  "authorization",
  "otp",
];

/** Shallow-clean + truncate a payload so the log stays small and PII-safe. */
export function safeMeta(input, depth = 0) {
  if (input == null) return input;
  if (Array.isArray(input)) {
    if (depth > 1) return `[${input.length} items]`;
    return input.slice(0, 10).map((v) => safeMeta(v, depth + 1));
  }
  if (typeof input === "object") {
    if (depth > 2) return "[object]";
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (REDACTED.includes(k)) {
        out[k] = "***";
        continue;
      }
      if (typeof v === "string" && v.length > 300) {
        out[k] = `${v.slice(0, 300)}…`;
        continue;
      }
      // Skip base64 / file blobs entirely.
      if (typeof v === "string" && v.startsWith("data:")) {
        out[k] = "[file]";
        continue;
      }
      out[k] = safeMeta(v, depth + 1);
    }
    return out;
  }
  if (typeof input === "string" && input.length > 300) return `${input.slice(0, 300)}…`;
  return input;
}

/**
 * Record an activity. Never throws — logging must not break a business action.
 *
 * await logActivity(req, {
 *   action: "po.approve",
 *   description: `Approved PO ${po.voucherNo}`,
 *   entityType: "po", entityId: po._id, entityLabel: po.voucherNo,
 * });
 */
export async function logActivity(req, entry = {}) {
  try {
    const user = req?.user || null;
    await ActivityLog.create({
      user: user?._id || null,
      userName: user?.name || user?.username || entry.userName || "System",
      userRole: user?.role || entry.userRole || "",
      action: entry.action || "unknown",
      description: entry.description || "",
      entityType: entry.entityType || "other",
      entityId: entry.entityId || null,
      entityLabel: entry.entityLabel || "",
      method: entry.method || req?.method || "",
      path: entry.path || req?.originalUrl || "",
      statusCode: entry.statusCode ?? null,
      durationMs: entry.durationMs ?? null,
      success: entry.success !== false,
      ip: entry.ip || clientIp(req),
      userAgent: (req?.headers?.["user-agent"] || "").slice(0, 250),
      meta: safeMeta(entry.meta || {}),
    });
  } catch (err) {
    console.error("activity log failed:", err.message);
  }
}

export function clientIp(req) {
  if (!req) return "";
  const fwd = req.headers?.["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "";
}
