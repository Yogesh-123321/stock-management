/*
  Shared bookkeeping for the free AI sources (Gemini, OpenRouter) used by
  utils/aiDocumentExtract.js and utils/embeddings.js.

  Why it exists: free tiers run out. Without this, every request after the
  daily limit is hit would still walk the whole model chain, wait for each
  model to fail, and only then report an error — which is what made a scan
  take minutes. Now:

    - an error is classified (quota / permanent / transient)
    - a source that hit its limit (or can never work, e.g. a retired model
      or a bad key) is put on a cooldown and skipped instantly until it ends
    - per-source counters are kept so admins can see usage (GET /api/ai/usage)

  State is in memory only (resets on a server restart), which is fine: the
  worst case after a restart is one wasted request to rediscover a limit.
*/

const cooldowns = new Map(); // key -> { until, reason }
const usage = new Map(); // key -> { day, ok, failed, lastError, lastAt }

const MIN = 60 * 1000;

// Errors that will never succeed on a retry: retired/unknown models, models
// that can't take images, bad or missing keys.
const PERMANENT_RE =
  /No endpoints found|is not a valid model|model .* does not exist|only available on agentic harnesses|agentic harness|does not support image|no image input|not support(ed)? .*(image|vision)|Invalid API key|API key not valid|API_KEY_INVALID|No auth credentials|User not found|PERMISSION_DENIED|NOT_FOUND|is not found for API version|not supported for generateContent/i;
const QUOTA_RE =
  /RESOURCE_EXHAUSTED|rate.?limit|quota|too many requests|free-models-per-day|exceeded your current/i;
const DAILY_RE = /per.?day|PerDay|daily|free-models-per-day|requests per day/i;

export class ProviderError extends Error {
  constructor(message, { kind = "transient", cooldownMs = 0, scope = "model" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind; // "quota" | "permanent" | "transient"
    this.cooldownMs = cooldownMs;
    this.scope = scope; // "model" | "provider" — what the cooldown applies to
  }
}

/** Turns an HTTP failure into a ProviderError with the right cooldown. */
export function classifyHttpError(status, message, rawDetail = "") {
  const text = `${message} ${rawDetail}`;
  if (status === 401 || status === 403 || PERMANENT_RE.test(text) || status === 404) {
    // 403 can also be a regional/quota block, but retrying within the hour
    // won't help either way.
    return new ProviderError(message, { kind: "permanent", cooldownMs: 6 * 60 * MIN });
  }
  if (status === 429 || QUOTA_RE.test(text)) {
    const daily = DAILY_RE.test(text);
    return new ProviderError(message, {
      kind: "quota",
      // A per-minute limit clears quickly; a daily one won't until the
      // provider's reset, so back off for a good while instead of hammering.
      cooldownMs: daily ? 30 * MIN : 45 * 1000,
      // OpenRouter's daily cap is account-wide, across every ":free" model.
      scope: /free-models-per-day/i.test(text) ? "provider" : "model",
    });
  }
  return new ProviderError(message, { kind: "transient" });
}

export const isCoolingDown = (key) => {
  const c = cooldowns.get(key);
  if (!c) return false;
  if (Date.now() >= c.until) {
    cooldowns.delete(key);
    return false;
  }
  return true;
};

export const coolDown = (key, ms, reason = "") => {
  if (ms > 0) cooldowns.set(key, { until: Date.now() + ms, reason });
};

const today = () => new Date().toISOString().slice(0, 10);

export const recordUsage = (key, ok, errorMessage = "") => {
  let u = usage.get(key);
  if (!u || u.day !== today()) u = { day: today(), ok: 0, failed: 0, lastError: "", lastAt: null };
  if (ok) u.ok += 1;
  else {
    u.failed += 1;
    u.lastError = String(errorMessage).slice(0, 300);
  }
  u.lastAt = new Date().toISOString();
  usage.set(key, u);
};

/** Earliest moment any of the given keys is usable again (ms epoch), or null. */
export const soonestRecovery = (keys) => {
  const times = keys.map((k) => cooldowns.get(k)?.until).filter((t) => t && t > Date.now());
  return times.length ? Math.min(...times) : null;
};

export const getAiUsage = () => ({
  day: today(),
  sources: [...new Set([...usage.keys(), ...cooldowns.keys()])].sort().map((key) => {
    const u = usage.get(key);
    const c = cooldowns.get(key);
    const cooling = c && Date.now() < c.until;
    return {
      source: key,
      requestsOkToday: u && u.day === today() ? u.ok : 0,
      requestsFailedToday: u && u.day === today() ? u.failed : 0,
      lastError: u?.lastError || "",
      lastAt: u?.lastAt || null,
      pausedUntil: cooling ? new Date(c.until).toISOString() : null,
      pausedBecause: cooling ? c.reason : "",
    };
  }),
});

/**
 * Runs `fn` for one source unless it's cooling down. Returns its result, or
 * null on failure (the failure is recorded in `attempts`, counted, and — for
 * quota/permanent errors — puts the source on cooldown so the next request
 * skips it instantly).
 */
export async function guarded({ modelKey, providerKey }, attempts, fn) {
  if (isCoolingDown(providerKey) || isCoolingDown(modelKey)) {
    attempts.push({ model: modelKey, error: "skipped — paused after an earlier limit/error" });
    return null;
  }
  try {
    const result = await fn();
    recordUsage(modelKey, true);
    return result;
  } catch (err) {
    recordUsage(modelKey, false, err.message);
    attempts.push({ model: modelKey, error: err.message });
    if (err instanceof ProviderError && err.cooldownMs > 0) {
      coolDown(err.scope === "provider" ? providerKey : modelKey, err.cooldownMs, err.message.slice(0, 160));
    }
    return null;
  }
}