import PartApprovalRequest from "../models/PartApprovalRequest.js";

/**
 * Server-side gate for the stock-entry endpoint.
 *
 * Any stock entry that would CREATE a part (a brand-new part number or an
 * alternate of an existing part) must carry `approvedRequestId` pointing at a
 * PartApprovalRequest that has been APPROVED in the Parts master screen.
 *
 * Entries against an existing, already-approved part pass straight through.
 *
 * Wire it up in backend/src/routes/stockEntryRoutes.js:
 *
 *   import requirePartApproval from "../middleware/requirePartApproval.js";
 *   router.post("/", requirePartApproval, stockEntryController.createStockEntry);
 */
export default async function requirePartApproval(req, res, next) {
  try {
    const { matchType, approvedRequestId } = req.body || {};

    // Booking against a part that already exists in the master — nothing to check.
    if (matchType !== "new_part_number" && matchType !== "alternate_part") return next();

    if (!approvedRequestId) {
      return res.status(403).json({
        message:
          "This part number is not approved yet. Send it for approval from the stock entry step; once the Parts section approves it you can book the quantity.",
      });
    }

    const request = await PartApprovalRequest.findById(approvedRequestId);
    if (!request) {
      return res.status(403).json({ message: "Approval request not found" });
    }
    if (request.status === "pending") {
      return res.status(403).json({
        message: "This part is still waiting for approval in the Parts section.",
      });
    }
    if (request.status === "rejected") {
      return res.status(403).json({
        message: `This part was rejected${request.reviewRemarks ? `: ${request.reviewRemarks}` : "."}`,
      });
    }
    if (request.status === "consumed") {
      return res.status(403).json({
        message: "This approval has already been used to create the part.",
      });
    }

    // Approved — make sure the payload matches what was approved, so an
    // approval for one part cannot be used to slip in a different one.
    const approved = request.newPart || {};
    const submitted = req.body.newPart || {};
    const same = ["itemDescription", "companyCode", "category", "partTypeBatchNo"].every(
      (f) => String(approved[f] || "").trim() === String(submitted[f] || "").trim()
    );
    if (!same) {
      return res.status(403).json({
        message: "The part details do not match what was approved. Raise a fresh approval request.",
      });
    }

    req.partApprovalRequest = request;
    return next();
  } catch (err) {
    return res.status(500).json({ message: err.message || "Approval check failed" });
  }
}
