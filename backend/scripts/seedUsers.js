/**
 * One-off seed: central admin + two users.
 *   node scripts/seedUsers.js
 * Run from the backend folder. Existing usernames are left untouched.
 */
import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { DEFAULT_PERMISSIONS } from "../src/config/permissions.js";

const SEED = [
  { name: "Central Admin", username: "admin", password: "Admin@123", role: "admin" },
  { name: "User One", username: "user1", password: "User@123", role: "user" },
  { name: "User Two", username: "user2", password: "User@123", role: "user" },
];

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGO_URI is not set");
  process.exit(1);
}

await mongoose.connect(uri);

for (const entry of SEED) {
  const exists = await User.findOne({ username: entry.username });
  if (exists) {
    console.log(`- ${entry.username} already exists, skipped`);
    continue;
  }
  const user = new User({
    name: entry.name,
    username: entry.username,
    role: entry.role,
    permissions: [...DEFAULT_PERMISSIONS[entry.role]],
    mustChangePassword: true,
  });
  await user.setPassword(entry.password);
  await user.save();
  console.log(`+ created ${entry.role}: ${entry.username} / ${entry.password}`);
}

await mongoose.disconnect();
console.log("Done. Change these passwords after the first sign in.");
