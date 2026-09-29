/*
  THE central utility for "upload a document, have AI pre-fill the form
  fields, let the person review/edit before saving" — meant to be called
  from every upload flow on the site (tax invoices, PO/PI, vendor docs,
  and anything added later), not re-implemented per screen.

  How a screen uses this:
    1. Define what fields you want out of the document — a plain array of
       { name, description, type? }. This is the ONLY thing that changes
       per document type; nothing in this file needs editing to support a
       new upload screen.
    2. Call extractDocumentFields({ buffer, mimeType, fileName, fields })
       with the just-uploaded file (already in memory — see
       middleware/upload.js) and that field list.
    3. Get back { fields: {...}, modelUsed }. Hand `fields` to the
       frontend as pre-fill values for an editable form — this utility
       never writes to the database itself, and nothing here should be
       treated as final/authoritative until a person has looked at it.

  Provider: OpenRouter (one OpenAI-compatible endpoint, many providers).
  Reliability: a chain of fallback models (config/aiConfig.js) is tried in
  order; the first one that returns valid, well-formed JSON wins. A
  provider outage, rate limit, or garbled reply just moves to the next
  model instead of failing the whole request.

  Cost: every model in the default chain is one of OpenRouter's `:free`
  models, and documents are always sent as image_url blocks (see
  renderAsImageDataUrls below) rather than via OpenRouter's `file-parser`
  plugin — that plugin (used for native PDF/file uploads) requires the
  account to hold at least $0.50 of balance, which defeats the point of
  using free models. Rendering the PDF to page images ourselves and
  sending those avoids that requirement entirely, and free vision models
  like Nemotron VL are built for exactly this (multi-image document
  reading), so nothing is lost in practice for the invoices/POs this is
  used on.
*/
import { pdf as renderPdfPages } from "pdf-to-img";
import {
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODELS,
  OPENROUTER_SITE_URL,
  OPENROUTER_APP_NAME,
  AI_EXTRACT_TIMEOUT_MS,
  isAiExtractConfigured,
} from "../config/aiConfig.js";

export class AiExtractionError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = "AiExtractionError";
    this.attempts = attempts; // [{ model, error }] — every model tried, and why it failed
  }
}

const PDF_EXTS = [".pdf"];
const IMAGE_MIME_PREFIX = "image/";

// A tax invoice / PO is essentially never more than a handful of pages —
// capping this keeps a stray 40-page vendor catalogue attachment from
// blowing up the request size or the free model's context window.
const MAX_PDF_PAGES = 6;

const extOf = (fileName = "") => {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i).toLowerCase();
};

// Scans from a given "{" and returns the matching "}" index by tracking
// brace depth, while ignoring braces that appear inside JSON string
// literals (so a description field containing "{" doesn't throw off the
// count). Returns -1 if the object never closes.
const findMatchingBrace = (s, openIndex) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

// Strips ```json fences, <think>/<thinking> reasoning blocks some models
// emit before their answer, and stray commentary — then pulls out the
// JSON object using balanced-brace matching (not just first-"{" to
// last-"}", which breaks if the model's surrounding prose or a reasoning
// block contains its own braces).
const extractJsonObject = (text) => {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  s = s.replace(/```(?:json)?/gi, "").trim();

  // Try every "{" in turn (not just the first) in case an earlier one
  // belongs to leftover reasoning text rather than the real answer.
  let searchFrom = 0;
  while (true) {
    const start = s.indexOf("{", searchFrom);
    if (start === -1) break;
    const end = findMatchingBrace(s, start);
    if (end !== -1) {
      const candidate = s.slice(start, end + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // fall through and try the next "{"
      }
    }
    searchFrom = start + 1;
  }
  return null;
};

// Like findMatchingBrace, but for either bracket pair ("{"/"}" or "["/"]").
const findMatchingClose = (s, openIndex) => {
  const open = s[openIndex];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const ITEM_KEYS = ["description", "partNumber", "quantity", "unitPrice", "amount"];
const ARRAY_KEY_ALIASES = ["items", "line_items", "lines", "rows"];
const looksLikeItems = (arr) =>
  arr.length > 0 && arr.every((x) => x && typeof x === "object" && !Array.isArray(x)) &&
  ITEM_KEYS.some((k) => k in arr[0]);

// Free models don't reliably follow "return exactly { lineItems: [...] }":
// some reply with a bare [...] array, some rename the key, some wrap it in
// prose or think out loud with the schema quoted back. Rather than insist on
// one shape, look at EVERY balanced {...} / [...] in the reply and take the
// list of item-like objects — the longest one, so a one-line schema example
// quoted in the model's reasoning never beats the real answer. Returns null
// if nothing usable is in the text; [] only if the model explicitly gave an
// empty list under the requested key.
const findItemArray = (text, key) => {
  if (!text) return null;
  let s = String(text);
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  s = s.replace(/```(?:json)?/gi, "");

  let best = null;
  let sawEmptyExplicit = false;
  const consider = (arr, explicitEmpty = false) => {
    if (Array.isArray(arr) && arr.length === 0 && explicitEmpty) sawEmptyExplicit = true;
    if (Array.isArray(arr) && looksLikeItems(arr) && (!best || arr.length > best.length)) best = arr;
  };

  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{" && s[i] !== "[") continue;
    const end = findMatchingClose(s, i);
    if (end === -1) continue;
    let parsed;
    try {
      parsed = JSON.parse(s.slice(i, end + 1));
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) consider(parsed);
    else if (parsed && typeof parsed === "object") {
      consider(parsed[key], true);
      for (const alias of ARRAY_KEY_ALIASES) consider(parsed[alias]);
    }
  }
  if (best) return best;
  return sawEmptyExplicit ? [] : null;
};

const buildFieldSchemaText = (fields) =>
  fields
    .map((f) => `- "${f.name}" (${f.type || "string"}): ${f.description || "no description given"}`)
    .join("\n");

const buildSystemPrompt = (fields) => `You are a data-extraction assistant reading a scanned/uploaded business
document (invoice, purchase order, vendor certificate, etc.), provided to
you as one or more page images.

Extract exactly these fields and return ONLY a single valid JSON object —
no markdown code fences, no commentary before or after it, nothing but the
JSON object itself:

${buildFieldSchemaText(fields)}

Rules:
- Use null for any field you cannot find or are not reasonably confident
  about — never invent or guess a value.
- Dates should be returned as ISO 8601 (YYYY-MM-DD) when a specific day is
  identifiable.
- Numbers should be plain numbers (no currency symbols or thousands
  separators).
- Return exactly the keys listed above, nothing extra.`;

const dataUrl = (mimeType, buffer) => `data:${mimeType};base64,${buffer.toString("base64")}`;

// Rasterizes a PDF into one image_url content block per page (PNG data
// URLs), entirely in-process — no OpenRouter plugin involved. An image
// that's already an image just becomes a single block, unchanged.
const renderAsImageDataUrls = async ({ buffer, mimeType, fileName }) => {
  const isImage = mimeType?.startsWith(IMAGE_MIME_PREFIX);
  const isPdf = mimeType === "application/pdf" || PDF_EXTS.includes(extOf(fileName));

  if (isImage) {
    return [dataUrl(mimeType, buffer)];
  }
  if (isPdf) {
    const pages = await renderPdfPages(buffer, { scale: 2 });
    const urls = [];
    let pageNo = 0;
    for await (const pageBuffer of pages) {
      pageNo += 1;
      urls.push(dataUrl("image/png", pageBuffer));
      if (pageNo >= MAX_PDF_PAGES) break;
    }
    return urls;
  }
  return null;
};

// Re-renders ONE page of a PDF at a given scale. Used on retry rounds: a phone
// photo of an invoice rasterised at scale 2 can be a multi-MB PNG, which free
// providers intermittently reject ("Provider returned error") or answer with an
// empty reply — the same page at a lower scale usually goes through.
const renderSinglePdfPage = async (buffer, pageNumber, scale) => {
  const doc = await renderPdfPages(buffer, { scale });
  const pageBuffer = await doc.getPage(pageNumber);
  return dataUrl("image/png", pageBuffer);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Errors that will NEVER succeed on a retry, on this page or any later one:
// retired models, models that can't be called through the plain chat API
// (e.g. the "inkling" models: "only available on agentic harnesses"), bad
// keys, etc. These are dropped from the chain for the rest of the request.
const PERMANENT_MODEL_ERROR =
  /No endpoints found|is not a valid model|model .* does not exist|only available on agentic harnesses|agentic harness|does not support image|no image input|not support(ed)? .*(image|vision)|Invalid API key|No auth credentials|User not found/i;

const callOpenRouter = async ({
  model,
  imageUrls,
  promptText,
  systemPrompt,
  timeoutMs,
  maxTokens = 2000,
  // When set, the reply must contain this key as an ARRAY, otherwise the
  // attempt counts as failed (so the next model in the chain is tried)
  // instead of being returned as if it were a usable answer. See the note
  // in extractInvoiceLineItems for why this matters.
  requireArrayKey = null,
}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        ...(OPENROUTER_SITE_URL ? { "HTTP-Referer": OPENROUTER_SITE_URL } : {}),
        "X-Title": OPENROUTER_APP_NAME,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        // We only want the final JSON, not a visible chain-of-thought —
        // and more importantly, hidden reasoning tokens are billed out of
        // this same max_tokens budget, so an enabled-by-default "thinking"
        // pass can consume the whole budget before the model ever writes
        // the answer, leaving `content` empty/truncated. Disabling it
        // keeps the full budget available for the actual JSON.
        reasoning: { enabled: false },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
              { type: "text", text: promptText },
            ],
          },
        ],
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      // OpenRouter's top-level message for an upstream failure is just
      // "Provider returned error" — the actual reason (rate limit, image too
      // large, provider overloaded) is in error.metadata.raw.
      let msg = body?.error?.message || `HTTP ${response.status}`;
      const meta = body?.error?.metadata;
      const rawDetail = meta?.raw ? (typeof meta.raw === "string" ? meta.raw : JSON.stringify(meta.raw)) : "";
      const detail = [meta?.provider_name, rawDetail && rawDetail.replace(/\s+/g, " ").slice(0, 200)]
        .filter(Boolean)
        .join(": ");
      msg = `${msg}${detail ? ` [${detail}]` : ""} (HTTP ${response.status})`;
      throw new Error(msg);
    }

    const message = body?.choices?.[0]?.message;
    const finishReason = body?.choices?.[0]?.finish_reason;
    // Say WHY a reply was unusable — an empty reply, a token cut-off and a
    // chatty non-JSON answer all look identical otherwise, and each needs a
    // different fix.
    const describeReply = () => {
      const raw = String(message?.content || message?.reasoning || "").replace(/\s+/g, " ").trim();
      return `finish_reason=${finishReason || "?"}, ${raw.length} chars${raw ? `, starts: "${raw.slice(0, 80)}"` : ""}`;
    };

    if (requireArrayKey) {
      // Some providers still route output to `reasoning` even with
      // reasoning disabled, so try `content` first and fall back to it.
      const arr = findItemArray(message?.content, requireArrayKey) ?? findItemArray(message?.reasoning, requireArrayKey);
      if (arr) return { [requireArrayKey]: arr };
      // A reply cut off by the token limit is unbalanced JSON, so nothing
      // balanced (or only a fragment) is found — that used to be read as
      // "no line items" instead of as a failed attempt.
      throw new Error(
        finishReason === "length"
          ? `Reply was cut off by the token limit before the "${requireArrayKey}" list finished (${describeReply()})`
          : `Reply had no "${requireArrayKey}" list (${describeReply()})`
      );
    }

    const parsed = extractJsonObject(message?.content) || extractJsonObject(message?.reasoning);
    if (!parsed) throw new Error(`Model reply wasn't a parseable JSON object (${describeReply()})`);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * @param {Object} opts
 * @param {Buffer} opts.buffer        Raw file bytes (already in memory — see middleware/upload.js)
 * @param {string} opts.mimeType      e.g. "application/pdf", "image/jpeg"
 * @param {string} [opts.fileName]    Original filename, used for extension sniffing
 * @param {Array<{name:string, description?:string, type?:string}>} opts.fields
 *   The fields to extract. This is the only thing a new upload screen needs
 *   to define — everything else in this file is generic.
 * @returns {Promise<{ fields: Object, modelUsed: string }>}
 */
export async function extractDocumentFields({ buffer, mimeType, fileName, fields }) {
  if (!isAiExtractConfigured()) {
    throw new AiExtractionError(
      "AI document extraction isn't configured yet — set OPENROUTER_API_KEY in the backend .env",
      []
    );
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new AiExtractionError("No fields were specified to extract", []);
  }

  let imageUrls;
  try {
    imageUrls = await renderAsImageDataUrls({ buffer, mimeType, fileName });
  } catch (err) {
    throw new AiExtractionError(`Couldn't read this file as an image/PDF: ${err.message}`, []);
  }
  if (!imageUrls) {
    throw new AiExtractionError(
      `Unsupported file type for AI extraction: ${mimeType || extOf(fileName) || "unknown"} (images and PDFs only)`,
      []
    );
  }

  const systemPrompt = buildSystemPrompt(fields);
  const attempts = [];

  for (const model of OPENROUTER_MODELS) {
    try {
      const parsed = await callOpenRouter({
        model,
        imageUrls,
        promptText: "Extract the fields as instructed and return only the JSON object.",
        systemPrompt,
        timeoutMs: AI_EXTRACT_TIMEOUT_MS,
      });
      return { fields: parsed, modelUsed: model };
    } catch (err) {
      attempts.push({ model, error: err.message });
      // fall through to the next model in the chain
    }
  }

  throw new AiExtractionError(
    `Every configured model failed to extract this document (tried: ${attempts
      .map((a) => `${a.model} — ${a.error}`)
      .join("; ")})`,
    attempts
  );
}

/*
  Sibling of extractDocumentFields, for the one case that isn't "a handful
  of scalar fields": reading every line item off an invoice (part number,
  description, quantity, unit price) as an array, so it can be matched
  line-by-line against what was actually entered into stock — see
  controllers/taxInvoiceController.js (getTaxInvoiceLineMatch) and
  utils/embeddings.js for the matching side.

  Same provider/fallback machinery as extractDocumentFields (OpenRouter,
  free model chain, PDF→image handling) — only the prompt and expected
  shape differ, so it's kept in this file rather than duplicated.
*/
const LINE_ITEMS_SYSTEM_PROMPT = `You are a data-extraction assistant reading a scanned/uploaded vendor tax
invoice / bill, provided to you as ONE page image (invoices often run over
several pages and you are given them one at a time, with the item numbers
S.N. carrying on from one page to the next). Read every line item in the
item table on this page (ignore header/footer info like billing address, tax
summary rows, and totals). At the foot of a page there may be a
carry-forward total ("Totals c/o", "c/f") and at the top of the next page the
same figure again ("b/d", "b/f", "brought down"): those are subtotals, not
items, so never return them as line items. The LAST page usually also carries
a tax / totals block under the item table ("Add : IGST", "CGST", "SGST",
"Rounded Off", "Grand Total", an HSN-wise tax summary table, bank details):
none of that is a line item either — only rows with a serial number S.N. and a
goods description are items.

Return ONLY a single valid JSON object — no markdown code fences, no
commentary before or after it — written compactly (no indentation or blank
lines, so a long invoice isn't cut off) of the shape:

{ "lineItems": [
  {
    "partNumber": string | null,   // manufacturer/vendor part number or item code, if printed
    "description": string,          // the item description text as printed
    "quantity": number | null,      // quantity for this line
    "unitPrice": number | null,     // per-unit rate, plain number, no currency symbol
    "amount": number | null         // this line's total amount, plain number
  }
]}

Rules:
- One array entry per distinct line item row. Do not merge or split rows.
- Use null for any value you cannot find or are not reasonably confident
  about — never invent or guess a value.
- Numbers must be plain numbers (no currency symbols or thousands separators).
- If this page has no line-item rows, return { "lineItems": [] }.`;

// Output budget PER PAGE. A page holds ~20-25 lines at ~50 tokens of JSON each,
// and reasoning-style free models also spend part of this budget "thinking" —
// so the 2000 the scalar-field extraction uses is too small. Override with
// AI_LINE_ITEMS_MAX_TOKENS in .env.
const LINE_ITEMS_MAX_TOKENS = Number(process.env.AI_LINE_ITEMS_MAX_TOKENS) || 4000;

// How many passes through the whole model chain a single page gets before we
// give up on it, the pause (ms) before rounds 2 and 3, and the PDF render
// scale used on those later rounds (first round uses scale 2, see
// renderAsImageDataUrls). Override rounds with AI_LINE_ITEMS_ROUNDS.
const LINE_ITEMS_ROUNDS = Math.max(1, Number(process.env.AI_LINE_ITEMS_ROUNDS) || 3);
const ROUND_BACKOFF_MS = [3000, 8000];
const RETRY_RENDER_SCALES = [1.5, 1.1];

// Carry-forward / subtotal rows a model may still emit despite the prompt.
const NON_ITEM_ROW =
  /^\s*(b\/?[df]\b|c\/?[of]\b|totals?\b|sub\s*-?total|brought|carried|add\s*:|less\s*:|(i|c|s)gst\b|round(ed)?\s*off|grand\s*total|net\s*(amount|total|payable)|amount\s*in\s*words)/i;

// Models sometimes hand numbers back as strings ("1,460.00") which the
// schema's Number fields would reject — coerce, or null if it isn't numeric.
const toNumber = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[,\s₹]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const cleanLineItems = (items) =>
  items
    .filter((it) => {
      if (!it || typeof it !== "object") return false;
      const desc = String(it.description ?? "").trim();
      if (!desc && !it.partNumber) return false;
      return !NON_ITEM_ROW.test(desc);
    })
    .map((it) => ({
      partNumber: it.partNumber == null || it.partNumber === "" ? null : String(it.partNumber),
      description: String(it.description ?? "").trim(),
      quantity: toNumber(it.quantity),
      unitPrice: toNumber(it.unitPrice),
      amount: toNumber(it.amount),
    }));

export async function extractInvoiceLineItems({ buffer, mimeType, fileName }) {
  if (!isAiExtractConfigured()) {
    throw new AiExtractionError(
      "AI document extraction isn't configured yet — set OPENROUTER_API_KEY in the backend .env",
      []
    );
  }

  let imageUrls;
  try {
    imageUrls = await renderAsImageDataUrls({ buffer, mimeType, fileName });
  } catch (err) {
    throw new AiExtractionError(`Couldn't read this file as an image/PDF: ${err.message}`, []);
  }
  if (!imageUrls) {
    throw new AiExtractionError(
      `Unsupported file type for AI extraction: ${mimeType || extOf(fileName) || "unknown"} (images and PDFs only)`,
      []
    );
  }

  // One request PER PAGE rather than every page in a single request. A
  // long invoice (53 lines over 3 pages) as one request needs a big reply
  // that free models routinely cut off, garble or time out on, and several
  // page images at once is where free vision models are weakest; a single
  // page is ~20 lines and one image, which they handle reliably.
  //
  // Free models fail TRANSIENTLY all the time (upstream 5xx, rate limits,
  // empty replies on a large image), so a page is only given up on after
  // several ROUNDS through the model chain, with a growing pause between
  // rounds and a smaller rendering of the page on the later ones. Pages
  // already read are kept — only the failing page is retried.
  const isPdf = mimeType === "application/pdf" || PDF_EXTS.includes(extOf(fileName));
  const attempts = [];
  const deadModels = new Set(); // permanently unusable — never retried
  const modelsUsed = [];
  const lineItems = [];
  let preferred = null; // the model that last worked goes first on the next page

  for (let p = 0; p < imageUrls.length; p++) {
    let pageItems = null;

    for (let round = 0; round < LINE_ITEMS_ROUNDS && !pageItems; round++) {
      const liveModels = OPENROUTER_MODELS.filter((m) => !deadModels.has(m));
      if (liveModels.length === 0) break; // nothing left worth calling

      if (round > 0) await sleep(ROUND_BACKOFF_MS[round - 1] ?? 8000);

      // Rounds after the first: same page, smaller image.
      let pageImage = imageUrls[p];
      if (round > 0 && isPdf) {
        try {
          pageImage = await renderSinglePdfPage(buffer, p + 1, RETRY_RENDER_SCALES[round - 1] ?? 1);
        } catch {
          // keep the original rendering if a re-render isn't possible
        }
      }

      const order =
        preferred && liveModels.includes(preferred)
          ? [preferred, ...liveModels.filter((m) => m !== preferred)]
          : liveModels;

      for (const model of order) {
        try {
          const parsed = await callOpenRouter({
            model,
            imageUrls: [pageImage],
            promptText: `This is page ${p + 1} of ${imageUrls.length}. Extract the line items as instructed and return only the JSON object.`,
            systemPrompt: LINE_ITEMS_SYSTEM_PROMPT,
            timeoutMs: AI_EXTRACT_TIMEOUT_MS,
            maxTokens: LINE_ITEMS_MAX_TOKENS,
            requireArrayKey: "lineItems",
          });
          pageItems = cleanLineItems(parsed.lineItems);
          preferred = model;
          if (!modelsUsed.includes(model)) modelsUsed.push(model);
          break;
        } catch (err) {
          attempts.push({ model, page: p + 1, round: round + 1, error: err.message });
          if (PERMANENT_MODEL_ERROR.test(err.message)) deadModels.add(model);
        }
      }
    }

    if (!pageItems) {
      const summary = [...new Map(
        attempts.filter((a) => a.page === p + 1).map((a) => [`${a.model}|${a.error}`, a])
      ).values()]
        .map((a) => `${a.model}${deadModels.has(a.model) ? " (unusable, skipped)" : ""} — ${a.error}`)
        .join("; ");
      throw new AiExtractionError(
        `Couldn't read page ${p + 1} of ${imageUrls.length} of this invoice — every configured model failed on it after ${LINE_ITEMS_ROUNDS} rounds (${summary})`,
        attempts
      );
    }
    // Remember which page of the PDF each row came from (1-based), so the UI
    // can group the invoice's lines page-wise.
    lineItems.push(...pageItems.map((it) => ({ ...it, page: p + 1 })));
  }

  // A page with no rows is fine (e.g. a totals-only last page), but an
  // invoice with none at all is a failed read, not a real answer — surface
  // an error rather than a silent empty result that then gets cached.
  if (lineItems.length === 0) {
    throw new AiExtractionError(
      "The models replied but found no line items on any page of this invoice — try again, or check the file is a clear scan",
      attempts
    );
  }
  return { lineItems, modelUsed: modelsUsed.join(", ") };
}