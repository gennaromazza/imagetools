import { useEffect, useRef } from "react";
import { paletteOf } from "../social/brand";
import { suggestKindOf } from "../social/suggest";
import { TEXT_SCALE, type BrandKit, type Slide, type SlideTemplate, type TextColorChoice, type TextFontChoice, type TextStyleChoice, type Tone } from "../social/types";
import { Icon } from "./icons";

const FONT_LABEL: Record<TextFontChoice, string> = { display: "Titolo", script: "Calligrafico", body: "Testo" };
const ALIGN_LABEL = { left: "Sinistra", center: "Centro", right: "Destra" } as const;

/** Testi di una slide: scrittura, suggerimenti dalla libreria editoriale e stile (carattere, dimensione, colore, allineamento, maiuscole). */
export function SocialTextFields({ slide, template, brand, albumName, tone, activeField, onActiveField, onText, onReset, repeatOf, moved, onResetPosition, onStyle, onSuggest, onSuggestAll }: {
  slide: Slide;
  template: SlideTemplate;
  brand: BrandKit;
  albumName: string;
  /** Fondo effettivo della slide: serve a mostrare il vero colore del testo «normale». */
  tone: Tone;
  activeField: string | null;
  onActiveField: (field: string | null) => void;
  onText: (key: string, value: string) => void;
  onReset: (key: string) => void;
  /** Campi con una frase già usata in una slide precedente: numero di quella slide. */
  repeatOf: Readonly<Record<string, number>>;
  /** Campi spostati a mano sulla slide. */
  moved: readonly string[];
  onResetPosition: (key: string) => void;
  /** `null` toglie ogni ritocco di stile al campo. */
  onStyle: (key: string, patch: Partial<TextStyleChoice> | null) => void;
  onSuggest: (key: string) => void;
  onSuggestAll: () => void;
}) {
  const inputs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement | null>());
  const pal = paletteOf(brand.paletteId);
  const swatches: Array<[TextColorChoice, string, string]> = [
    ["ink", tone === "dark" ? pal.light : pal.dark, "Testo"], ["accent", pal.accent, "Accento"], ["light", pal.light, "Chiaro"], ["dark", pal.dark, "Scuro"], ["soft", pal.soft, "Tinta"],
  ];

  // Cliccando un testo nell'anteprima si arriva qui già con il campo pronto per scrivere.
  useEffect(() => { if (activeField) inputs.current.get(activeField)?.focus(); }, [activeField]);

  return (
    <div className="social-texts">
      <div className="social-texts__head">
        <h4>Testi</h4>
        <button type="button" className="btn btn--sm" onClick={onSuggestAll} title="Propone un testo per ogni campo di questa slide, dalla libreria editoriale (la stessa dei fotolibri)"><Icon name="wand" size={13} /> Suggerisci per questa slide</button>
      </div>
      {template.fields.map((field) => {
        const value = slide.texts[field.key] ?? field.fallback({ brand, albumName });
        const edited = slide.texts[field.key] !== undefined;
        const style = slide.textStyle?.[field.key];
        const open = activeField === field.key;
        const canSuggest = suggestKindOf(field.key) !== null;
        const set = (element: HTMLInputElement | HTMLTextAreaElement | null) => { inputs.current.set(field.key, element); };
        return (
          <div key={field.key} className={`social-field${open ? " is-active" : ""}`}>
            <div className="social-field__label">
              <label htmlFor={`sf-${field.key}`}>{field.label}</label>
              <span className="social-field__tools">
                {moved.includes(field.key) ? <button type="button" className="link-btn" onClick={() => onResetPosition(field.key)} title="Riporta il testo al suo posto nel modello">riporta al posto</button> : null}
                {edited ? <button type="button" className="link-btn" onClick={() => onReset(field.key)}>ripristina</button> : null}
                {canSuggest ? <button type="button" className="icon-btn icon-btn--sm" onClick={() => onSuggest(field.key)} aria-label={`Suggerisci: ${field.label}`} title="Suggerisci un testo (clic di nuovo per un altro)"><Icon name="wand" size={13} /></button> : null}
                <button type="button" className={`icon-btn icon-btn--sm${open || style ? " is-active" : ""}`} aria-pressed={open} onClick={() => onActiveField(open ? null : field.key)} aria-label={`Stile del testo: ${field.label}`} title="Carattere, dimensione, colore, allineamento"><span className="social-field__aa">Aa</span></button>
              </span>
            </div>
            {repeatOf[field.key] ? <span className="field__hint social-field__repeat">Questa frase c'è già nella slide {repeatOf[field.key]}: «Suggerisci» ne propone un'altra.</span> : null}
            {field.multiline
              ? <textarea id={`sf-${field.key}`} ref={set} className="input" rows={3} value={value} onChange={(event) => onText(field.key, event.target.value)} />
              : <input id={`sf-${field.key}`} ref={set} className="input" value={value} onChange={(event) => onText(field.key, event.target.value)} />}
            {open ? (
              <div className="social-style" role="group" aria-label={`Stile di ${field.label}`}>
                <div className="social-style__row">
                  <span>Carattere</span>
                  <div className="chips">
                    <button type="button" className={`chip${!style?.font ? " is-active" : ""}`} onClick={() => onStyle(field.key, { font: undefined })}>Del modello</button>
                    {(Object.keys(FONT_LABEL) as TextFontChoice[]).map((font) => <button key={font} type="button" className={`chip${style?.font === font ? " is-active" : ""}`} onClick={() => onStyle(field.key, { font })}>{FONT_LABEL[font]}</button>)}
                  </div>
                </div>
                <div className="social-style__row">
                  <span>Dimensione <strong>{Math.round((style?.scale ?? 1) * 100)}%</strong></span>
                  <input type="range" min={TEXT_SCALE.min * 100} max={TEXT_SCALE.max * 100} step={5} value={Math.round((style?.scale ?? 1) * 100)} aria-label="Dimensione del testo"
                    onChange={(event) => onStyle(field.key, { scale: Number(event.target.value) / 100 })} />
                </div>
                <div className="social-style__row">
                  <span>Colore</span>
                  <div className="social-style__swatches">
                    <button type="button" className={`social-style__none${!style?.color ? " is-active" : ""}`} onClick={() => onStyle(field.key, { color: undefined })} title="Come il modello" aria-label="Colore del modello">×</button>
                    {swatches.map(([choice, color, label]) => <button key={choice} type="button" className={style?.color === choice ? "is-active" : ""} style={{ background: color }} onClick={() => onStyle(field.key, { color: choice })} title={label} aria-label={label} />)}
                  </div>
                </div>
                <div className="social-style__row">
                  <span>Allineamento</span>
                  <div className="chips">
                    <button type="button" className={`chip${!style?.align ? " is-active" : ""}`} onClick={() => onStyle(field.key, { align: undefined })}>Del modello</button>
                    {(Object.keys(ALIGN_LABEL) as Array<keyof typeof ALIGN_LABEL>).map((align) => <button key={align} type="button" className={`chip${style?.align === align ? " is-active" : ""}`} onClick={() => onStyle(field.key, { align })}>{ALIGN_LABEL[align]}</button>)}
                  </div>
                </div>
                <div className="social-style__row">
                  <span>Maiuscole</span>
                  <div className="chips">
                    {([[undefined, "Del modello"], [true, "Sì"], [false, "No"]] as const).map(([flag, label]) => <button key={label} type="button" className={`chip${style?.uppercase === flag ? " is-active" : ""}`} onClick={() => onStyle(field.key, { uppercase: flag })}>{label}</button>)}
                  </div>
                </div>
                <button type="button" className="btn btn--sm btn--ghost" disabled={!style} onClick={() => onStyle(field.key, null)}>Ripristina lo stile</button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
