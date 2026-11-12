import User from "../models/User.js";

/**
 * One-time, idempotent migration for the multi-level admin feature.
 *
 * Before this feature the top account was simply an "admin". If the database
 * has no super admin yet, the OLDEST admin account (the original central
 * admin) is promoted to super admin so someone can control the other admins'
 * rights. Does nothing once a super admin exists, and never touches users.
 */
export async function ensureSuperAdmin() {
  try {
    const existing = await User.countDocuments({ role: "super_admin" });
    if (existing > 0) return;

    const oldest = await User.findOne({ role: "admin" }).sort({ createdAt: 1, _id: 1 });
    if (!oldest) return;

    oldest.role = "super_admin";
    await oldest.save();
    console.log(`Promoted "${oldest.username}" to super admin (first run of multi-level admins).`);
  } catch (err) {
    console.error("Could not ensure a super admin exists:", err);
  }
}