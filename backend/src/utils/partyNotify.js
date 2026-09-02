import { notifyApprovers, notifyRequester } from "./notify.js";

/**
 * Notifications for vendor / buyer registrations.
 *
 * - A new registration (or an edit that puts a party back to "pending")
 *   fans out to every admin: "X registration awaiting approval".
 * - The admin's decision goes back to whoever registered the party
 *   (party.createdBy), so add that field to the Vendor / Buyer schema.
 */

const LABEL = { vendor: "Vendor", buyer: "Buyer" };
const LIST_LINK = { vendor: "/vendors", buyer: "/buyers" };

/** Tell every admin a party is waiting for a decision. */
export async function notifyPartyRegistered({ kind, party, actor, edited = false }) {
  const label = LABEL[kind] || "Party";
  return notifyApprovers({
    permission: `${kind}.approve`,
    actorId: actor?._id || null,
    title: `${label} approval needed — ${party.companyName}`,
    message: `${actor?.name || actor?.username || "A user"} ${
      edited ? "updated" : "registered"
    } ${label.toLowerCase()} "${party.companyName}". It stays pending until you approve or reject it.`,
    link: LIST_LINK[kind],
    entityType: kind,
    entityId: party._id,
  });
}

/** Tell the person who registered the party what the admin decided. */
export async function notifyPartyDecision({ kind, party, approved, actor }) {
  const label = LABEL[kind] || "Party";
  const comment = party.approvalComment ? ` Note: ${party.approvalComment}` : "";
  return notifyRequester({
    recipientId: party.createdBy || null,
    approved,
    actorId: actor?._id || null,
    title: `${label} ${approved ? "approved" : "rejected"} — ${party.companyName}`,
    message: `${actor?.name || actor?.username || "The admin"} ${
      approved ? "approved" : "rejected"
    } ${label.toLowerCase()} "${party.companyName}".${comment}`,
    link: LIST_LINK[kind],
    entityType: kind,
    entityId: party._id,
  });
}
