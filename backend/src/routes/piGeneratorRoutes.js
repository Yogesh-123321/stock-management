// backend/src/routes/piGeneratorRoutes.js
import express from "express";
import {
  searchParties,
  nextNumber,
  generatePi,
  listPis,
  getPi,
  copyPi,
  setPiStatus,
  downloadPi,
} from "../controllers/piGeneratorController.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

router.get("/parties", searchParties);
router.get("/next-no", nextNumber);
router.get("/next-number", nextNumber);
router.get("/", listPis);
router.get("/list", listPis);
router.post("/", requirePermission("pi.create"), generatePi);
router.post("/generate", requirePermission("pi.create"), generatePi);

// Parameter sub-routes must be registered before the generic /:id route.
router.get("/:id/copy", copyPi);
router.get("/:id/download", downloadPi);
router.patch("/:id/status", setPiStatus);
router.get("/:id", getPi);

export default router;
