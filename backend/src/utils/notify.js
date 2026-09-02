import Notification from "../models/Notification.js";
import User from "../models/User.js";

/**
 * Approvals are an admin-only power, so every approval notification goes to
 * the active admins. (Users only ever get the "your request was decided"
 * notification, sent by notifyRequester.)
 */
export async function findApprovers() {
  return User.find({ isActive: true, role: "admin" }).select("_id");
}

export async function notifyUsers(recipients, payload) {
  const ids = (recipients || [])
    .map((r) => (r && r._id ? String(r._id) : String(r)))
    .filter(Boolean);
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  return Notification.insertMany(unique.map((recipient) => ({ ...payload, recipient })));
}

/** Fan an approval request out to every admin. */
export async function notifyApprovers({ permission, actorId, ...payload }) {
  const approvers = await findApprovers(permission);
  const targets = approvers.filter((a) => String(a._id) !== String(actorId || ""));
  return notifyUsers(targets, { ...payload, actor: actorId || null, type: "approval_requested" });
}

/** Tell the requester what the admin decided. */
export async function notifyRequester({ recipientId, approved, actorId, ...payload }) {
  if (!recipientId) return [];
  return notifyUsers([recipientId], {
    ...payload,
    actor: actorId || null,
    type: approved ? "approval_approved" : "approval_rejected",
  });
}
