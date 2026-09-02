import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import connectDB from "./src/config/db.js";

import vendorRoutes from "./src/routes/vendorRoutes.js";
import buyerRoutes from "./src/routes/buyerRoutes.js";
import poRoutes from "./src/routes/poRoutes.js";
import partRoutes from "./src/routes/partRoutes.js";
import stockRoutes from "./src/routes/stockRoutes.js";
import taxInvoiceRoutes from "./src/routes/taxInvoiceRoutes.js";
import piGeneratorRoutes from "./src/routes/piGeneratorRoutes.js";
import poGeneratorRoutes from "./src/routes/poGeneratorRoutes.js";
import receivingSessionRoutes from "./src/routes/receivingSessionRoutes.js";
import partApprovalRoutes from "./src/routes/partApprovalRoutes.js";
import authRoutes from "./src/routes/authRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import notificationRoutes from "./src/routes/notificationRoutes.js";
import approvalRoutes from "./src/routes/approvalRoutes.js";
import activityLogRoutes from "./src/routes/activityLogRoutes.js";

import { notFound, errorHandler } from "./src/middleware/errorHandler.js";
import activityLogger from "./src/middleware/activityLogger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

connectDB();

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Activity logger must run BEFORE the routes so it can record every request.
app.use("/api", activityLogger());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/vendors", vendorRoutes);
app.use("/api/buyers", buyerRoutes);
app.use("/api/purchase-orders", poRoutes);
app.use("/api/parts", partRoutes);
app.use("/api/stock-entries", stockRoutes);
app.use("/api/tax-invoices", taxInvoiceRoutes);
app.use("/api/pi-generator", piGeneratorRoutes);
app.use("/api/po-generator", poGeneratorRoutes);
app.use("/api/receiving-sessions", receivingSessionRoutes);
app.use("/api/part-approvals", partApprovalRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/activity-logs", activityLogRoutes);

// 404 + error handlers MUST stay last — anything mounted after them is unreachable.
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
