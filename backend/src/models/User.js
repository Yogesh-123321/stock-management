import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { ROLES, PERMISSION_KEYS, DEFAULT_PERMISSIONS } from "../config/permissions.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    email: { type: String, trim: true, lowercase: true, default: "" },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: "user", index: true },
    permissions: {
      type: [{ type: String, enum: PERMISSION_KEYS }],
      default: () => [...DEFAULT_PERMISSIONS.user],
    },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(String(plain), 10);
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(String(plain), this.passwordHash);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const o = this.toObject({ virtuals: false });
  delete o.passwordHash;
  return o;
};

export default mongoose.models.User || mongoose.model("User", userSchema);
