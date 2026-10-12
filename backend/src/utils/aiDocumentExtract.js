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

  Providers, in order: Google Gemini first (reads the WHOLE PDF in one
  request — fast, one request per document), then OpenRouter's free models
  as the fallback (page images, a few pages in parallel). A source that is
  out of quota is skipped instantly until it recovers — see aiQuota.js.

  OpenRouter (one OpenAI-compatible endpoint, many providers).
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
  AI_TOTAL_DEADLINE_MS,
  GEMINI_API_KEY,
  GEMINI_BASE_URL,
  GEMINI_MODELS,
  isAiExtractConfigured,
  isGeminiConfigured,
  isOpenRouterConfigured,
} from "../config/aiConfig.js";
import { classifyHttpError, guarded, isCoolingDown, soonestRecovery } from "./aiQuota.js";

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
you as a PDF or one or more page images.

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
      throw classifyHttpError(response.status, msg, rawDetail);
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
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

// ---- Gemini ------------------------------------------------------------
// Gemini's inline-data request limit is 20MB in total and base64 adds ~33%.
const GEMINI_MAX_INLINE_BYTES = 14 * 1024 * 1024;

// Sends the file itself (PDF or image) — no page rendering — and returns the
// parsed JSON. Same contract as callOpenRouter: with requireArrayKey the reply
// must contain that list; otherwise a JSON object.
const callGemini = async ({
  model,
  buffer,
  mimeType,
  systemPrompt,
  promptText,
  timeoutMs,
  maxTokens = 4000,
  requireArrayKey = null,
}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const generationConfig = {
      temperature: 0,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    };
    // Extraction doesn't need the model to "think" first, and thinking costs
    // seconds and eats the output budget. 2.5 uses a token budget; the 3.x
    // models use a level. If a model rejects the setting we retry without it.
    const thinking = /2\.5-/i.test(model)
      ? { thinkingBudget: 0 }
      : /gemini-3/i.test(model)
        ? { thinkingLevel: "minimal" }
        : null;

    const send = (config) =>
      fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [{ inlineData: { mimeType, data: buffer.toString("base64") } }, { text: promptText }],
            },
          ],
          generationConfig: config,
        }),
      });

    let response = await send(thinking ? { ...generationConfig, thinkingConfig: thinking } : generationConfig);
    if (response.status === 400 && thinking) {
      const peek = await response.clone().json().catch(() => null);
      if (/think/i.test(peek?.error?.message || "")) response = await send(generationConfig);
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const msg = `${body?.error?.message || `HTTP ${response.status}`} (HTTP ${response.status})`;
      throw classifyHttpError(response.status, msg, JSON.stringify(body?.error?.details || "").slice(0, 600));
    }

    const candidate = body?.candidates?.[0];
    const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
    const finishReason = candidate?.finishReason || body?.promptFeedback?.blockReason || "?";
    const describe = () => `finishReason=${finishReason}, ${text.length} chars`;

    if (requireArrayKey) {
      const arr = findItemArray(text, requireArrayKey);
      if (arr) return { [requireArrayKey]: arr };
      throw new Error(
        finishReason === "MAX_TOKENS"
          ? `Reply was cut off before the "${requireArrayKey}" list finished (${describe()})`
          : `Reply had no "${requireArrayKey}" list (${describe()})`
      );
    }
    const parsed = extractJsonObject(text);
    if (!parsed) throw new Error(`Model reply wasn't a parseable JSON object (${describe()})`);
    return parsed;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

// What kind of file this is, for choosing a route. null = unsupported.
const fileKind = ({ mimeType, fileName }) => {
  if (mimeType === "application/pdf" || PDF_EXTS.includes(extOf(fileName))) return { kind: "pdf", mime: "application/pdf" };
  if (mimeType?.startsWith(IMAGE_MIME_PREFIX)) return { kind: "image", mime: mimeType };
  return null;
};

const unsupportedError = ({ mimeType, fileName }) =>
  new AiExtractionError(
    `Unsupported file type for AI extraction: ${mimeType || extOf(fileName) || "unknown"} (images and PDFs only)`,
    []
  );

const notConfiguredError = () =>
  new AiExtractionError(
    "AI document extraction isn't configured yet — set GEMINI_API_KEY (and/or OPENROUTER_API_KEY) in the backend .env",
    []
  );

// Every configured model, across both providers, is paused (limit hit) — say
// so immediately instead of making the person wait through a doomed chain.
const allPausedError = (attempts) => {
  const keys = [
    ...(isGeminiConfigured() ? GEMINI_MODELS.map((m) => `gemini:${m}`) : []),
    ...(isOpenRouterConfigured() ? OPENROUTER_MODELS.map((m) => `openrouter:${m}`) : []),
    ...(isOpenRouterConfigured() ? ["openrouter"] : []),
  ];
  const back = soonestRecovery(keys);
  return new AiExtractionError(
    `The free AI sources are at their usage limit right now${
      back ? ` (retry after about ${new Date(back).toLocaleTimeString()})` : ""
    } — try again a little later, or enter the details by hand.`,
    attempts
  );
};

const anySourceAvailable = () =>
  (isGeminiConfigured() && GEMINI_MODELS.some((m) => !isCoolingDown(`gemini:${m}`))) ||
  (isOpenRouterConfigured() && !isCoolingDown("openrouter") && OPENROUTER_MODELS.some((m) => !isCoolingDown(`openrouter:${m}`)));

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
  if (!isAiExtractConfigured()) throw notConfiguredError();
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new AiExtractionError("No fields were specified to extract", []);
  }
  const kind = fileKind({ mimeType, fileName });
  if (!kind) throw unsupportedError({ mimeType, fileName });
  if (!anySourceAvailable()) throw allPausedError([]);

  const systemPrompt = buildSystemPrompt(fields);
  const promptText = "Extract the fields as instructed and return only the JSON object.";
  const attempts = [];
  const deadline = Date.now() + AI_TOTAL_DEADLINE_MS;
  const timeLeft = () => Math.max(1000, Math.min(AI_EXTRACT_TIMEOUT_MS, deadline - Date.now()));

  // 1. Gemini — the whole file in one request.
  if (isGeminiConfigured() && buffer.length <= GEMINI_MAX_INLINE_BYTES) {
    for (const model of GEMINI_MODELS) {
      if (Date.now() >= deadline) break;
      const parsed = await guarded({ modelKey: `gemini:${model}`, providerKey: "gemini" }, attempts, () =>
        callGemini({ model, buffer, mimeType: kind.mime, systemPrompt, promptText, timeoutMs: timeLeft(), maxTokens: 2000 })
      );
      if (parsed) return { fields: parsed, modelUsed: `gemini/${model}` };
    }
  }

  // 2. OpenRouter free models — page images.
  if (isOpenRouterConfigured() && Date.now() < deadline) {
    let imageUrls = null;
    try {
      imageUrls = await renderAsImageDataUrls({ buffer, mimeType, fileName });
    } catch (err) {
      attempts.push({ model: "render", error: `Couldn't read this file as an image/PDF: ${err.message}` });
    }
    if (imageUrls) {
      for (const model of OPENROUTER_MODELS) {
        if (Date.now() >= deadline) break;
        const parsed = await guarded({ modelKey: `openrouter:${model}`, providerKey: "openrouter" }, attempts, () =>
          callOpenRouter({ model, imageUrls, promptText, systemPrompt, timeoutMs: timeLeft() })
        );
        if (parsed) return { fields: parsed, modelUsed: model };
      }
    }
  }

  if (!attempts.some((a) => !/^skipped/.test(a.error))) throw allPausedError(attempts);
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
  controllers/taxInvoiceController.js (getTaxInvoiceLineMatch), the invoice-PDF
  stock import (controllers/stockImportController.js) and utils/embeddings.js.

  Speed: Gemini gets the whole PDF in ONE request (typically a few seconds).
  Only if that fails does the OpenRouter fallback run, one request per page
  with a few pages in parallel. The whole scan has a time budget
  (AI_TOTAL_DEADLINE_MS) and sources that are out of quota are skipped
  instantly, so a scan can't spin for minutes any more.
*/
const LINE_ITEMS_ITEM_SHAPE = `{ "lineItems": [
  {
    "partNumber": string | null,   // SHORT item code only (one word, no spaces), if one is printed in its own column
    "description": string,          // the item description text as printed
    "quantity": number | null,      // quantity for this line
    "unitPrice": number | null,     // per-unit rate, plain number, no currency symbol
    "amount": number | null         // this line's total amount, plain number__PAGE__
  }
]}`;

const LINE_ITEMS_FOOTER = `
At the foot of a page there may be a carry-forward total ("Totals c/o",
"c/f") and at the top of the next page the same figure again ("b/d", "b/f",
"brought down"): those are subtotals, not items, so never return them as
line items. The LAST page usually also carries a tax / totals block under
the item table ("Add : IGST", "CGST", "SGST", "Rounded Off", "Grand Total", an
HSN-wise tax summary table, bank details): none of that is a line item
either — only rows with a serial number S.N. and a goods description are
items.

Return ONLY a single valid JSON object — no markdown code fences, no
commentary before or after it — written compactly (no indentation or blank
lines, so a long invoice isn't cut off) of the shape:

__SHAPE__

Rules:
- One array entry per distinct line item row. Do not merge or split rows.
- "partNumber" is only a short code (no spaces). If the invoice has no separate
  code column, use null — NEVER put the description (or part of it) there.
- Use null for any value you cannot find or are not reasonably confident
  about — never invent or guess a value.
- Numbers must be plain numbers (no currency symbols or thousands separators).
- If there are no line-item rows, return { "lineItems": [] }.`;

const PAGE_PROMPT = `You are a data-extraction assistant reading a scanned/uploaded vendor tax
invoice / bill, provided to you as ONE page image (invoices often run over
several pages and you are given them one at a time, with the item numbers
S.N. carrying on from one page to the next). Read every line item in the
item table on this page (ignore header/footer info like billing address, tax
summary rows, and totals).
${LINE_ITEMS_FOOTER.replace("__SHAPE__", LINE_ITEMS_ITEM_SHAPE.replace("__PAGE__", ""))}`;

const WHOLE_DOC_PROMPT = `You are a data-extraction assistant reading a vendor tax invoice / bill, given
to you as a complete PDF or image (it may run over several pages, with the
item numbers S.N. carrying on from one page to the next). Read every line
item in the item table(s) across ALL pages (ignore header/footer info like
billing address, tax summary rows, and totals), in order.
${LINE_ITEMS_FOOTER.replace(
  "__SHAPE__",
  LINE_ITEMS_ITEM_SHAPE.replace("__PAGE__", ',\n    "page": number                  // 1-based page the row is on')
)}`;

// Output budgets. PER PAGE for OpenRouter (a page holds ~20-25 lines at ~50
// tokens of JSON each); the whole document for Gemini. Override with
// AI_LINE_ITEMS_MAX_TOKENS / AI_LINE_ITEMS_MAX_TOKENS_GEMINI in .env.
const LINE_ITEMS_MAX_TOKENS = Number(process.env.AI_LINE_ITEMS_MAX_TOKENS) || 4000;
const LINE_ITEMS_MAX_TOKENS_GEMINI = Number(process.env.AI_LINE_ITEMS_MAX_TOKENS_GEMINI) || 16000;

// OpenRouter fallback: passes through the model chain per page (default 2 —
// free models fail transiently a lot, but a third pass rarely helps and made
// scans crawl), the pause before round 2, the smaller PDF render used on it,
// and how many pages are read at once.
const LINE_ITEMS_ROUNDS = Math.max(1, Number(process.env.AI_LINE_ITEMS_ROUNDS) || 2);
const ROUND_BACKOFF_MS = [2000];
const RETRY_RENDER_SCALES = [1.3];
const PAGE_CONCURRENCY = Math.max(1, Number(process.env.AI_PAGE_CONCURRENCY) || 3);

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
    .map((it) => {
      const page = toNumber(it.page);
      return {
        partNumber: it.partNumber == null || it.partNumber === "" ? null : String(it.partNumber),
        description: String(it.description ?? "").trim(),
        quantity: toNumber(it.quantity),
        unitPrice: toNumber(it.unitPrice),
        amount: toNumber(it.amount),
        ...(page && page >= 1 ? { page: Math.floor(page) } : {}),
      };
    });

// Runs `worker(item, index)` over `items`, at most `limit` at a time.
const mapLimit = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
};

export async function extractInvoiceLineItems({ buffer, mimeType, fileName }) {
  if (!isAiExtractConfigured()) throw notConfiguredError();
  const kind = fileKind({ mimeType, fileName });
  if (!kind) throw unsupportedError({ mimeType, fileName });
  if (!anySourceAvailable()) throw allPausedError([]);

  const attempts = [];
  const deadline = Date.now() + AI_TOTAL_DEADLINE_MS;
  const timeLeft = () => Math.max(1000, Math.min(AI_EXTRACT_TIMEOUT_MS * 2, deadline - Date.now()));

  // 1. Gemini — whole document, one request.
  if (isGeminiConfigured() && buffer.length <= GEMINI_MAX_INLINE_BYTES) {
    for (const model of GEMINI_MODELS) {
      if (Date.now() >= deadline) break;
      const parsed = await guarded({ modelKey: `gemini:${model}`, providerKey: "gemini" }, attempts, () =>
        callGemini({
          model,
          buffer,
          mimeType: kind.mime,
          systemPrompt: WHOLE_DOC_PROMPT,
          promptText: "Extract all the line items as instructed and return only the JSON object.",
          timeoutMs: timeLeft(),
          maxTokens: LINE_ITEMS_MAX_TOKENS_GEMINI,
          requireArrayKey: "lineItems",
        })
      );
      if (!parsed) continue;
      const items = cleanLineItems(parsed.lineItems);
      if (items.length) {
        return { lineItems: items.map((it) => ({ ...it, page: it.page || 1 })), modelUsed: `gemini/${model}` };
      }
      attempts.push({ model: `gemini:${model}`, error: "replied with no line items" });
    }
  }

  // 2. OpenRouter free models — one request per page, a few pages at once.
  if (isOpenRouterConfigured() && Date.now() < deadline) {
    let imageUrls;
    try {
      imageUrls = await renderAsImageDataUrls({ buffer, mimeType, fileName });
    } catch (err) {
      attempts.push({ model: "render", error: `Couldn't read this file as an image/PDF: ${err.message}` });
    }

    if (imageUrls) {
      const isPdf = kind.kind === "pdf";
      const modelsUsed = [];
      const lineItems = [];
      let preferred = null; // the model that last worked goes first on the next page
      let failure = null;

      const readPage = async (_, p) => {
        if (failure) return [];
        let pageItems = null;

        for (let round = 0; round < LINE_ITEMS_ROUNDS && !pageItems && !failure; round++) {
          const liveModels = OPENROUTER_MODELS.filter(
            (m) => !isCoolingDown(`openrouter:${m}`) && !isCoolingDown("openrouter")
          );
          if (liveModels.length === 0) break; // everything paused — don't wait for nothing
          if (Date.now() >= deadline) break;
          if (round > 0) await sleep(ROUND_BACKOFF_MS[round - 1] ?? 2000);

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
            if (Date.now() >= deadline) break;
            const parsed = await guarded({ modelKey: `openrouter:${model}`, providerKey: "openrouter" }, attempts, () =>
              callOpenRouter({
                model,
                imageUrls: [pageImage],
                promptText: `This is page ${p + 1} of ${imageUrls.length}. Extract the line items as instructed and return only the JSON object.`,
                systemPrompt: PAGE_PROMPT,
                timeoutMs: timeLeft(),
                maxTokens: LINE_ITEMS_MAX_TOKENS,
                requireArrayKey: "lineItems",
              })
            );
            if (parsed) {
              pageItems = cleanLineItems(parsed.lineItems);
              preferred = model;
              if (!modelsUsed.includes(model)) modelsUsed.push(model);
              break;
            }
          }
        }

        if (!pageItems) {
          failure = failure || new Error(`page ${p + 1} of ${imageUrls.length}`);
          return [];
        }
        // Remember which page of the PDF each row came from (1-based).
        return pageItems.map((it) => ({ ...it, page: p + 1 }));
      };

      const perPage = await mapLimit(imageUrls, PAGE_CONCURRENCY, readPage);
      if (!failure) {
        lineItems.push(...perPage.flat());
        // A page with no rows is fine (e.g. a totals-only last page), but an
        // invoice with none at all is a failed read, not a real answer.
        if (lineItems.length > 0) return { lineItems, modelUsed: modelsUsed.join(", ") };
        attempts.push({ model: "openrouter", error: "replied with no line items on any page" });
      }
    }
  }

  if (!attempts.some((a) => !/^skipped/.test(a.error))) throw allPausedError(attempts);

  const summary = [...new Map(attempts.map((a) => [`${a.model}|${a.error}`, a])).values()]
    .slice(0, 8)
    .map((a) => `${a.model} — ${a.error}`)
    .join("; ");
  throw new AiExtractionError(
    `Couldn't read the line items from this invoice — every free AI source failed or is at its limit (${summary}). Try again in a few minutes, or enter the lines by hand.`,
    attempts
  );
}