import ActivityLog from "../models/ActivityLog.js";
import User from "../models/User.js";

/** Build the mongo filter from the query string. */
function buildFilter(q) {
  const filter = {};
  if (q.user) filter.user = q.user;
  if (q.entityType && q.entityType !== "all") filter.entityType = q.entityType;
  if (q.action && q.action !== "all") filter.action = q.action;
  if (q.result === "success") filter.success = true;
  if (q.result === "failed") filter.success = false;

  if (q.from || q.to) {
    filter.createdAt = {};
    if (q.from) filter.createdAt.$gte = new Date(q.from);
    if (q.to) {
      const to = new Date(q.to);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  const search = String(q.q || q.search || "").trim();
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { userName: rx },
      { description: rx },
      { action: rx },
      { entityLabel: rx },
      { path: rx },
    ];
  }
  return filter;
}

/** GET /api/activity-logs — paged, filterable list. ADMIN ONLY. */
export const listLogs = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
    const filter = buildFilter(req.query);

    const [rows, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "name username role")
        .lean(),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({ rows, total, page, limit, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not load the activity log" });
  }
};

/** GET /api/activity-logs/filters — dropdown options for the UI. ADMIN ONLY. */
export const logFilters = async (_req, res) => {
  try {
    const [users, actions] = await Promise.all([
      User.find().select("name username role isActive").sort({ name: 1 }).lean(),
      ActivityLog.distinct("action"),
    ]);
    res.json({ users, actions: actions.sort() });
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not load filters" });
  }
};

/**
 * GET /api/activity-logs/summary?days=7 — per-user activity counts for the
 * tiles at the top of the page. ADMIN ONLY.
 */
export const logSummary = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [perUser, perEntity, totals] = await Promise.all([
      ActivityLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { user: "$user", userName: "$userName", userRole: "$userRole" },
            count: { $sum: 1 },
            failed: { $sum: { $cond: ["$success", 0, 1] } },
            lastAt: { $max: "$createdAt" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      ActivityLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$entityType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ActivityLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            failed: { $sum: { $cond: ["$success", 0, 1] } },
          },
        },
      ]),
    ]);

    res.json({
      days,
      total: totals[0]?.total || 0,
      failed: totals[0]?.failed || 0,
      perUser: perUser.map((r) => ({
        userId: r._id.user,
        userName: r._id.userName || "Unknown",
        userRole: r._id.userRole || "",
        count: r.count,
        failed: r.failed,
        lastAt: r.lastAt,
      })),
      perEntity: perEntity.map((r) => ({ entityType: r._id || "other", count: r.count })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not build the summary" });
  }
};

/** GET /api/activity-logs/export — CSV of the current filter. ADMIN ONLY. */
export const exportLogs = async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    const rows = await ActivityLog.find(filter).sort({ createdAt: -1 }).limit(5000).lean();

    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Date/time",
      "User",
      "Role",
      "Action",
      "Description",
      "Section",
      "Reference",
      "Method",
      "Path",
      "Status",
      "Result",
      "IP",
    ];
    const lines = [header.map(esc).join(",")];
    for (const r of rows) {
      lines.push(
        [
          new Date(r.createdAt).toLocaleString("en-IN"),
          r.userName,
          r.userRole,
          r.action,
          r.description,
          r.entityType,
          r.entityLabel,
          r.method,
          r.path,
          r.statusCode,
          r.success ? "Success" : "Failed",
          r.ip,
        ]
          .map(esc)
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err) {
    res.status(500).json({ message: err.message || "Could not export the log" });
  }
};
