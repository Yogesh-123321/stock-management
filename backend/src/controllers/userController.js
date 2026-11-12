import User from "../models/User.js";
import { notifyUsers } from "../utils/notify.js";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  ADMIN_ONLY_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  ROLES,
  ROLE_LABEL,
  effectivePermissions,
  canManageUser,
  isAdminRole,
} from "../config/permissions.js";

/**
 * Multi-level admins
 *  - super_admin: creates / edits / deactivates admins AND users, controls every
 *                 admin's rights (including approval rights and users.manage).
 *  - admin:       manages normal users only; can't see-through to other admins'
 *                 rights, can't create admins, and can only hand a user rights
 *                 the admin holds themselves.
 *  - user:        no access to this module.
 */

function shape(u, actor) {
  return {
    _id: u._id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    roleLabel: ROLE_LABEL[u.role] || u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    permissions: effectivePermissions(u),
    storedPermissions: u.permissions || [],
    revokedPermissions: u.revokedPermissions || [],
    // Whether the signed-in person may edit this account (drives the UI).
    canManage: actor ? canManageUser(actor, u) || false : false,
    isSelf: actor ? String(actor._id) === String(u._id) : false,
  };
}

/** Real permission keys only; users never keep admin-only rights. */
const cleanFor = (list, role) => {
  const keys = [...new Set((Array.isArray(list) ? list : []).filter((p) => PERMISSION_KEYS.includes(p)))];
  return role === "user" ? keys.filter((p) => !ADMIN_ONLY_PERMISSIONS.includes(p)) : keys;
};

/** Roles the actor is allowed to hand out. */
const assignableRoles = (actor) => (actor.role === "super_admin" ? ROLES : ["user"]);

const activeSuperAdmins = () => User.countDocuments({ role: "super_admin", isActive: true });

/**
 * Applies a requested permission list to `user`.
 *  - super_admin target: nothing to store (holds everything).
 *  - admin target: stored as the revoked list (everything not ticked is revoked).
 *  - user target: stored as the granted list. A non-super actor can only grant
 *    rights they hold themselves, and can't strip rights they don't hold.
 */
function applyPermissions(user, requested, actor) {
  if (user.role === "super_admin") return;
  const wanted = cleanFor(requested, user.role);

  if (user.role === "admin") {
    user.revokedPermissions = PERMISSION_KEYS.filter((k) => !wanted.includes(k));
    return;
  }

  if (actor.role === "super_admin") {
    user.permissions = wanted;
    return;
  }
  const mine = new Set(effectivePermissions(actor));
  const kept = (user.permissions || []).filter((p) => !mine.has(p)); // rights this actor can't touch
  user.permissions = [...new Set([...wanted.filter((p) => mine.has(p)), ...kept])];
}

/** GET /api/users */
export const listUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ role: 1, name: 1 });
    // super_admin sorts after admin alphabetically; show the top level first.
    const order = { super_admin: 0, admin: 1, user: 2 };
    users.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.name.localeCompare(b.name));
    res.json({
      users: users.map((u) => shape(u, req.user)),
      permissionCatalog: PERMISSIONS,
      assignableRoles: assignableRoles(req.user),
      myPermissions: effectivePermissions(req.user),
    });
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
    if (!assignableRoles(req.user).includes(role))
      return res.status(403).json({ message: "Only a super admin can create admin accounts" });
    if (String(password).length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" });

    const exists = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (exists) return res.status(409).json({ message: "That username is already taken" });

    const user = new User({
      name,
      username,
      email,
      role,
      permissions: role === "user" ? [...DEFAULT_PERMISSIONS.user] : [...PERMISSION_KEYS],
      mustChangePassword: Boolean(mustChangePassword),
      createdBy: req.user?._id || null,
    });
    if (Array.isArray(permissions)) applyPermissions(user, permissions, req.user);
    else if (role === "user" && req.user.role !== "super_admin") {
      // default rights, limited to what this admin themselves hold
      const mine = new Set(effectivePermissions(req.user));
      user.permissions = user.permissions.filter((p) => mine.has(p));
    }
    await user.setPassword(password);
    await user.save();

    await notifyUsers([user._id], {
      type: "info",
      title: "Welcome to TISPL Inventory",
      message: `Your account was created by ${req.user?.name || "an admin"}. Please change your password from the account menu.`,
      link: "/",
      actor: req.user?._id || null,
    });

    res.status(201).json(shape(user, req.user));
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not create the user" });
  }
};

/** PATCH /api/users/:id  { name, email, role, permissions, isActive } */
export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isSelf = String(user._id) === String(req.user._id);
    if (!canManageUser(req.user, user) && !isSelf)
      return res.status(403).json({ message: "You cannot manage this account — only a super admin can manage admins" });

    const { name, email, role, permissions, isActive } = req.body || {};

    // Your own account: only the profile — never your own role, rights or status.
    if (isSelf && !canManageUser(req.user, user)) {
      if (typeof name === "string" && name.trim()) user.name = name.trim();
      if (typeof email === "string") user.email = email.trim();
      await user.save();
      return res.json(shape(user, req.user));
    }

    if (typeof name === "string" && name.trim()) user.name = name.trim();
    if (typeof email === "string") user.email = email.trim();

    // --- role change ---------------------------------------------------
    if (role && ROLES.includes(role) && role !== user.role) {
      if (!assignableRoles(req.user).includes(role))
        return res.status(403).json({ message: "Only a super admin can change roles to admin" });
      if (isSelf) return res.status(400).json({ message: "You cannot change your own role" });
      if (user.role === "super_admin" && (await activeSuperAdmins()) <= 1)
        return res.status(400).json({ message: "There must be at least one active super admin" });

      user.role = role;
      user.permissions = role === "user" ? [...DEFAULT_PERMISSIONS.user] : [...PERMISSION_KEYS];
      user.revokedPermissions = []; // a fresh start at the new level
    }

    // --- rights ---------------------------------------------------------
    if (Array.isArray(permissions)) {
      if (isSelf) return res.status(400).json({ message: "You cannot change your own rights" });
      applyPermissions(user, permissions, req.user);
    }

    // --- active flag ----------------------------------------------------
    if (typeof isActive === "boolean" && isActive !== user.isActive) {
      if (isSelf) return res.status(400).json({ message: "You cannot deactivate yourself" });
      if (!isActive && user.role === "super_admin" && (await activeSuperAdmins()) <= 1)
        return res.status(400).json({ message: "There must be at least one active super admin" });
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

    res.json(shape(user, req.user));
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
    if (!canManageUser(req.user, user))
      return res.status(403).json({ message: "Only a super admin can reset an admin's password" });

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

// Re-exported for callers that only need the role check.
export { isAdminRole };