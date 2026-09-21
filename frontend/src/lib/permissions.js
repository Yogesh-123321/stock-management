/**
 * Mirror of backend/src/config/permissions.js — keep both in sync.
 *
 * Anything flagged adminOnly is reserved for the central admin: approving
 * POs, PIs, part numbers, vendor/buyer registrations and managing users.
 * These are shown in the panel as locked, never as tickable rights.
 */
export const PERMISSIONS = [
  { key: "po.create", group: "Purchase orders", label: "Create / generate PO" },
  { key: "po.approve", group: "Purchase orders", label: "Approve PO", adminOnly: true },
  { key: "pi.create", group: "Proforma invoices", label: "Create / generate PI" },
  { key: "pi.approve", group: "Proforma invoices", label: "Approve PI", adminOnly: true },
  { key: "part.request", group: "Parts", label: "Raise new / alternate part request" },
  { key: "part.approve", group: "Parts", label: "Approve part numbers", adminOnly: true },
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
  { key: "receive.manage", group: "Operations", label: "Receive material / book stock" },
  { key: "documents.view", group: "Operations", label: "View PO / PI / invoice documents" },
  { key: "kit.manage", group: "Kits", label: "Create / edit kit templates", adminOnly: true },
  { key: "kit.issue", group: "Kits", label: "Issue kits to a vendor" },
  {
    key: "iqc.manage",
    group: "Quality",
    label: "Create / edit IQC templates",
    adminOnly: true,
  },
  {
    key: "users.manage",
    group: "Administration",
    label: "Manage users & permissions",
    adminOnly: true,
  },
  { key: "logs.view", group: "Administration", label: "View the activity log", adminOnly: true },
];

export const ADMIN_ONLY_PERMISSIONS = PERMISSIONS.filter((p) => p.adminOnly).map((p) => p.key);

export const isAdminOnly = (key) => ADMIN_ONLY_PERMISSIONS.includes(key);

export const PERMISSION_GROUPS = PERMISSIONS.reduce((acc, p) => {
  (acc[p.group] = acc[p.group] || []).push(p);
  return acc;
}, {});

export const APPROVAL_LABEL = {
  po: "Purchase order",
  pi: "Proforma invoice",
  vendor: "Vendor registration",
  buyer: "Buyer registration",
  part: "Part number",
};