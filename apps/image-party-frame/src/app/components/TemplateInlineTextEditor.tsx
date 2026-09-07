import { useEffect, useRef } from "react";
import type { TemplateTextOverlay } from "../contexts/ProjectContext";
import { getPhotoboothFont } from "../lib/photoboothFonts";
import { MAX_TEXT_OVERLAY_CHARS } from "../lib/textOverlay";

export function TemplateInlineTextEditor({ text, scale, onChange, onDone }: {
  text: TemplateTextOverlay; scale: number; onChange: (value: string) => void; onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); ref.current?.select(); }, []);
  return <textarea ref={ref} aria-label="Scrivi testo sul canvas" value={text.text} maxLength={MAX_TEXT_OVERLAY_CHARS}
    className="block w-full resize-none rounded border border-[var(--brand-accent)] bg-black/70 p-0 outline-none"
    style={{ fontFamily: getPhotoboothFont(text.fontKey).family, fontSize: text.fontSizePx * scale,
      fontWeight: text.bold ? 700 : 400, fontStyle: text.italic ? "italic" : "normal", textAlign: text.align,
      color: text.color, lineHeight: 1.18, minHeight: 36 }} rows={Math.max(2, text.text.split('\n').length)}
    onChange={(event) => onChange(event.target.value)} onBlur={onDone}
    onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) { event.preventDefault(); onDone(); } }} />;
}
