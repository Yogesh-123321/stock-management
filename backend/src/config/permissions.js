/**
 * Single source of truth for permissions.
 * Shared shape with the frontend (frontend/src/lib/permissions.js) — keep both
 * files in sync if you add a new key.
 *
 * IMPORTANT: every `*.approve` right (and `users.manage`) is ADMIN ONLY. They
 * can never be granted to a normal user — not from the permissions panel, not
 * through the API. Users raise requests, the admin decides.
 */

export const PERMISSIONS = [
  // Purchase orders
  { key: "po.create", group: "Purchase orders", label: "Create / generate PO" },
  { key: "po.approve", group: "Purchase orders", label: "Approve PO", adminOnly: true },
  // Proforma invoices
  { key: "pi.create", group: "Proforma invoices", label: "Create / generate PI" },
  { key: "pi.approve", group: "Proforma invoices", label: "Approve PI", adminOnly: true },
  // Parts
  { key: "part.request", group: "Parts", label: "Raise new / alternate part request" },
  { key: "part.approve", group: "Parts", label: "Approve part numbers", adminOnly: true },
  // Parties
  { key: "vendor.create", group: "Vendors & buyers", label: "Register / edit vendor" },
  {
    key: "vendor.approve",
    group: "Vendors & buyers",
    label: "Approve vendor registration",
    adminOnly: true,
  },
  { key: "buyer.create", group: "Vendors & buyers", label: "Register / edit buyer" },
  {
    key: "buyer.approve",
    group: "Vendors & buyers",
    label: "Approve buyer registration",
    adminOnly: true,
  },
  // Operations
  { key: "receive.manage", group: "Operations", label: "Receive material / book stock" },
  { key: "documents.view", group: "Operations", label: "View PO / PI / invoice documents" },
  // Kits
  { key: "kit.manage", group: "Kits", label: "Create / edit kit templates", adminOnly: true },
  { key: "kit.issue", group: "Kits", label: "Issue kits to a vendor" },
  // Administration
  { key: "users.manage", group: "Administration", label: "Manage users & permissions", adminOnly: true },
  { key: "logs.view", group: "Administration", label: "View the activity log", adminOnly: true },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Rights reserved for the central admin — never assignable to a user. */
export const ADMIN_ONLY_PERMISSIONS = PERMISSIONS.filter((p) => p.adminOnly).map((p) => p.key);

/** Rights an admin may tick / untick for a normal user. */
export const ASSIGNABLE_PERMISSIONS = PERMISSION_KEYS.filter(
  (k) => !ADMIN_ONLY_PERMISSIONS.includes(k)
);

/** Every approval permission — handy for "is this person an approver" checks. */
export const APPROVAL_PERMISSIONS = PERMISSION_KEYS.filter((k) => k.endsWith(".approve"));

/** What a brand-new account of each role gets by default. */
export const DEFAULT_PERMISSIONS = {
  admin: [...PERMISSION_KEYS],
  user: [
    "po.create",
    "pi.create",
    "part.request",
    "vendor.create",
    "buyer.create",
    "receive.manage",
    "documents.view",
    "kit.issue",
  ],
};

export const ROLES = ["admin", "user"];

/**
 * Effective permissions for a user document.
 * Admins always hold every permission. Non-admins can never hold an
 * admin-only right, even if one was stored on their record earlier.
 */
export function effectivePermissions(user) {
  if (!user) return [];
  if (user.role === "admin") return [...PERMISSION_KEYS];
  return (user.permissions || []).filter(
    (p) => PERMISSION_KEYS.includes(p) && !ADMIN_ONLY_PERMISSIONS.includes(p)
  );
}

export function hasPermission(user, permission) {
  return effectivePermissions(user).includes(permission);
}

/** True when only an admin may ever hold this right. */
export function isAdminOnly(permission) {
  return ADMIN_ONLY_PERMISSIONS.includes(permission);
}