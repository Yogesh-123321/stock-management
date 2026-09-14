import { useEffect, useRef, useState } from "react";
import { extractDocumentFields } from "@/lib/aiExtract";

/*
  Auto-fetch AI-suggested field values the moment a document is chosen —
  no button click needed. Every upload screen that wants "pick a file and
  have it read automatically" uses this instead of driving
  extractDocumentFields (lib/aiExtract.js) by hand.

  Usage:
    const { status, fields, modelUsed, error } = useAutoExtractOnUpload(file, {
      documentType: "purchaseOrderDoc", // or: fields: [{ name, description, type }]
    });

  `status` is one of "idle" | "loading" | "done" | "error". `fields` is the
  raw { fieldName: value } object from the AI once status is "done" — it's
  entirely up to the caller what to do with it (auto-fill empty inputs,
  compare against what's already typed, etc; see lib/documentVerify.js for
  the comparison side of that).

  Deliberately silent on failure (no toast) — this runs automatically in
  the background on every file pick, and a model outage or an
  unsupported/unreadable file should never interrupt manual entry. `error`
  is still returned in case a screen wants to show something unobtrusive.
*/
export function useAutoExtractOnUpload(file, { documentType, fields } = {}) {
  const [state, setState] = useState({ status: "idle", fields: null, modelUsed: null, error: null });
  const requestId = useRef(0);
  const fieldsKey = fields ? JSON.stringify(fields) : "";

  useEffect(() => {
    if (!file || (!documentType && !fields)) {
      setState({ status: "idle", fields: null, modelUsed: null, error: null });
      return;
    }

    const id = ++requestId.current;
    setState({ status: "loading", fields: null, modelUsed: null, error: null });

    extractDocumentFields({ file, documentType, fields })
      .then((result) => {
        if (requestId.current !== id) return; // superseded by a newer file
        setState({ status: "done", fields: result.fields || {}, modelUsed: result.modelUsed, error: null });
      })
      .catch((err) => {
        if (requestId.current !== id) return;
        setState({
          status: "error",
          fields: null,
          modelUsed: null,
          error: err.response?.data?.message || err.message || "Could not read this document",
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, documentType, fieldsKey]);

  return state;
}