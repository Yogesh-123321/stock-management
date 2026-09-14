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

const callOpenRouter = async ({ model, imageUrls, promptText, systemPrompt, timeoutMs }) => {
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
        max_tokens: 2000,
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
      const msg = body?.error?.message || `HTTP ${response.status}`;
      throw new Error(msg);
    }

    const message = body?.choices?.[0]?.message;
    // Some providers still route output to `reasoning` even with
    // reasoning disabled, so try `content` first and fall back to it.
    const parsed = extractJsonObject(message?.content) || extractJsonObject(message?.reasoning);
    if (!parsed) throw new Error("Model reply wasn't a parseable JSON object");
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
invoice / bill, provided to you as one or more page images. Read every line
item in the invoice's item table (ignore header/footer info like billing
address, tax summary rows, and totals).

Return ONLY a single valid JSON object — no markdown code fences, no
commentary before or after it — of the shape:

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
- If the document has no readable line-item table, return { "lineItems": [] }.`;

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

  const attempts = [];
  for (const model of OPENROUTER_MODELS) {
    try {
      const parsed = await callOpenRouter({
        model,
        imageUrls,
        promptText: "Extract the line items as instructed and return only the JSON object.",
        systemPrompt: LINE_ITEMS_SYSTEM_PROMPT,
        timeoutMs: AI_EXTRACT_TIMEOUT_MS,
      });
      const lineItems = Array.isArray(parsed?.lineItems) ? parsed.lineItems : [];
      return { lineItems, modelUsed: model };
    } catch (err) {
      attempts.push({ model, error: err.message });
    }
  }

  throw new AiExtractionError(
    `Every configured model failed to read line items from this invoice (tried: ${attempts
      .map((a) => `${a.model} — ${a.error}`)
      .join("; ")})`,
    attempts
  );
}