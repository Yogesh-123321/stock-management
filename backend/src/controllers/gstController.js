import { lookupGstin, validateGstinFormat } from "../utils/gstVerify.js";

/**
 * GET /api/gst/verify/:gstin
 * Format/checksum-validates the GSTIN and, if a provider is configured
 * (see utils/gstVerify.js), fetches the registered legal name, trade name
 * and address so the frontend can flag a mismatch against what was typed
 * into the company name / address fields.
 */
export async function verifyGstin(req, res) {
  const gstin = String(req.params.gstin || "").trim().toUpperCase();

  const format = validateGstinFormat(gstin);
  if (!format.valid) {
    const messages = {
      empty: "Enter a GST number",
      format: "That doesn't look like a valid 15-character GSTIN",
      checksum: "That GSTIN's checksum digit doesn't match — double-check for a typo",
    };
    return res.status(200).json({
      valid: false,
      verified: false,
      message: messages[format.reason] || "Invalid GSTIN",
    });
  }

  const result = await lookupGstin(gstin);
  if (!result.verified) {
    const messages = {
      not_configured: "Live GST lookup isn't set up yet — format is valid though",
      provider_no_match: "Format is valid, but this GSTIN wasn't found in registry records",
      provider_timeout: "GST registry lookup timed out — format is valid, try again",
      provider_unreachable: "Couldn't reach the GST verification service — format is valid",
    };
    return res.status(200).json({
      valid: true,
      verified: false,
      stateName: format.stateName,
      stateCode: format.stateCode,
      panFromGstin: format.panFromGstin,
      message: messages[result.reason] || "Could not verify against the GST registry",
    });
  }

  return res.status(200).json({
    valid: true,
    verified: true,
    stateName: format.stateName,
    stateCode: format.stateCode,
    panFromGstin: format.panFromGstin,
    legalName: result.details.legalName,
    tradeName: result.details.tradeName,
    address: result.details.address,
    status: result.details.status,
    constitution: result.details.constitution,
    registrationDate: result.details.registrationDate,
  });
}