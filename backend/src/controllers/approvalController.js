import mongoose from "mongoose";
import ApprovalRequest from "../models/ApprovalRequest.js";
import { notifyApprovers, notifyRequester } from "../utils/notify.js";
import { effectivePermissions } from "../config/permissions.js";
import { mirrorGeneratedPoToReceiving } from "./poGeneratorController.js";
import { applyPartyDecision, backfillPartyApprovals } from "../utils/partyApproval.js";
import PurchaseOrderGen from "../models/PurchaseOrderGen.js";
import ProformaInvoiceGen from "../models/ProformaInvoiceGen.js";

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
  } catch (err) {
    // Never fail the decision itself, but don't hide the problem either.
    console.error(`[approvals] Could not stamp ${entityType} ${entityId} as ${status}:`, err.message);
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

const sumQty = (items = []) => items.reduce((n, it) => n + (Number(it.quantity) || 0), 0);

/**
 * Fill in what the approvals table needs straight from the PO / PI being
 * approved — amount, a one-line summary, the remarks and a few headline
 * numbers. Requests raised before these were captured at request time (the
 * PI one never carried an amount or remarks) get them too, because the
 * source document is always the authority.
 */
async function enrichRows(rows) {
  const poIds = rows.filter((r) => r.entityType === "po").map((r) => r.entityId);
  const piIds = rows.filter((r) => r.entityType === "pi").map((r) => r.entityId);
  const [pos, pis] = await Promise.all([
    poIds.length ? PurchaseOrderGen.find({ _id: { $in: poIds } }).lean() : [],
    piIds.length ? ProformaInvoiceGen.find({ _id: { $in: piIds } }).lean() : [],
  ]);
  const poMap = new Map(pos.map((d) => [String(d._id), d]));
  const piMap = new Map(pis.map((d) => [String(d._id), d]));

  return rows.map((row) => {
    const out = row.toObject();
    const src = (row.entityType === "po" ? poMap : row.entityType === "pi" ? piMap : null)?.get(
      String(row.entityId)
    );
    if (!src) return out;

    const qty = sumQty(src.items);
    const party = row.entityType === "po" ? src.supplierName : src.buyerName;
    const lineRemarks =
      row.entityType === "po"
        ? (src.items || [])
            .filter((it) => it.additionalInfo)
            .map((it) => `${it.partNo || it.description}: ${it.additionalInfo}`)
        : [];
    const remarks = [
      ...(row.entityType === "pi" ? [src.specialNote] : []),
      ...lineRemarks,
      src.paymentTerms && `Payment terms: ${src.paymentTerms}`,
    ].filter(Boolean);

    out.amount = Number(out.amount) > 0 ? out.amount : src.totalAmount ?? null;
    out.summary = out.summary || `${party || "—"} — ${(src.items || []).length} item(s), ${qty} qty`;
    out.requestRemarks = out.requestRemarks || remarks.join(" · ");
    out.details = {
      party: party || "",
      itemCount: (src.items || []).length,
      totalQty: qty,
      subTotal: src.subTotal ?? null,
      taxAmount: src.taxAmount ?? null,
      totalAmount: src.totalAmount ?? null,
    };
    return out;
  });
}

/** GET /api/approvals?status=pending&entityType=po&scope=all|mine */
export const listApprovals = async (req, res) => {
  try {
    // Vendors / buyers registered before the approval screen covered them
    // get an approval row (once per server start), so they show up here.
    await backfillPartyApprovals();

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

    const rows = await ApprovalRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(500)
      .populate("requestedBy", "name username")
      .populate("reviewedBy", "name username");

    res.json({ items: await enrichRows(rows), canApprove: approverOf });
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
      } catch (err) {
        // Best-effort — the decision itself is already saved — but log why.
        console.error(`[approvals] Could not archive/mirror PO ${doc.entityId}:`, err.message);
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