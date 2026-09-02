import User from "../models/User.js";
import { signToken } from "../middleware/auth.js";
import {
  effectivePermissions,
  DEFAULT_PERMISSIONS,
  PERMISSIONS,
} from "../config/permissions.js";

function shape(user) {
  return {
    _id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    permissions: effectivePermissions(user),
  };
}

/**
 * POST /api/auth/bootstrap  { name, username, password }
 * Only works while the database has zero users — creates the central admin.
 */
export const bootstrapAdmin = async (req, res) => {
  try {
    const count = await User.countDocuments();
    if (count > 0)
      return res.status(403).json({ message: "Setup already completed — please sign in" });

    const { name, username, password, email = "" } = req.body || {};
    if (!name || !username || !password)
      return res.status(400).json({ message: "Name, username and password are required" });

    const admin = new User({
      name,
      username,
      email,
      role: "admin",
      permissions: [...DEFAULT_PERMISSIONS.admin],
    });
    await admin.setPassword(password);
    await admin.save();

    res.status(201).json({ token: signToken(admin), user: shape(admin) });
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not create the admin account" });
  }
};

/** GET /api/auth/setup-state — lets the login screen show first-run setup. */
export const setupState = async (_req, res) => {
  try {
    const count = await User.countDocuments();
    res.json({ needsSetup: count === 0, permissionCatalog: PERMISSIONS });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/** POST /api/auth/login  { username, password } */
export const login = async (req, res) => {
  try {
    const { username = "", password = "" } = req.body || {};
    const user = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (!user) return res.status(401).json({ message: "Invalid username or password" });
    if (!user.isActive)
      return res.status(403).json({ message: "This account has been deactivated" });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ message: "Invalid username or password" });

    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: signToken(user), user: shape(user) });
  } catch (err) {
    res.status(500).json({ message: err.message || "Sign in failed" });
  }
};

/** GET /api/auth/me */
export const me = async (req, res) => {
  res.json({ user: shape(req.user), permissionCatalog: PERMISSIONS });
};

/** PATCH /api/auth/password  { currentPassword, newPassword } */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword = "", newPassword = "" } = req.body || {};
    if (String(newPassword).length < 6)
      return res.status(400).json({ message: "New password must be at least 6 characters" });

    const ok = await req.user.verifyPassword(currentPassword);
    if (!ok) return res.status(400).json({ message: "Current password is incorrect" });

    await req.user.setPassword(newPassword);
    req.user.mustChangePassword = false;
    await req.user.save();
    res.json({ message: "Password updated" });
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not update the password" });
  }
};
