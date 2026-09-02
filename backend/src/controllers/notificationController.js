import Notification from "../models/Notification.js";

/** GET /api/notifications?filter=all|unread&limit=50 */
export const listNotifications = async (req, res) => {
  try {
    const { filter = "all", limit = 50 } = req.query;
    const query = { recipient: req.user._id };
    if (filter === "unread") query.read = false;

    const [items, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(limit) || 50, 200))
        .populate("actor", "name username"),
      Notification.countDocuments({ recipient: req.user._id, read: false }),
    ]);

    res.json({ items, unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/notifications/unread-count — polled by the bell. */
export const unreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({ recipient: req.user._id, read: false });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/** PATCH /api/notifications/:id/read */
export const markRead = async (req, res) => {
  try {
    const doc = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { read: true, readAt: new Date() },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Notification not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/** PATCH /api/notifications/read-all */
export const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { read: true, readAt: new Date() }
    );
    res.json({ message: "All caught up" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
