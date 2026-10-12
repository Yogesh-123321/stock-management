/*
  Text embeddings, via the same OpenRouter account/key as
  utils/aiDocumentExtract.js (config/aiConfig.js). Used to semantically
  match free-text descriptions against each other — right now that's just
  tax-invoice line items vs. stock entries (see getTaxInvoiceLineMatch in
  controllers/taxInvoiceController.js), but any future "does this text
  roughly mean the same thing as that text" need (e.g. part-suggestion
  search) can reuse this instead of re-implementing it per screen.

  Deliberately no fallback-model chain here (unlike the extraction chain):
  embeddings just need one decent, cheap model, and mixing vectors from two
  different embedding models would break the cosine-similarity comparison
  anyway, so a "fallback" wouldn't be safe to use even if we had one.
*/
import {
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  OPENROUTER_SITE_URL,
  OPENROUTER_APP_NAME,
  OPENROUTER_EMBEDDING_MODEL,
  AI_EXTRACT_TIMEOUT_MS,
  GEMINI_API_KEY,
  GEMINI_BASE_URL,
  GEMINI_EMBEDDING_MODEL,
  isAiExtractConfigured,
  isGeminiConfigured,
  isOpenRouterConfigured,
} from "../config/aiConfig.js";
import { classifyHttpError, coolDown, isCoolingDown, recordUsage, ProviderError } from "./aiQuota.js";

export class EmbeddingError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmbeddingError";
  }
}

// The embeddings endpoint hard-rejects a single request with more than
// this many inputs ("Too big: expected array to have <=128 items") — seen
// in practice once the duplicate-parts AI check ran on a few hundred
// parts at once. Batching below keeps every caller working regardless of
// how many texts it passes in one call.
const MAX_INPUTS_PER_REQUEST = 128;

/**
 * @param {string[]} texts — non-empty strings, in order. Order of the
 *   returned array matches the order of `texts`. Internally split into
 *   batches of MAX_INPUTS_PER_REQUEST if needed — callers don't need to
 *   chunk their input themselves.
 * @returns {Promise<number[][]>}
 */
export async function getEmbeddings(texts) {
  if (!isAiExtractConfigured()) {
    throw new EmbeddingError("AI matching isn't configured yet — set GEMINI_API_KEY (and/or OPENROUTER_API_KEY) in the backend .env");
  }
  const clean = (texts || []).map((t) => (t == null ? "" : String(t).trim()));
  if (clean.length === 0) return [];

  // Gemini first (free tier). Every text in ONE call comes from the SAME
  // model — vectors from different embedding models can't be compared — so
  // the whole call falls back to OpenRouter together if Gemini fails.
  const geminiKey = `gemini:${GEMINI_EMBEDDING_MODEL}`;
  let geminiError = null;
  if (isGeminiConfigured() && !isCoolingDown(geminiKey) && !isCoolingDown("gemini")) {
    try {
      const vectors = await getGeminiEmbeddings(clean);
      recordUsage(geminiKey, true);
      return vectors;
    } catch (err) {
      geminiError = err;
      recordUsage(geminiKey, false, err.message);
      if (err instanceof ProviderError && err.cooldownMs > 0) coolDown(geminiKey, err.cooldownMs, err.message.slice(0, 160));
    }
  }
  if (!isOpenRouterConfigured()) {
    throw new EmbeddingError(geminiError ? geminiError.message : "AI matching is paused — the free embedding limit was reached, try again later");
  }

  const vectors = [];
  for (let start = 0; start < clean.length; start += MAX_INPUTS_PER_REQUEST) {
    const batch = clean.slice(start, start + MAX_INPUTS_PER_REQUEST);
    const batchVectors = await getEmbeddingsBatch(batch);
    vectors.push(...batchVectors);
  }
  return vectors;
}

const GEMINI_EMBED_BATCH = 100; // batchEmbedContents accepts up to 100 texts

async function getGeminiEmbeddings(clean) {
  const vectors = [];
  for (let start = 0; start < clean.length; start += GEMINI_EMBED_BATCH) {
    const batch = clean.slice(start, start + GEMINI_EMBED_BATCH);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_EXTRACT_TIMEOUT_MS);
    try {
      const response = await fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_EMBEDDING_MODEL)}:batchEmbedContents`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          requests: batch.map((t) => ({
            model: `models/${GEMINI_EMBEDDING_MODEL}`,
            content: { parts: [{ text: t.length ? t : " " }] },
            taskType: "SEMANTIC_SIMILARITY",
          })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw classifyHttpError(response.status, `${body?.error?.message || `HTTP ${response.status}`} (HTTP ${response.status})`, JSON.stringify(body?.error?.details || "").slice(0, 600));
      }
      const out = body?.embeddings;
      if (!Array.isArray(out) || out.length !== batch.length || out.some((e) => !Array.isArray(e?.values))) {
        throw new Error("Gemini embedding response didn't match the number of inputs sent");
      }
      vectors.push(...out.map((e) => e.values));
    } catch (err) {
      if (err?.name === "AbortError") throw new Error(`Gemini embeddings timed out after ${Math.round(AI_EXTRACT_TIMEOUT_MS / 1000)}s`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  return vectors;
}

// Does the actual API call for one batch (<=MAX_INPUTS_PER_REQUEST texts).
async function getEmbeddingsBatch(clean) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_EXTRACT_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        ...(OPENROUTER_SITE_URL ? { "HTTP-Referer": OPENROUTER_SITE_URL } : {}),
        "X-Title": OPENROUTER_APP_NAME,
      },
      body: JSON.stringify({
        model: OPENROUTER_EMBEDDING_MODEL,
        // Blank strings aren't meaningful to embed and some providers reject
        // them outright — swap in a single space so the array positions
        // still line up 1:1 with the input without a failed request.
        input: clean.map((t) => (t.length ? t : " ")),
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new EmbeddingError(body?.error?.message || `HTTP ${response.status}`);
    }

    const vectors = body?.data;
    if (!Array.isArray(vectors) || vectors.length !== clean.length) {
      throw new EmbeddingError("Embedding response didn't match the number of inputs sent");
    }
    // Provider returns entries with an `index` — sort defensively rather than
    // trusting response order to already match request order.
    return vectors
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((v) => v.embedding);
  } finally {
    clearTimeout(timer);
  }
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}