import User from "../models/User.js";
import { notifyUsers } from "../utils/notify.js";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  ADMIN_ONLY_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  ROLES,
  effectivePermissions,
} from "../config/permissions.js";

function shape(u) {
  return {
    _id: u._id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    permissions: effectivePermissions(u),
    storedPermissions: u.permissions || [],
  };
}

/**
 * Keeps only real permission keys, and — for anyone who isn't an admin —
 * strips every admin-only right (all `*.approve` keys and `users.manage`).
 * Approving is reserved for the central admin, so it can't be granted here.
 */
const clean = (list, role = "user") => {
  const keys = [...new Set((Array.isArray(list) ? list : []).filter((p) => PERMISSION_KEYS.includes(p)))];
  if (role === "admin") return keys;
  return keys.filter((p) => !ADMIN_ONLY_PERMISSIONS.includes(p));
};

/** GET /api/users */
export const listUsers = async (_req, res) => {
  try {
    const users = await User.find().sort({ role: 1, name: 1 });
    res.json({ users: users.map(shape), permissionCatalog: PERMISSIONS });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/** POST /api/users  { name, username, password, role, permissions } */
export const createUser = async (req, res) => {
  try {
    const {
      name,
      username,
      password,
      email = "",
      role = "user",
      permissions,
      mustChangePassword = true,
    } = req.body || {};

    if (!name || !username || !password)
      return res.status(400).json({ message: "Name, username and password are required" });
    if (!ROLES.includes(role)) return res.status(400).json({ message: "Invalid role" });
    if (String(password).length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" });

    const exists = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (exists) return res.status(409).json({ message: "That username is already taken" });

    const user = new User({
      name,
      username,
      email,
      role,
      permissions: permissions ? clean(permissions, role) : [...DEFAULT_PERMISSIONS[role]],
      mustChangePassword: Boolean(mustChangePassword),
      createdBy: req.user?._id || null,
    });
    await user.setPassword(password);
    await user.save();

    await notifyUsers([user._id], {
      type: "info",
      title: "Welcome to TISPL Inventory",
      message: `Your account was created by ${req.user?.name || "an admin"}. Please change your password from the account menu.`,
      link: "/",
      actor: req.user?._id || null,
    });

    res.status(201).json(shape(user));
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not create the user" });
  }
};

/** PATCH /api/users/:id  { name, email, role, permissions, isActive } */
export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { name, email, role, permissions, isActive } = req.body || {};
    const isSelf = String(user._id) === String(req.user._id);

    if (typeof name === "string" && name.trim()) user.name = name.trim();
    if (typeof email === "string") user.email = email.trim();

    if (role && ROLES.includes(role) && role !== user.role) {
      if (isSelf && user.role === "admin")
        return res.status(400).json({ message: "You cannot change your own role" });
      if (user.role === "admin") {
        const admins = await User.countDocuments({ role: "admin", isActive: true });
        if (admins <= 1)
          return res.status(400).json({ message: "There must be at least one active admin" });
      }
      user.role = role;
      user.permissions = [...DEFAULT_PERMISSIONS[role]];
    }

    if (Array.isArray(permissions)) user.permissions = clean(permissions, user.role);

    if (typeof isActive === "boolean" && isActive !== user.isActive) {
      if (isSelf) return res.status(400).json({ message: "You cannot deactivate yourself" });
      if (!isActive && user.role === "admin") {
        const admins = await User.countDocuments({ role: "admin", isActive: true });
        if (admins <= 1)
          return res.status(400).json({ message: "There must be at least one active admin" });
      }
      user.isActive = isActive;
    }

    await user.save();

    await notifyUsers([user._id], {
      type: "info",
      title: "Your access was updated",
      message: `${req.user?.name || "An admin"} updated your role or permissions.`,
      link: "/",
      actor: req.user?._id || null,
    });

    res.json(shape(user));
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not update the user" });
  }
};

/** PATCH /api/users/:id/password  { newPassword } — admin reset */
export const resetPassword = async (req, res) => {
  try {
    const { newPassword = "" } = req.body || {};
    if (String(newPassword).length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    await user.setPassword(newPassword);
    user.mustChangePassword = true;
    await user.save();

    await notifyUsers([user._id], {
      type: "info",
      title: "Your password was reset",
      message: `${req.user?.name || "An admin"} reset your password. Please change it after signing in.`,
      link: "/",
      actor: req.user?._id || null,
    });

    res.json({ message: "Password reset" });
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not reset the password" });
  }
};
