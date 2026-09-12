/*
  Config for the "auto-fill from uploaded document" feature.

  Uses OpenRouter (https://openrouter.ai) as the single API surface — it's
  OpenAI-compatible and gives access to many providers/models through one
  key, which is what makes the multi-model fallback chain below possible
  without juggling several vendors' SDKs.

  Everything here comes from env vars so nothing about which models are
  used, or the key itself, is hard-coded. Add these to backend/.env:

    OPENROUTER_API_KEY=sk-or-...
    # Optional — comma-separated, tried in order until one succeeds. Defaults
    # to free (":free") vision models only — see the note below.
    OPENROUTER_MODELS=nvidia/nemotron-nano-12b-v2-vl:free,moonshotai/kimi-vl-a3b-thinking:free,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
    # Optional — cosmetic, shows up in OpenRouter's own dashboard/leaderboards:
    OPENROUTER_SITE_URL=https://your-deployment.example.com
    OPENROUTER_APP_NAME=Inventory Platform
    # Optional — per-model call timeout in ms before falling back to the next one:
    AI_EXTRACT_TIMEOUT_MS=45000
    # Optional — used for tax-invoice line-item matching (utils/embeddings.js).
    # Defaults to a free embedding model too:
    OPENROUTER_EMBEDDING_MODEL=liquid/lfm-2.5-embedding-350m:free

  A note on "free": every default model below has an OpenRouter ":free"
  suffix, so token usage costs $0 — but OpenRouter's own free-tier request
  limits still apply (20 requests/minute always; 50/day per account until
  you've bought $10 of credits at least once, after which it's 1,000/day —
  see https://openrouter.ai/docs, "Rate Limits"). If a free model gets
  retired or is temporarily overloaded, swap OPENROUTER_MODELS for whatever
  OpenRouter currently lists as free at https://openrouter.ai/models
  (filter: Prompt pricing → Free) — just make sure any replacement supports
  image input, since documents are sent as page images (see
  utils/aiDocumentExtract.js), not as OpenRouter's paid "file" uploads.
*/

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Tried in order — the first model that returns a usable JSON answer wins.
// A model erroring, timing out, being rate-limited, or replying with
// something that isn't valid JSON all fall through to the next one, so one
// provider having a bad day doesn't take the whole feature down. All three
// are free (":free") vision-capable models, so this whole feature runs at
// $0 in token cost by default.
const DEFAULT_MODEL_CHAIN = [
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "moonshotai/kimi-vl-a3b-thinking:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
];

export const OPENROUTER_MODELS = (process.env.OPENROUTER_MODELS || DEFAULT_MODEL_CHAIN.join(","))
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

export const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || "";
export const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || "Inventory Platform";

export const AI_EXTRACT_TIMEOUT_MS = Number(process.env.AI_EXTRACT_TIMEOUT_MS) || 45000;

export const isAiExtractConfigured = () => Boolean(OPENROUTER_API_KEY);

// Used for semantic matching (e.g. tax-invoice line items vs. stock entries
// entered against them — see utils/embeddings.js). Kept as its own env var
// since an embedding model is a different kind of thing from the chat-style
// extraction chain above and there's no fallback list — one model is plenty
// for cosine-similarity matching, so we don't pay for a retry chain here.
// Free (":free") by default, same reasoning as the chat model chain above.
export const OPENROUTER_EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || "liquid/lfm-2.5-embedding-350m:free";