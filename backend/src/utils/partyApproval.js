import mongoose from "mongoose";
import ApprovalRequest from "../models/ApprovalRequest.js";
import { notifyApprovers, notifyRequester } from "./notify.js";

/**
 * Vendors and buyers now travel through the SAME approval envelope as PO / PI,
 * so they appear in the Approvals screen and both sides get notified.
 *
 *  register / edit  -> openPartyApproval()      (pending row + admin bell)
 *  decide anywhere  -> resolvePartyApproval()   (row closed + registrar bell)
 *
 * Everything is best-effort: a notification problem must never break the
 * registration or the decision itself.
 */

const META = {
  vendor: { label: "Vendor registration", permission: "vendor.approve", model: "Vendor" },
  buyer: { label: "Buyer registration", permission: "buyer.approve", model: "Buyer" },
};

const partyName = (p) => p?.companyName || "Unnamed party";
const partyRef = (kind, p) =>
  kind === "vendor" ? p?.vendorRegistrationNo || "" : p?.buyerRegistrationNo || "";

/** Raise (or reuse) the pending approval for a party and ping every admin. */
export async function openPartyApproval({ kind, party, actor, edited = false }) {
  const meta = META[kind];
  if (!meta || !party?._id) return null;

  try {
    let request = await ApprovalRequest.findOne({
      entityType: kind,
      entityId: party._id,
      status: "pending",
    });

    if (!request) {
      request = await ApprovalRequest.create({
        entityType: kind,
        entityId: party._id,
        entityModel: meta.model,
        title: `${meta.label} — ${partyName(party)}`,
        summary: [partyRef(kind, party), party.taxRegistrationNo, party.email]
          .filter(Boolean)
          .join(" · "),
        payload: {
          companyName: party.companyName,
          gstin: party.taxRegistrationNo || "",
          phone: party.phone || "",
          email: party.email || "",
          isMsme: !!party.isMsme,
        },
        requestRemarks: edited ? "Details were edited — needs a fresh decision." : "",
        requestedBy: party.createdBy || actor?._id || null,
      });
    }

    await notifyApprovers({
      permission: meta.permission,
      actorId: actor?._id || null,
      title: `${meta.label} awaiting approval`,
      message: `${actor?.name || actor?.username || "A user"} ${
        edited ? "updated" : "registered"
      } "${partyName(party)}". It stays pending until you approve or reject it.`,
      link: "/approvals",
      entityType: kind,
      entityId: party._id,
      approvalRequest: request?._id || null,
    });

    return request;
  } catch (err) {
    console.error(`[partyApproval] could not open ${kind} approval:`, err.message);
    return null;
  }
}

/**
 * Close the pending envelope after a decision taken on the Vendors / Buyers
 * page and tell the person who registered the party.
 */
export async function resolvePartyApproval({ kind, party, approved, actor, comment = "" }) {
  const meta = META[kind];
  if (!meta || !party?._id) return null;

  try {
    const request = await ApprovalRequest.findOne({
      entityType: kind,
      entityId: party._id,
      status: "pending",
    });

    if (request) {
      request.status = approved ? "approved" : "rejected";
      request.reviewedBy = actor?._id || null;
      request.reviewRemarks = comment || "";
      request.reviewedAt = new Date();
      await request.save();
    }

    await notifyRequester({
      recipientId: party.createdBy || request?.requestedBy || null,
      approved,
      actorId: actor?._id || null,
      title: `${meta.label} ${approved ? "approved" : "rejected"} — ${partyName(party)}`,
      message: `${actor?.name || actor?.username || "The admin"} ${
        approved ? "approved" : "rejected"
      } "${partyName(party)}".${comment ? ` Note: ${comment}` : ""}`,
      link: kind === "vendor" ? "/vendors" : "/buyers",
      entityType: kind,
      entityId: party._id,
      approvalRequest: request?._id || null,
    });

    return request;
  } catch (err) {
    console.error(`[partyApproval] could not resolve ${kind} approval:`, err.message);
    return null;
  }
}

/**
 * Mirror a decision taken on the Approvals screen back onto the Vendor / Buyer
 * document, which stores it in `status` (not `approvalStatus`).
 */
export async function applyPartyDecision({ kind, entityId, status, actor, comment = "" }) {
  const meta = META[kind];
  if (!meta) return null;
  const Model = mongoose.models[meta.model];
  if (!Model) return null;

  try {
    return await Model.findByIdAndUpdate(
      entityId,
      {
        status,
        approvedBy: actor?.name || actor?.username || "Admin",
        approvalComment: comment || "",
        approvedAt: new Date(),
      },
      { new: true }
    );
  } catch (err) {
    console.error(`[partyApproval] could not stamp ${kind}:`, err.message);
    return null;
  }
}
