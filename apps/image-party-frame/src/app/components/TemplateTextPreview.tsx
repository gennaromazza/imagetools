import { useEffect, useState } from "react";
import type { TemplateTextOverlay } from "../contexts/ProjectContext";
import { renderTextOverlayPng } from "../lib/textOverlay";

/** Display the exact pixels sent to the exporter, scaled with the template. */
export function TemplateTextPreview({ text, maxHeight }: { text: TemplateTextOverlay; maxHeight: number }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    setError("");
    void renderTextOverlayPng(text, maxHeight).then((file) => {
      if (!active) return;
      url = URL.createObjectURL(file);
      setSource(url);
    }).catch(() => { if (active) setError("Impossibile disegnare il testo"); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [text, maxHeight]);
  return error ? <span role="alert">{error}</span> : source ? <img src={source} alt={text.text} draggable={false} className="block w-full pointer-events-none" /> : null;
}
