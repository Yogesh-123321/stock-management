import ApprovalRequest from "../models/ApprovalRequest.js";
import { notifyApprovers } from "./notify.js";

const META = {
  po: { label: "Purchase order", permission: "po.approve", model: "PurchaseOrderGen" },
  pi: { label: "Proforma invoice", permission: "pi.approve", model: "ProformaInvoiceGen" },
  vendor: { label: "Vendor registration", permission: "vendor.approve", model: "Vendor" },
  buyer: { label: "Buyer registration", permission: "buyer.approve", model: "Buyer" },
};

/**
 * Raise (or reuse) the pending admin approval for a freshly generated
 * document. Called straight from the PO / PI generator controllers so a
 * document can never exist without an approval envelope behind it.
 */
export async function requestDocumentApproval({
  entityType,
  entityId,
  title,
  summary = "",
  amount = null,
  payload = {},
  user,
}) {
  const meta = META[entityType];
  if (!meta) throw new Error(`Unknown approval type: ${entityType}`);

  const existing = await ApprovalRequest.findOne({ entityType, entityId, status: "pending" });
  if (existing) return existing;

  const doc = await ApprovalRequest.create({
    entityType,
    entityId,
    entityModel: meta.model,
    title,
    summary,
    amount: amount == null ? null : Number(amount),
    payload,
    requestedBy: user?._id || null,
  });

  await notifyApprovers({
    permission: meta.permission,
    actorId: user?._id || null,
    title: `${meta.label} awaiting approval`,
    message: `${user?.name || "A user"} sent ${title} for your approval.`,
    link: "/approvals",
    entityType,
    entityId,
    approvalRequest: doc._id,
  });

  return doc;
}

/**
 * Backwards-compatible wrapper for controllers that use the older
 * createDocumentApproval({ docType, docId, refNo, requestedBy }) API.
 */
export async function createDocumentApproval({
  docType,
  docId,
  refNo,
  requestedBy,
  summary = "",
  amount = null,
  payload = {},
}) {
  const entityType = String(docType || "").toLowerCase();
  const label = entityType === "po" ? "PO" : entityType === "pi" ? "PI" : docType;

  return requestDocumentApproval({
    entityType,
    entityId: docId,
    title: `${label} ${refNo}`.trim(),
    summary,
    amount,
    payload: { ...payload, refNo },
    user: requestedBy,
  });
}

/** Admins skip the queue only when they generated the document themselves. */
export const isApproved = (doc) => doc?.approvalStatus === "approved";
