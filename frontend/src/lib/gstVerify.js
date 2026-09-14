import api from "@/lib/api";

/**
 * Calls the backend's GST verification endpoint for a single GSTIN.
 * Backend never throws for an invalid/unverifiable GSTIN — it always
 * responds 200 with { valid, verified, message, ...details } — so callers
 * just branch on those flags. Network/auth failures still reject.
 */
export async function verifyGstin(gstin) {
  const { data } = await api.get(`/gst/verify/${encodeURIComponent(gstin)}`);
  return data;
}