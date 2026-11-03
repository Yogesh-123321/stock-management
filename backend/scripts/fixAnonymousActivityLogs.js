/**
 * One-off repair: put real names on old activity-log rows saved as "Anonymous".
 *
 *   node scripts/fixAnonymousActivityLogs.js            # dry run — only reports
 *   node scripts/fixAnonymousActivityLogs.js --apply    # writes the changes
 *
 * Run from the backend folder.
 *
 * Those rows never recorded who made the request, so the user is worked out
 * from what the row did keep:
 *   1. Sign-ins        -> the username that was typed in the request body.
 *   2. Everything else -> the same browser (IP + user-agent) was signed in as
 *                         exactly ONE user within 12h either side (a login token
 *                         lives 12h). If that browser was used by several people
 *                         in that window, or by none, the row is left alone —
 *                         a wrong name is worse than "Anonymous".
 */
import "dotenv/config";
import mongoose from "mongoose";
import ActivityLog from "../src/models/ActivityLog.js";
import User from "../src/models/User.js";

const APPLY = process.argv.includes("--apply");
const WINDOW_MS = 12 * 60 * 60 * 1000;

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGO_URI is not set");
  process.exit(1);
}
await mongoose.connect(uri);

const users = await User.find({}, "name username role").lean();
const byId = new Map(users.map((u) => [String(u._id), u]));
const byUsername = new Map(users.map((u) => [String(u.username).toLowerCase(), u]));

const anon = await ActivityLog.find({
  user: null,
  userName: { $in: ["Anonymous", "Unknown (not signed in)"] },
}).lean();

// Rows that DO know their user, grouped by browser (ip + user-agent).
const known = await ActivityLog.find(
  { user: { $ne: null } },
  "user ip userAgent createdAt"
).lean();
const knownByBrowser = new Map();
for (const k of known) {
  const key = `${k.ip}|${k.userAgent}`;
  if (!knownByBrowser.has(key)) knownByBrowser.set(key, []);
  knownByBrowser.get(key).push(k);
}

const ops = [];
const tally = {};
let unresolved = 0;

for (const row of anon) {
  let user = null;

  if (row.action === "auth.login" && row.meta?.username) {
    user = byUsername.get(String(row.meta.username).trim().toLowerCase()) || null;
  }

  if (!user) {
    const t = new Date(row.createdAt).getTime();
    const near = (knownByBrowser.get(`${row.ip}|${row.userAgent}`) || []).filter(
      (k) => Math.abs(new Date(k.createdAt).getTime() - t) <= WINDOW_MS
    );
    const ids = [...new Set(near.map((k) => String(k.user)))];
    if (ids.length === 1) user = byId.get(ids[0]) || null;
  }

  if (!user) {
    unresolved += 1;
    continue;
  }

  tally[user.name] = (tally[user.name] || 0) + 1;
  ops.push({
    updateOne: {
      filter: { _id: row._id },
      update: {
        $set: {
          user: user._id,
          userName: user.name || user.username,
          userRole: user.role || "",
          description: String(row.description || "").replace(
            /^(Someone|A visitor who was not signed in)/,
            user.name || user.username
          ),
        },
      },
    },
  });
}

console.log(`Anonymous rows found : ${anon.length}`);
console.log(`Can be attributed    : ${ops.length}`);
for (const [name, n] of Object.entries(tally)) console.log(`   ${name}: ${n}`);
console.log(`Left as they are     : ${unresolved} (could not be told apart safely)`);

if (!APPLY) {
  console.log("\nDry run only — nothing was changed. Re-run with --apply to save.");
} else if (ops.length) {
  const res = await ActivityLog.bulkWrite(ops);
  console.log(`\nUpdated ${res.modifiedCount} rows.`);
}

await mongoose.disconnect();