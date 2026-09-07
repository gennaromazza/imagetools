import type { TemplateLogoOverlay, TemplateTextOverlay } from "../contexts/ProjectContext";
import { PHOTOBOOTH_FONTS } from "../lib/photoboothFonts";
import { MAX_TEXT_FONT_PX, MAX_TEXT_OVERLAY_CHARS, MIN_TEXT_FONT_PX } from "../lib/textOverlay";

type Props = {
  logo?: TemplateLogoOverlay;
  text?: TemplateTextOverlay;
  width: number;
  height: number;
  disabled: boolean;
  onLogo: (patch: Partial<TemplateLogoOverlay>) => void;
  onText: (patch: Partial<TemplateTextOverlay>) => void;
};

export function TemplateOverlayControls({ logo, text, width, height, disabled, onLogo, onText }: Props) {
  const overlay = logo ?? text;
  if (!overlay) return null;
  const fieldClass = "w-full rounded border border-[var(--app-border)] bg-[var(--app-field)] p-2 text-[var(--app-text)]";
  const update = (patch: Partial<TemplateTextOverlay & TemplateLogoOverlay>) => logo ? onLogo(patch) : onText(patch);
  const number = (label: string, key: "x" | "y" | "width" | "height" | "opacity" | "fontSizePx", value: number, min: number, max: number) => (
    <label className="space-y-1 text-xs" key={key}>{label}
      <input className={fieldClass} type="number" aria-label={label} value={value} min={min} max={max} step={1}
        onChange={(event) => update({ [key]: Math.max(min, Math.min(max, Math.round(Number(event.target.value) || min))) })} />
    </label>
  );
  return <fieldset disabled={disabled} className="space-y-3 rounded-2xl border border-[var(--app-border)] p-4" data-testid="overlay-controls">
    <legend className="text-sm font-medium">{logo ? "Modifica logo" : "Modifica testo"}</legend>
    {text && <>
      <label className="block text-xs">Contenuto del testo
        <textarea className={fieldClass} aria-label="Contenuto del testo" maxLength={MAX_TEXT_OVERLAY_CHARS} rows={3} value={text.text}
          onChange={(event) => onText({ text: event.target.value })} />
      </label>
      <label className="block text-xs">Font
        <select className={fieldClass} aria-label="Font" value={text.fontKey} onChange={(event) => onText({ fontKey: event.target.value })}>
          {PHOTOBOOTH_FONTS.map((font) => <option key={font.key} value={font.key}>{font.label} — {font.hint}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {number("Dimensione testo (px)", "fontSizePx", text.fontSizePx, MIN_TEXT_FONT_PX, MAX_TEXT_FONT_PX)}
        <label className="text-xs">Colore testo<input className={fieldClass} type="color" aria-label="Colore testo" value={text.color} onChange={(event) => onText({ color: event.target.value })} /></label>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {([['bold', 'Grassetto'], ['italic', 'Corsivo'], ['shadow', 'Ombra']] as const).map(([key, label]) =>
          <label key={key}><input type="checkbox" checked={text[key]} onChange={(event) => onText({ [key]: event.target.checked })} /> {label}</label>)}
      </div>
      <label className="block text-xs">Allineamento
        <select className={fieldClass} aria-label="Allineamento" value={text.align} onChange={(event) => onText({ align: event.target.value as TemplateTextOverlay['align'] })}>
          <option value="left">Sinistra</option><option value="center">Centro</option><option value="right">Destra</option>
        </select>
      </label>
    </>}
    <div className="grid grid-cols-2 gap-2">
      {number("Posizione X (px)", "x", overlay.x, 0, Math.max(0, width - overlay.width))}
      {number("Posizione Y (px)", "y", overlay.y, 0, Math.max(0, height - (logo?.height ?? 8)))}
      {number("Larghezza (px)", "width", overlay.width, logo ? 16 : 40, Math.max(logo ? 16 : 40, width - overlay.x))}
      {logo && number("Altezza (px)", "height", logo.height, 16, Math.max(16, height - logo.y))}
      {number("Opacità (%)", "opacity", overlay.opacity, 0, 100)}
    </div>
    {logo && <p className="text-xs text-[var(--app-text-subtle)]">Il logo mantiene le proporzioni dentro il riquadro. Trascina l’angolo per ingrandirlo.</p>}
    {text && <p className="text-xs text-[var(--app-text-subtle)]">Il testo va a capo nella larghezza scelta. Le righe oltre il bordo inferiore vengono ritagliate, come nell’anteprima.</p>}
  </fieldset>;
}
