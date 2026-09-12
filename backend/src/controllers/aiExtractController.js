/*
  POST /api/ai/extract-document  (multipart, field name "file")

  The single, central endpoint every upload screen calls to get AI-suggested
  field values from a just-uploaded document. Nothing here is saved to the
  database — this only returns suggested values for the frontend to drop
  into an editable form, exactly like the rest of the upload flow already
  works (nothing is booked/saved until the person reviews and submits).

  Body (multipart form fields alongside "file"):
    documentType  - looks up the field list in aiDocumentSchemas.js, OR
    fields        - a JSON-stringified array of { name, description, type }
                    to use instead/as well (fields, if given, wins)

  Response: { fields: {...extracted values...}, modelUsed: "provider/model" }
*/
import asyncHandler from "express-async-handler";
import { extractDocumentFields, AiExtractionError } from "../utils/aiDocumentExtract.js";
import { getDocumentSchema } from "../utils/aiDocumentSchemas.js";

export const extractDocument = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("Attach the document to extract details from");
  }

  let fields = null;
  if (req.body.fields) {
    try {
      fields = JSON.parse(req.body.fields);
    } catch {
      res.status(400);
      throw new Error('"fields" must be a JSON-stringified array of { name, description, type }');
    }
  } else if (req.body.documentType) {
    fields = getDocumentSchema(req.body.documentType);
    if (!fields) {
      res.status(400);
      throw new Error(`No field schema registered for documentType "${req.body.documentType}"`);
    }
  }

  if (!Array.isArray(fields) || fields.length === 0) {
    res.status(400);
    throw new Error('Provide either "documentType" (a registered schema) or a "fields" array');
  }

  try {
    const result = await extractDocumentFields({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
      fields,
    });
    res.json(result);
  } catch (err) {
    // 502: the request itself was fine, but the upstream AI providers
    // (all of them, across the whole fallback chain) couldn't fulfil it.
    res.status(err instanceof AiExtractionError ? 502 : 500);
    throw new Error(err.message || "Could not extract details from this document");
  }
});