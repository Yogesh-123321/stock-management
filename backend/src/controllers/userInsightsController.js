import mongoose from "mongoose";
import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";
import PurchaseOrderGen from "../models/PurchaseOrderGen.js";
import ProformaInvoiceGen from "../models/ProformaInvoiceGen.js";
import KitIssue from "../models/KitIssue.js";
import KitTemplate from "../models/KitTemplate.js";
import PaymentBill from "../models/PaymentBill.js";
import ApprovalRequest from "../models/ApprovalRequest.js";
import PartApprovalRequest from "../models/PartApprovalRequest.js";
import { effectivePermissions } from "../config/permissions.js";

/**
 * User usage dashboard (admin only — mounted under /api/users, which is
 * already behind `users.manage`).
 *
 *   GET /api/users/insights/overview?days=30   team-wide dashboard
 *   GET /api/users/insights/:id?days=30        one user's full record
 *
 * Everything is derived from data the app already stores:
 *   - ActivityLog  -> what people DID (and when / how often / what failed)
 *   - the document collections (PO, PI, kit issues, bills, approvals ...)
 *     -> what each person has ON RECORD, even for work done before logging
 *     existed.
 */

const TZ = "Asia/Kolkata";
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Sections that produce a real document / record when something is created. */
const DOC_SECTIONS = ["po", "pi", "invoice", "payment", "kit", "receiving", "stock"];
/** action keys look like "po-generator.create", "kits.issue", "billing.pay" … */
const CREATE_RX = /\.(create|issue)$/;
const DECISION_RX = /\.(approve|reject)$/;

const parseDays = (v) => Math.min(365, Math.max(1, Number(v) || 30));
const sinceFor = (days) => {
  // Start of the day `days-1` days ago (IST-agnostic — good enough for a window).
  const d = new Date(Date.now() - (days - 1) * DAY_MS);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Mongo expression: "was this a created-a-document action?" */
const isDocCreate = {
  $and: [
    { $in: ["$entityType", DOC_SECTIONS] },
    { $eq: ["$success", true] },
    { $regexMatch: { input: "$action", regex: CREATE_RX } },
  ],
};
const isDecision = {
  $and: [
    { $eq: ["$success", true] },
    { $regexMatch: { input: "$action", regex: DECISION_RX } },
  ],
};
const isLogin = { $and: [{ $eq: ["$action", "auth.login"] }, { $eq: ["$success", true] }] };
const isDownload = { $regexMatch: { input: "$action", regex: /\.download$/ } };

/** Fill every day in the window so charts never skip a quiet day. */
function fillDays(rows, days) {
  const map = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * DAY_MS);
    // en-CA gives YYYY-MM-DD; force the same zone Mongo grouped in.
    const key = d.toLocaleDateString("en-CA", { timeZone: TZ });
    const r = map.get(key);
    out.push({
      date: key,
      count: r?.count || 0,
      documents: r?.documents || 0,
      failed: r?.failed || 0,
    });
  }
  return out;
}

const dailyGroup = {
  _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ } },
  count: { $sum: 1 },
  documents: { $sum: { $cond: [isDocCreate, 1, 0] } },
  failed: { $sum: { $cond: ["$success", 0, 1] } },
};

/* ------------------------------------------------------------------ */
/* Team overview                                                      */
/* ------------------------------------------------------------------ */

export const insightsOverview = async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    const since = sinceFor(days);
    const match = { createdAt: { $gte: since } };

    const [users, perUser, daily, bySection, hours, totals] = await Promise.all([
      User.find().sort({ role: 1, name: 1 }).lean(),
      ActivityLog.aggregate([
        { $match: { ...match, user: { $ne: null } } },
        {
          $group: {
            _id: "$user",
            actions: { $sum: { $cond: [{ $eq: ["$entityType", "auth"] }, 0, 1] } },
            failed: { $sum: { $cond: ["$success", 0, 1] } },
            documents: { $sum: { $cond: [isDocCreate, 1, 0] } },
            decisions: { $sum: { $cond: [isDecision, 1, 0] } },
            downloads: { $sum: { $cond: [isDownload, 1, 0] } },
            logins: { $sum: { $cond: [isLogin, 1, 0] } },
            lastAt: { $max: "$createdAt" },
            activeDays: {
              $addToSet: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ },
              },
            },
            sections: { $push: "$entityType" },
          },
        },
      ]),
      ActivityLog.aggregate([{ $match: match }, { $group: dailyGroup }, { $sort: { _id: 1 } }]),
      ActivityLog.aggregate([
        { $match: { ...match, entityType: { $ne: "auth" } } },
        { $group: { _id: "$entityType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ActivityLog.aggregate([
        { $match: { ...match, entityType: { $ne: "auth" } } },
        { $group: { _id: { $hour: { date: "$createdAt", timezone: TZ } }, count: { $sum: 1 } } },
      ]),
      ActivityLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: { $cond: [{ $eq: ["$entityType", "auth"] }, 0, 1] } },
            failed: { $sum: { $cond: ["$success", 0, 1] } },
            documents: { $sum: { $cond: [isDocCreate, 1, 0] } },
            decisions: { $sum: { $cond: [isDecision, 1, 0] } },
            logins: { $sum: { $cond: [isLogin, 1, 0] } },
          },
        },
      ]),
    ]);

    const statsById = new Map(perUser.map((r) => [String(r._id), r]));

    const rows = users.map((u) => {
      const s = statsById.get(String(u._id));
      // Most-used section for this user.
      let topSection = "";
      if (s) {
        const tally = {};
        for (const sec of s.sections) {
          if (sec && sec !== "auth") tally[sec] = (tally[sec] || 0) + 1;
        }
        topSection = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      }
      return {
        _id: u._id,
        name: u.name,
        username: u.username,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        actions: s?.actions || 0,
        documents: s?.documents || 0,
        decisions: s?.decisions || 0,
        downloads: s?.downloads || 0,
        failed: s?.failed || 0,
        logins: s?.logins || 0,
        activeDays: s?.activeDays?.length || 0,
        lastActiveAt: s?.lastAt || null,
        topSection,
      };
    });

    const t = totals[0] || {};
    const activeUsers = rows.filter((r) => r.actions > 0 || r.logins > 0).length;
    const dormant = rows.filter((r) => r.isActive && !r.actions && !r.logins);

    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      count: hours.find((x) => x._id === h)?.count || 0,
    }));

    res.json({
      days,
      since,
      totals: {
        users: users.length,
        activeUsers,
        dormantUsers: dormant.length,
        actions: t.total || 0,
        documents: t.documents || 0,
        decisions: t.decisions || 0,
        logins: t.logins || 0,
        failed: t.failed || 0,
      },
      users: rows.sort((a, b) => b.actions - a.actions || String(a.name).localeCompare(b.name)),
      daily: fillDays(daily, days),
      bySection: bySection.map((r) => ({ entityType: r._id || "other", count: r.count })),
      hourly,
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not build the user dashboard" });
  }
};

/* ------------------------------------------------------------------ */
/* One user                                                           */
/* ------------------------------------------------------------------ */

/** What this person has on record in each document collection. */
async function recordsOnFile(userId, since) {
  const uid = new mongoose.Types.ObjectId(userId);
  const spec = [
    {
      key: "po",
      label: "Purchase orders",
      model: PurchaseOrderGen,
      filter: { createdByUser: uid },
      select: "voucherNo supplierName totalAmount status createdAt",
      shape: (d) => ({
        id: d._id,
        label: d.voucherNo,
        sub: d.supplierName,
        amount: d.totalAmount ?? null,
        status: d.status,
        at: d.createdAt,
      }),
    },
    {
      key: "pi",
      label: "Proforma invoices",
      model: ProformaInvoiceGen,
      filter: { createdByUser: uid },
      select: "invoiceNo buyerName totalAmount status createdAt",
      shape: (d) => ({
        id: d._id,
        label: d.invoiceNo,
        sub: d.buyerName,
        amount: d.totalAmount ?? null,
        status: d.status,
        at: d.createdAt,
      }),
    },
    {
      key: "kitIssue",
      label: "Kits issued",
      model: KitIssue,
      filter: { issuedByUser: uid, status: "issued" },
      select: "issueCode kitCode kitName quantity status createdAt",
      shape: (d) => ({
        id: d._id,
        label: d.issueCode || d.kitCode || d.kitName,
        sub: d.kitName,
        amount: null,
        status: `${d.quantity ?? 1} kit${(d.quantity ?? 1) === 1 ? "" : "s"}`,
        at: d.createdAt,
      }),
    },
    {
      key: "kitTemplate",
      label: "Kit templates created",
      model: KitTemplate,
      filter: { createdByUser: uid },
      select: "kitName kitCode isActive createdAt",
      shape: (d) => ({
        id: d._id,
        label: d.kitCode || d.kitName,
        sub: d.kitName,
        amount: null,
        status: d.isActive ? "active" : "inactive",
        at: d.createdAt,
      }),
    },
    {
      key: "bill",
      label: "Purchase bills submitted",
      model: PaymentBill,
      filter: { submittedBy: uid },
      select: "billNo payeeName amount status createdAt",
      shape: (d) => ({
        id: d._id,
        label: d.billNo,
        sub: d.payeeName,
        amount: d.amount ?? null,
        status: d.status,
        at: d.createdAt,
      }),
    },
    {
      key: "approvalRequest",
      label: "Approvals requested",
      model: ApprovalRequest,
      filter: { requestedBy: uid },
      select: "title entityType status amount createdAt",
      shape: (d) => ({
        id: d._id,
        label: d.title,
        sub: String(d.entityType || "").toUpperCase(),
        amount: d.amount ?? null,
        status: d.status,
        at: d.createdAt,
      }),
    },
    {
      key: "partRequest",
      label: "Part requests raised",
      model: PartApprovalRequest,
      filter: { requestedByUser: uid },
      select: "requestType newPart.itemDescription newPart.manufacturerPartNumber status createdAt",
      shape: (d) => ({
        id: d._id,
        label:
          d.newPart?.manufacturerPartNumber ||
          d.newPart?.itemDescription ||
          (d.requestType === "alternate_part" ? "Alternate part" : "New part"),
        sub: d.requestType === "alternate_part" ? "Alternate part" : "New part number",
        amount: null,
        status: d.status,
        at: d.createdAt,
      }),
    },
  ];

  return Promise.all(
    spec.map(async (s) => {
      try {
        const [total, inWindow, recent] = await Promise.all([
          s.model.countDocuments(s.filter),
          s.model.countDocuments({ ...s.filter, createdAt: { $gte: since } }),
          s.model.find(s.filter).sort({ createdAt: -1 }).limit(8).select(s.select).lean(),
        ]);
        return { key: s.key, label: s.label, total, inWindow, recent: recent.map(s.shape) };
      } catch {
        // A collection that errors must never take the whole dashboard down.
        return { key: s.key, label: s.label, total: 0, inWindow: 0, recent: [] };
      }
    })
  );
}

/** Reviews this person has done as an approver. */
async function reviewsDone(userId, since) {
  const uid = new mongoose.Types.ObjectId(userId);
  const safe = async (fn) => {
    try {
      return await fn();
    } catch {
      return 0;
    }
  };
  const [generic, parts, bills, paid] = await Promise.all([
    safe(() => ApprovalRequest.countDocuments({ reviewedBy: uid })),
    safe(() => PartApprovalRequest.countDocuments({ reviewedByUser: uid })),
    safe(() => PaymentBill.countDocuments({ reviewedBy: uid })),
    safe(() => PaymentBill.countDocuments({ paidBy: uid })),
  ]);
  const [genericW, partsW, billsW] = await Promise.all([
    safe(() => ApprovalRequest.countDocuments({ reviewedBy: uid, reviewedAt: { $gte: since } })),
    safe(() => PartApprovalRequest.countDocuments({ reviewedByUser: uid, updatedAt: { $gte: since } })),
    safe(() => PaymentBill.countDocuments({ reviewedBy: uid, reviewedAt: { $gte: since } })),
  ]);
  return {
    total: generic + parts + bills,
    inWindow: genericW + partsW + billsW,
    billsPaid: paid,
  };
}

export const userInsights = async (req, res) => {
  try {
    const { id } = req.params;
    if (!OBJECT_ID.test(id)) return res.status(400).json({ message: "Invalid user id" });

    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const days = parseDays(req.query.days);
    const since = sinceFor(days);
    const uid = new mongoose.Types.ObjectId(id);
    const match = { user: uid, createdAt: { $gte: since } };

    const [kpi, daily, bySection, topActions, hours, recent, documents, logins, failures, records, reviews, firstLast] =
      await Promise.all([
        ActivityLog.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              actions: { $sum: { $cond: [{ $eq: ["$entityType", "auth"] }, 0, 1] } },
              failed: { $sum: { $cond: ["$success", 0, 1] } },
              documents: { $sum: { $cond: [isDocCreate, 1, 0] } },
              decisions: { $sum: { $cond: [isDecision, 1, 0] } },
              downloads: { $sum: { $cond: [isDownload, 1, 0] } },
              logins: { $sum: { $cond: [isLogin, 1, 0] } },
              avgMs: { $avg: "$durationMs" },
              activeDays: {
                $addToSet: {
                  $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ },
                },
              },
            },
          },
        ]),
        ActivityLog.aggregate([{ $match: match }, { $group: dailyGroup }, { $sort: { _id: 1 } }]),
        ActivityLog.aggregate([
          { $match: { ...match, entityType: { $ne: "auth" } } },
          {
            $group: {
              _id: "$entityType",
              count: { $sum: 1 },
              documents: { $sum: { $cond: [isDocCreate, 1, 0] } },
              failed: { $sum: { $cond: ["$success", 0, 1] } },
              lastAt: { $max: "$createdAt" },
            },
          },
          { $sort: { count: -1 } },
        ]),
        ActivityLog.aggregate([
          { $match: { ...match, entityType: { $ne: "auth" } } },
          { $group: { _id: "$action", count: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        ActivityLog.aggregate([
          { $match: { ...match, entityType: { $ne: "auth" } } },
          { $group: { _id: { $hour: { date: "$createdAt", timezone: TZ } }, count: { $sum: 1 } } },
        ]),
        ActivityLog.find({ user: uid, entityType: { $ne: "auth" } })
          .sort({ createdAt: -1 })
          .limit(30)
          .lean(),
        // Documents created/issued in the window (newest first) — rows keep
        // path / entityId / meta so the UI can open the document from them.
        ActivityLog.find({
          user: uid,
          createdAt: { $gte: since },
          entityType: { $in: DOC_SECTIONS },
          success: true,
          action: { $regex: CREATE_RX },
        })
          .sort({ createdAt: -1 })
          .limit(100)
          .lean(),
        ActivityLog.find({ user: uid, action: { $in: ["auth.login", "auth.logout"] } })
          .sort({ createdAt: -1 })
          .limit(12)
          .select("action success ip userAgent createdAt")
          .lean(),
        ActivityLog.find({ user: uid, success: false, entityType: { $ne: "auth" } })
          .sort({ createdAt: -1 })
          .limit(8)
          .lean(),
        recordsOnFile(id, since),
        reviewsDone(id, since),
        ActivityLog.aggregate([
          { $match: { user: uid } },
          {
            $group: {
              _id: null,
              first: { $min: "$createdAt" },
              last: { $max: "$createdAt" },
              total: { $sum: 1 },
            },
          },
        ]),
      ]);

    const k = kpi[0] || {};
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      count: hours.find((x) => x._id === h)?.count || 0,
    }));

    // Group the documents list by section so the UI can show "12 POs, 4 PIs…".
    const documentTally = {};
    for (const d of documents) documentTally[d.entityType] = (documentTally[d.entityType] || 0) + 1;

    res.json({
      days,
      since,
      user: {
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        permissions: effectivePermissions(user),
      },
      kpi: {
        actions: k.actions || 0,
        documents: k.documents || 0,
        decisions: k.decisions || 0,
        downloads: k.downloads || 0,
        logins: k.logins || 0,
        failed: k.failed || 0,
        successRate: k.actions ? Math.round(((k.actions - (k.failed || 0)) / k.actions) * 100) : null,
        activeDays: k.activeDays?.length || 0,
        avgResponseMs: k.avgMs ? Math.round(k.avgMs) : null,
      },
      lifetime: {
        firstSeen: firstLast[0]?.first || null,
        lastSeen: firstLast[0]?.last || null,
        totalLogged: firstLast[0]?.total || 0,
      },
      daily: fillDays(daily, days),
      bySection: bySection.map((r) => ({
        entityType: r._id || "other",
        count: r.count,
        documents: r.documents,
        failed: r.failed,
        lastAt: r.lastAt,
      })),
      topActions: topActions.map((r) => ({ action: r._id, count: r.count, lastAt: r.lastAt })),
      hourly,
      recent,
      documents,
      documentTally,
      sessions: logins,
      failures,
      records,
      reviews,
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not build this user's record" });
  }
};