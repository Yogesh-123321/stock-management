import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { effectivePermissions } from "../config/permissions.js";

const SECRET = () => process.env.JWT_SECRET || "tispl-dev-secret-change-me";

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, SECRET(), { expiresIn: "12h" });
}

/** Requires a valid bearer token; attaches req.user (a live User document). */
export async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Please sign in to continue" });

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET());
    } catch {
      return res.status(401).json({ message: "Session expired — please sign in again" });
    }

    const user = await User.findById(decoded.sub);
    if (!user) return res.status(401).json({ message: "Account no longer exists" });
    if (!user.isActive)
      return res.status(403).json({ message: "This account has been deactivated" });

    req.user = user;
    req.permissions = effectivePermissions(user);
    next();
  } catch (err) {
    res.status(500).json({ message: err.message || "Authentication failed" });
  }
}

/** Optional auth — used by endpoints that behave differently when signed in. */
export async function attachUser(req, _res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return next();
  try {
    const decoded = jwt.verify(header.slice(7), SECRET());
    const user = await User.findById(decoded.sub);
    if (user && user.isActive) {
      req.user = user;
      req.permissions = effectivePermissions(user);
    }
  } catch {
    /* ignore — treated as anonymous */
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Please sign in to continue" });
  if (req.user.role !== "admin")
    return res.status(403).json({ message: "Only an admin can do this" });
  next();
}

/** requirePermission("po.create") — admins always pass. */
export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Please sign in to continue" });
    const held = req.permissions || effectivePermissions(req.user);
    const ok = permissions.some((p) => held.includes(p));
    if (!ok)
      return res
        .status(403)
        .json({ message: "You do not have permission for this action. Ask an admin to enable it." });
    next();
  };
}
