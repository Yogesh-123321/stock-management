import mongoose from "mongoose";
import ApprovalRequest from "../models/ApprovalRequest.js";
import { notifyApprovers, notifyRequester } from "../utils/notify.js";
import { effectivePermissions } from "../config/permissions.js";
import { mirrorGeneratedPoToReceiving } from "./poGeneratorController.js";
import { applyPartyDecision } from "../utils/partyApproval.js";

const ENTITY = {
  po: { label: "Purchase order", permission: "po.approve", model: "PurchaseOrderGen", link: "/approvals" },
  pi: { label: "Proforma invoice", permission: "pi.approve", model: "ProformaInvoiceGen", link: "/approvals" },
  vendor: { label: "Vendor registration", permission: "vendor.approve", model: "Vendor", link: "/vendors" },
  buyer: { label: "Buyer registration", permission: "buyer.approve", model: "Buyer", link: "/buyers" },
};

/** Best-effort stamp of the decision onto the source document. */
async function stampSource(entityType, entityId, status, modelHint, actor, comment) {
  // Vendors and buyers keep their decision in `status`, not `approvalStatus`.
  if (entityType === "vendor" || entityType === "buyer") {
    if (status === "pending") return;
    await applyPartyDecision({ kind: entityType, entityId, status, actor, comment });
    return;
  }

  const name = modelHint || ENTITY[entityType]?.model;
  const Model = name && mongoose.models[name];
  if (!Model) return;
  try {
    await Model.findByIdAndUpdate(entityId, { approvalStatus: status });
  } catch {
    /* the source model may not carry the field — safe to ignore */
  }
}

/**
 * POST /api/approvals
 * { entityType, entityId, title, summary, amount, payload, requestRemarks }
 */
export const createApproval = async (req, res) => {
  try {
    const {
      entityType,
      entityId,
      title,
      summary = "",
      amount = null,
      payload = {},
      entityModel = "",
      requestRemarks = "",
    } = req.body || {};

    const meta = ENTITY[entityType];
    if (!meta) return res.status(400).json({ message: "Invalid approval type" });
    if (!entityId || !mongoose.isValidObjectId(entityId))
      return res.status(400).json({ message: "A valid document id is required" });
    if (!title) return res.status(400).json({ message: "A title is required" });

    const existing = await ApprovalRequest.findOne({ entityType, entityId, status: "pending" });
    if (existing)
      return res
        .status(409)
        .json({ message: "This document is already waiting for approval", request: existing });

    const doc = await ApprovalRequest.create({
      entityType,
      entityId,
      entityModel: entityModel || meta.model,
      title,
      summary,
      amount: amount == null ? null : Number(amount),
      payload,
      requestRemarks,
      requestedBy: req.user._id,
    });

    await stampSource(entityType, entityId, "pending", entityModel, req.user, "");

    await notifyApprovers({
      permission: meta.permission,
      actorId: req.user._id,
      title: `${meta.label} awaiting approval`,
      message: `${req.user.name} sent ${title} for your approval.`,
      link: "/approvals",
      entityType,
      entityId,
      approvalRequest: doc._id,
    });

    res.status(201).json(await doc.populate("requestedBy", "name username"));
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not send this for approval" });
  }
};

/** GET /api/approvals?status=pending&entityType=po&scope=all|mine */
export const listApprovals = async (req, res) => {
  try {
    const { status = "pending", entityType, scope } = req.query;
    const filter = {};
    if (status && status !== "all") {
      const list = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      filter.status = list.length > 1 ? { $in: list } : list[0];
    }
    if (entityType && entityType !== "all") filter.entityType = entityType;

    // Approving is an admin-only power.
    const held = req.user.role === "admin" ? effectivePermissions(req.user) : [];
    const approverOf = Object.entries(ENTITY)
      .filter(([, m]) => held.includes(m.permission))
      .map(([k]) => k);

    // Users who cannot approve anything only ever see their own requests.
    if (scope === "mine" || approverOf.length === 0) {
      filter.requestedBy = req.user._id;
    } else if (scope !== "all") {
      filter.$or = [{ entityType: { $in: approverOf } }, { requestedBy: req.user._id }];
    }

    const items = await ApprovalRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("requestedBy", "name username")
      .populate("reviewedBy", "name username");

    res.json({ items, canApprove: approverOf });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/approvals/pending-count */
export const pendingApprovalCount = async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.json({ count: 0 });
    const held = effectivePermissions(req.user);
    const approverOf = Object.entries(ENTITY)
      .filter(([, m]) => held.includes(m.permission))
      .map(([k]) => k);
    if (!approverOf.length) return res.json({ count: 0 });
    const count = await ApprovalRequest.countDocuments({
      status: "pending",
      entityType: { $in: approverOf },
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

async function decide(req, res, approved) {
  try {
    const doc = await ApprovalRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Approval request not found" });
    if (doc.status !== "pending")
      return res.status(400).json({ message: `This request is already ${doc.status}` });

    const meta = ENTITY[doc.entityType];
    // Only the central admin decides — users can raise requests, never approve.
    if (req.user.role !== "admin")
      return res
        .status(403)
        .json({ message: `Only an admin can approve or reject a ${meta.label.toLowerCase()}` });

    doc.status = approved ? "approved" : "rejected";
    doc.reviewedBy = req.user._id;
    doc.reviewRemarks = req.body?.reviewRemarks || "";
    doc.reviewedAt = new Date();
    await doc.save();

    await stampSource(
      doc.entityType,
      doc.entityId,
      doc.status,
      doc.entityModel,
      req.user,
      doc.reviewRemarks
    );

    // An approved generated PO becomes usable in material receiving.
    if (approved && doc.entityType === "po") {
      try {
        await mirrorGeneratedPoToReceiving(doc.entityId);
      } catch {
        /* mirroring is best-effort — the decision itself is already saved */
      }
    }

    await notifyRequester({
      recipientId: doc.requestedBy,
      approved,
      actorId: req.user._id,
      title: `${meta.label} ${approved ? "approved" : "rejected"}`,
      message: `${req.user.name} ${approved ? "approved" : "rejected"} ${doc.title}${
        doc.reviewRemarks ? ` — ${doc.reviewRemarks}` : ""
      }`,
      link: meta.link,
      entityType: doc.entityType,
      entityId: doc.entityId,
      approvalRequest: doc._id,
    });

    res.json(await doc.populate([
      { path: "requestedBy", select: "name username" },
      { path: "reviewedBy", select: "name username" },
    ]));
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not record the decision" });
  }
}

export const approve = (req, res) => decide(req, res, true);
export const reject = (req, res) => decide(req, res, false);
