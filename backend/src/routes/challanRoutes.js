// backend/src/routes/challanRoutes.js
import express from "express";
import {
  searchParties,
  nextNumber,
  generateChallan,
  listChallans,
  getChallan,
  copyChallan,
  setChallanStatus,
  downloadChallan,
} from "../controllers/challanController.js";
import { protect, requirePermission } from "../middleware/auth.js";

const router = express.Router();

router.use(protect, requirePermission("challan.create"));

router.get("/parties", searchParties);
router.get("/next-no", nextNumber);
router.get("/", listChallans);
router.post("/", generateChallan);

// Parameter sub-routes must be registered before the generic /:id route.
router.get("/:id/copy", copyChallan);
router.get("/:id/download", downloadChallan);
router.patch("/:id/status", setChallanStatus);
router.get("/:id", getChallan);

export default router;