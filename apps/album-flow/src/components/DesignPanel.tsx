import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AlbumProjectV2, AlbumSpread, SpreadBackground, SpreadBackgroundScope, SpreadOverlay, SpreadTextOverlay, TextStyleSpec } from "@photo-tools/shared-types";
import { BUILTIN_BACKGROUNDS, builtinDataUrl } from "../model/builtinMedia";
import { backgroundsOf, groupMembers, overlaysOf, type BackgroundChoice, type NewGraphicOptions, type NewTextOptions, type OverlayPatch } from "../model/design";
import { addPhrase, loadPhrases, loadSavedStyles, phraseGroups, removePhrase, removeSavedStyle, savePhrases, saveSavedStyles, updatePhrase, upsertSavedStyle, type Phrase, type SavedTextStyle } from "../model/designLibrary";
import { importMediaFile, listMedia, mediaVersion, removeMedia, subscribeMedia, type MediaKind, type MediaRecord } from "../model/mediaStore";
import { BASE_GROUP, FONT_CATEGORY_LABEL, FONT_FAMILIES, TEXT_PRESETS, fontInfo, fontStack, nearestFace, textPreset, type TextPreset } from "../model/typography";
import { forgetMediaUrl } from "../hooks/useMedia";
import { installFonts, loadFonts } from "../render/fonts";
import { Icon } from "./icons";
import type { AlignTo } from "../model/designAlign";
import type { SuggestOptions, SuggestResult } from "../model/story";
import { IconButton } from "./ui";
import { StoryTab } from "./StoryPanel";

export type DesignTab = "backgrounds" | "text" | "story" | "library" | "graphics";

/** Gli stili di testo raggruppati per sezione, nell'ordine in cui compaiono. */
const PRESET_GROUPS: ReadonlyArray<readonly [string, readonly TextPreset[]]> = (() => {
  const groups = new Map<string, TextPreset[]>();
  for (const preset of TEXT_PRESETS) groups.set(preset.group ?? BASE_GROUP, [...(groups.get(preset.group ?? BASE_GROUP) ?? []), preset]);
  return [...groups];
})();

export interface DesignActions {
  addText: (options: NewTextOptions) => void;
  addGraphic: (options: NewGraphicOptions) => void;
  update: (overlayId: string, patch: OverlayPatch) => void;
  remove: (overlayId: string) => void;
  duplicate: (overlayId: string) => void;
  order: (overlayId: string, where: "front" | "back") => void;
  ungroup: (overlayId: string) => void;
  group: (overlayIds: string[]) => void;
  select: (overlayId: string | null) => void;
  setBackground: (scope: SpreadBackgroundScope, choice: BackgroundChoice | null, wholeAlbum: boolean) => void;
  updateBackground: (scope: SpreadBackgroundScope, patch: Partial<Pick<SpreadBackground, "fit" | "opacity" | "tileCm">>) => void;
  notify: (message: string) => void;
  /** Allinea l'elemento (e il suo gruppo) al margine o al centro della pagina in cui si trova. */
  alignTo: (overlayId: string, where: AlignTo) => void;
  /** Propone e inserisce un testo narrativo per la pagina; con `replace` toglie prima la proposta precedente («Rigenera testo»). */
  suggestStory: (areaIndex: number, options: SuggestOptions) => SuggestResult | null;
  /** Aggiunge alla pagina una voce della libreria narrativa. Restituisce false se non c'è posto. */
  insertStoryUnit: (unitId: string, areaIndex: number) => boolean;
  /** Cambia il testo di un elemento con quello di una voce della libreria, lasciandone lo stile. */
  replaceWithStoryUnit: (overlayId: string, unitId: string) => void;
  /** Mette i testi narrativi sulle pagine libere di tutto l'album; restituisce quanti ne ha aggiunti. */
  planStories: () => number;
  removeOverlays: (overlayIds: readonly string[]) => void;
}

/** Colore dominante degli sfondi di serie: serve a scegliere un testo che si legga. */
const BUILTIN_BACKDROP: Record<string, string> = { "builtin-ivory": "#f4efe6", "builtin-linen": "#e9e3d6", "builtin-marble": "#f3f3f1", "builtin-slate": "#2b312d", "builtin-dawn": "#f2e3d6", "builtin-ink": "#111111" };

const COLOR_SWATCHES = ["#111111", "#3a3a3a", "#ffffff", "#f4efe6", "#b08a3e", "#7a1f2b", "#27405e", "#2f5d46"] as const;

function useMediaList(kind: MediaKind): MediaRecord[] {
  const version = useSyncExternalStore(subscribeMedia, mediaVersion);
  const [items, setItems] = useState<MediaRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listMedia(kind).then((list) => { if (alive) setItems(list); });
    return () => { alive = false; };
  }, [kind, version]);
  return items;
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; format?: (value: number) => string }) {
  return (
    <label className="design__field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} />
      <output>{format ? format(value) : value}</output>
    </label>
  );
}

function FileButton({ label, accept, multiple, onFiles }: { label: string; accept: string; multiple?: boolean; onFiles: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn--sm" onClick={() => ref.current?.click()}><Icon name="import" size={14} /> {label}</button>
      <input ref={ref} type="file" accept={accept} multiple={multiple} hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) onFiles(files); }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sfondi
// ---------------------------------------------------------------------------

function BackgroundsTab({ spread, two, actions }: { spread: AlbumSpread; two: boolean; actions: DesignActions }) {
  const mine = useMediaList("background");
  const [scope, setScope] = useState<SpreadBackgroundScope>("spread");
  const [busy, setBusy] = useState(false);
  const scopes: Array<{ value: SpreadBackgroundScope; label: string }> = two ? [{ value: "spread", label: "Tutto lo spread" }, { value: "left", label: "Pagina sinistra" }, { value: "right", label: "Pagina destra" }] : [{ value: "spread", label: "Foglio intero" }];
  const active = scopes.some((entry) => entry.value === scope) ? scope : "spread";
  const current = backgroundsOf(spread).find((background) => background.scope === active);
  // Una pagina senza sfondo proprio eredita quello di tutto lo spread: lo si mostra, ma si modifica da «Tutto lo spread».
  const inherited = !current && active !== "spread" ? backgroundsOf(spread).find((background) => background.scope === "spread") : undefined;

  const apply = (mediaId: string, aspect: number) => actions.setBackground(active, { mediaId, aspect, fit: current?.fit ?? "cover", opacity: current?.opacity ?? 1, tileCm: current?.tileCm }, false);
  const upload = async (files: File[]) => {
    setBusy(true);
    try {
      for (const file of files) { const record = await importMediaFile(file, "background"); if (files.length === 1) apply(record.id, record.width / record.height); }
      actions.notify(files.length === 1 ? "Sfondo caricato e applicato." : `${files.length} sfondi caricati nella libreria.`);
    } catch (error) { actions.notify(error instanceof Error ? error.message : "Sfondo non caricato."); }
    setBusy(false);
  };

  return (
    <div className="design__section">
      <div className="design__chips" role="group" aria-label="Dove applicare lo sfondo">
        {scopes.map((entry) => <button key={entry.value} type="button" className={`chip${active === entry.value ? " is-active" : ""}`} aria-pressed={active === entry.value} onClick={() => setScope(entry.value)}>{entry.label}</button>)}
      </div>
      {current || inherited ? (
        <div className="design__card">
          <p className="small muted">{inherited ? "Questa pagina usa lo sfondo di tutto lo spread." : "Sfondo attuale"}</p>
          {current ? (
            <>
              <div className="design__chips">
                {(["cover", "contain", "tile"] as const).map((fit) => <button key={fit} type="button" className={`chip${current.fit === fit ? " is-active" : ""}`} onClick={() => actions.updateBackground(active, { fit })}>{fit === "cover" ? "Riempi" : fit === "contain" ? "Intera" : "Ripeti"}</button>)}
              </div>
              <Slider label="Visibilità" value={Math.round(current.opacity * 100)} min={5} max={100} step={5} onChange={(value) => actions.updateBackground(active, { opacity: value / 100 })} format={(value) => `${value}%`} />
              {current.fit === "tile" ? <Slider label="Piastrella" value={current.tileCm ?? 6} min={1} max={30} step={0.5} onChange={(value) => actions.updateBackground(active, { tileCm: value })} format={(value) => `${value} cm`} /> : null}
              <div className="btn-row">
                <button type="button" className="btn btn--sm" onClick={() => actions.setBackground(active, null, false)}>Togli sfondo</button>
                <button type="button" className="btn btn--sm" onClick={() => actions.setBackground(active, current, true)} title="Usa questo sfondo per tutti gli spread non segnati come finiti">Applica a tutto l'album</button>
              </div>
            </>
          ) : null}
        </div>
      ) : <p className="small muted">Scegli un'immagine: va sotto le foto. Il colore di fondo della pagina resta visibile se la riduci di visibilità.</p>}

      <h4>Di serie</h4>
      <div className="design__grid">
        {BUILTIN_BACKGROUNDS.map((entry) => (
          <button key={entry.id} type="button" className={`design__thumb${current?.mediaId === entry.id ? " is-current" : ""}`} onClick={() => apply(entry.id, entry.aspect)} title={entry.name}>
            <img src={builtinDataUrl(entry)} alt="" draggable={false} /><span>{entry.name}</span>
          </button>
        ))}
      </div>

      <div className="design__head">
        <h4>I tuoi sfondi</h4>
        <FileButton label={busy ? "Carico…" : "Carica sfondo"} accept="image/*,.svg" multiple onFiles={(files) => void upload(files)} />
      </div>
      {mine.length === 0 ? <p className="small muted">Carica JPG, PNG, WebP o SVG: restano nella tua libreria per tutti gli album.</p> : (
        <div className="design__grid">
          {mine.map((record) => (
            <div key={record.id} className="design__card-thumb">
              <button type="button" className={`design__thumb${current?.mediaId === record.id ? " is-current" : ""}`} onClick={() => apply(record.id, record.width / record.height)} title={record.name}>
                <img src={record.dataUrl} alt="" draggable={false} /><span>{record.name}</span>
              </button>
              <button type="button" className="design__remove" aria-label={`Elimina ${record.name} dalla libreria`} title="Elimina dalla libreria" onClick={() => { void removeMedia(record.id).then(() => forgetMediaUrl(record.id)); }}><Icon name="close" size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Testo
// ---------------------------------------------------------------------------

function FontPicker({ value, onChange }: { value: string; onChange: (fontId: string) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { installFonts(); if (open) void loadFonts(FONT_FAMILIES.map((font) => font.id)); }, [open]);
  const grouped = (Object.keys(FONT_CATEGORY_LABEL) as Array<keyof typeof FONT_CATEGORY_LABEL>).map((category) => ({ category, fonts: FONT_FAMILIES.filter((font) => font.category === category) }));
  return (
    <div className="design__font">
      <button type="button" className="design__font-current" onClick={() => setOpen((on) => !on)} aria-expanded={open} style={{ fontFamily: fontStack(value) }}>
        <span>{fontInfo(value).label}</span><Icon name={open ? "chevronUp" : "chevronDown"} size={14} />
      </button>
      {open ? (
        <div className="design__font-list" role="listbox" aria-label="Font">
          {grouped.map((group) => (
            <div key={group.category}>
              <p className="design__font-group">{FONT_CATEGORY_LABEL[group.category]}</p>
              {group.fonts.map((font) => (
                <button key={font.id} type="button" role="option" aria-selected={font.id === value} className={`design__font-item${font.id === value ? " is-current" : ""}`} onClick={() => { onChange(font.id); setOpen(false); }} title={font.note}>
                  <span style={{ fontFamily: fontStack(font.id) }}>{font.label}</span>
                  <small>{font.note}</small>
                </button>
              ))}
            </div>
          ))}
          <p className="small muted design__license">Tutti i font sono open source (licenza SIL OFL).</p>
        </div>
      ) : null}
    </div>
  );
}

function TextEditor({ overlay, actions, savedStyles, onSaveStyle, onSavePhrase, textRef }: { overlay: SpreadTextOverlay; actions: DesignActions; savedStyles: SavedTextStyle[]; onSaveStyle: (name: string, style: TextStyleSpec) => void; onSavePhrase: (text: string) => void; textRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const font = fontInfo(overlay.font);
  const set = (patch: OverlayPatch) => actions.update(overlay.id, patch);
  const [styleName, setStyleName] = useState("");
  const style: TextStyleSpec = overlay;
  const applyStyle = (spec: TextStyleSpec, name: string) => set({ ...spec, styleName: name });
  return (
    <div className="design__section">
      <label className="design__label" htmlFor="design-text">Testo</label>
      <textarea id="design-text" ref={textRef} className="input design__textarea" rows={4} value={overlay.text} onChange={(event) => set({ text: event.target.value })} placeholder="Scrivi qui. Un invio inizia un nuovo paragrafo." />
      <div className="design__chips">
        <button type="button" className="btn btn--sm" onClick={() => onSavePhrase(overlay.text)} title="Aggiunge questa frase al tuo archivio"><Icon name="plus" size={14} /> Salva frase</button>
      </div>

      <h4>Carattere</h4>
      <FontPicker value={overlay.font} onChange={(fontId) => set({ font: fontId })} />
      <div className="design__chips" role="group" aria-label="Peso e stile">
        {font.weights.map((weight) => <button key={weight} type="button" className={`chip${overlay.weight === weight ? " is-active" : ""}`} aria-pressed={overlay.weight === weight} onClick={() => set({ weight })}>{weight === 300 ? "Leggero" : weight === 400 ? "Normale" : weight === 600 ? "Semi-grassetto" : "Grassetto"}</button>)}
        {font.italic ? <button type="button" className={`chip${overlay.italic ? " is-active" : ""}`} aria-pressed={overlay.italic} onClick={() => set({ italic: !overlay.italic })}><em>Corsivo</em></button> : null}
        <button type="button" className={`chip${overlay.uppercase ? " is-active" : ""}`} aria-pressed={overlay.uppercase} onClick={() => set({ uppercase: !overlay.uppercase })}>MAIUSCOLO</button>
      </div>

      <h4>Dimensioni e paragrafo</h4>
      <Slider label="Corpo" value={overlay.sizePt} min={5} max={200} step={0.5} onChange={(value) => set({ sizePt: value })} format={(value) => `${value} pt`} />
      <Slider label="Interlinea" value={overlay.lineHeight} min={0.8} max={2.5} step={0.05} onChange={(value) => set({ lineHeight: value })} format={(value) => value.toFixed(2)} />
      <Slider label="Spaziatura lettere" value={overlay.trackingEm} min={-0.05} max={0.6} step={0.01} onChange={(value) => set({ trackingEm: value })} format={(value) => `${Math.round(value * 1000)}`} />
      <Slider label="Spazio tra paragrafi" value={overlay.paragraphSpacePt} min={0} max={40} step={1} onChange={(value) => set({ paragraphSpacePt: value })} format={(value) => `${value} pt`} />
      <div className="design__chips" role="group" aria-label="Allineamento">
        {([["left", "Sinistra"], ["center", "Centro"], ["right", "Destra"], ["justify", "Giustificato"]] as const).map(([align, label]) => <button key={align} type="button" className={`chip${overlay.align === align ? " is-active" : ""}`} aria-pressed={overlay.align === align} onClick={() => set({ align })}>{label}</button>)}
      </div>
      <label className="design__field">
        <span>Capolettera</span>
        <select className="input" value={overlay.dropCapLines} onChange={(event) => set({ dropCapLines: Number(event.target.value) })} aria-label="Capolettera">
          <option value={0}>Nessuno</option>
          {[2, 3, 4, 5].map((lines) => <option key={lines} value={lines}>Su {lines} righe</option>)}
        </select>
      </label>

      <h4>Colore e posizione</h4>
      <div className="design__colors">
        {COLOR_SWATCHES.map((color) => <button key={color} type="button" className={`design__swatch${overlay.color.toLowerCase() === color ? " is-current" : ""}`} style={{ background: color }} aria-label={`Colore ${color}`} onClick={() => set({ color })} />)}
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(overlay.color) ? overlay.color : "#1c1c1c"} onChange={(event) => set({ color: event.target.value })} aria-label="Altro colore" />
      </div>
      <Slider label="Visibilità" value={Math.round(overlay.opacity * 100)} min={5} max={100} step={5} onChange={(value) => set({ opacity: value / 100 })} format={(value) => `${value}%`} />
      <Slider label="Larghezza" value={Math.round(overlay.w * 100)} min={3} max={100} step={1} onChange={(value) => set({ w: value / 100 })} format={(value) => `${value}%`} />
      <Slider label="Rotazione" value={overlay.rotation} min={-180} max={180} step={0.5} onChange={(value) => set({ rotation: value })} format={(value) => `${value}°`} />

      <h4>Stili salvati</h4>
      <div className="design__inline">
        <input className="input" value={styleName} onChange={(event) => setStyleName(event.target.value)} placeholder="Nome (es. Titolo capitolo)" aria-label="Nome dello stile" maxLength={60} />
        <button type="button" className="btn btn--sm" disabled={!styleName.trim()} onClick={() => { onSaveStyle(styleName, style); setStyleName(""); }}>Salva stile</button>
      </div>
      {savedStyles.length ? <div className="design__chips">{savedStyles.map((saved) => <button key={saved.id} type="button" className="chip" onClick={() => applyStyle(saved.style, saved.name)} title="Applica questo stile al testo selezionato">{saved.name}</button>)}</div> : null}
    </div>
  );
}

const ALIGNMENTS: ReadonlyArray<readonly [AlignTo, string, string]> = [
  ["left", "Sinistra", "Porta al margine sinistro della pagina"],
  ["center", "Centro", "Centra nella pagina, da sinistra a destra"],
  ["right", "Destra", "Porta al margine destro della pagina"],
  ["top", "Alto", "Porta al margine alto della pagina"],
  ["middle", "Metà", "Centra nella pagina, dall'alto in basso"],
  ["bottom", "Basso", "Porta al margine basso della pagina"],
];

/** Allineamento alla pagina (con il margine di sicurezza): vale anche per un gruppo, che si muove tutto insieme. */
function AlignControls({ overlay, actions }: { overlay: SpreadOverlay; actions: DesignActions }) {
  return (
    <div className="design__section">
      <h4>Allinea alla pagina</h4>
      <div className="design__chips" role="group" aria-label="Allinea alla pagina">
        {ALIGNMENTS.map(([where, label, hint]) => <button key={where} type="button" className="chip" title={hint} onClick={() => actions.alignTo(overlay.id, where)}>{label}</button>)}
      </div>
      <p className="small muted">Trascinando, l'elemento si aggancia a bordi, centro, piega, margini, foto e altri testi: tieni premuto Alt per spostarlo senza calamite.</p>
    </div>
  );
}

function ElementActions({ overlay, actions, groupSize }: { overlay: SpreadOverlay; actions: DesignActions; groupSize: number }) {
  return (
    <div className="design__actions">
      {overlay.groupId && groupSize > 1 ? (
        <span className="design__group">
          <span className="small muted">In gruppo con altri {groupSize - 1}: si spostano insieme</span>
          <button type="button" className="btn btn--sm" onClick={() => actions.ungroup(overlay.id)} title="Da ora questo elemento si sposta da solo">Sgancia</button>
        </span>
      ) : null}
      <IconButton icon="copy" label="Duplica" onClick={() => actions.duplicate(overlay.id)} size={16} />
      <IconButton icon="chevronUp" label="Porta davanti" onClick={() => actions.order(overlay.id, "front")} size={16} />
      <IconButton icon="chevronDown" label="Porta dietro" onClick={() => actions.order(overlay.id, "back")} size={16} />
      <IconButton icon="trash" label="Elimina (Canc)" danger onClick={() => actions.remove(overlay.id)} size={16} />
    </div>
  );
}

function GraphicEditor({ overlay, actions }: { overlay: Extract<SpreadOverlay, { kind: "graphic" }>; actions: DesignActions }) {
  const set = (patch: OverlayPatch) => actions.update(overlay.id, patch);
  return (
    <div className="design__section">
      <h4>Grafica</h4>
      <Slider label="Larghezza" value={Math.round(overlay.w * 100)} min={1} max={150} step={1} onChange={(value) => set({ w: value / 100 })} format={(value) => `${value}%`} />
      <Slider label="Rotazione" value={overlay.rotation} min={-180} max={180} step={0.5} onChange={(value) => set({ rotation: value })} format={(value) => `${value}°`} />
      <Slider label="Visibilità" value={Math.round(overlay.opacity * 100)} min={5} max={100} step={5} onChange={(value) => set({ opacity: value / 100 })} format={(value) => `${value}%`} />
    </div>
  );
}

function TextTab({ spread, selected, extraIds, actions, savedStyles, onSaveStyle, onSavePhrase, textRef, insertAt }: { spread: AlbumSpread; selected: SpreadOverlay | undefined; extraIds: readonly string[]; actions: DesignActions; savedStyles: SavedTextStyle[]; onSaveStyle: (name: string, style: TextStyleSpec) => void; onSavePhrase: (text: string) => void; textRef: React.RefObject<HTMLTextAreaElement | null>; insertAt: { x: number; y: number } }) {
  const count = overlaysOf(spread).length;
  useEffect(() => { installFonts(); void loadFonts(TEXT_PRESETS.map((preset) => preset.style.font)); }, []);
  return (
    <>
      {selected && extraIds.length > 0 ? (
        <div className="design__section design__multi">
          <p className="small"><strong>{extraIds.length + 1} elementi selezionati.</strong> Agganciandoli si spostano sempre insieme.</p>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => actions.group([selected.id, ...extraIds])}>Aggancia insieme</button>
        </div>
      ) : selected ? <p className="small muted design__hint">Maiusc o Ctrl + clic su altri testi per selezionarne più d'uno e agganciarli.</p> : null}
      {selected ? (
        <>
          <ElementActions overlay={selected} actions={actions} groupSize={groupMembers(spread, selected.id).length} />
          <AlignControls overlay={selected} actions={actions} />
          {selected.kind === "text" ? <TextEditor overlay={selected} actions={actions} savedStyles={savedStyles} onSaveStyle={onSaveStyle} onSavePhrase={onSavePhrase} textRef={textRef} /> : <GraphicEditor overlay={selected} actions={actions} />}
          <div className="design__section"><button type="button" className="btn btn--sm" onClick={() => actions.select(null)}>Fatto: torna agli stili</button></div>
        </>
      ) : (
        <div className="design__section">
          <p className="small muted">Scegli uno stile per aggiungere un testo allo spread. Poi trascinalo, ridimensionalo e cambia il carattere. {count ? `Su questo spread ci sono ${count} elementi: clic per modificarli.` : ""}</p>
          {PRESET_GROUPS.map(([group, presets]) => (
          <div key={group} className="design__preset-group">
            <h4 className="design__preset-heading">{group}</h4>
          <div className="design__presets">
            {presets.map((preset) => (
              <button key={preset.id} type="button" className="design__preset" onClick={() => actions.addText({ presetId: preset.id, at: insertAt })} title={preset.use}>
                <small className="design__preset-label">{preset.name}{preset.stack ? ` · ${preset.stack.length} testi` : ""}</small>
                {/* L'anteprima è proprio ciò che verrà inserito: tutti i pezzi, ciascuno nel suo carattere. */}
                {(preset.stack ?? [{ presetId: preset.id, text: preset.sample }]).map((part, index) => {
                  const spec = { ...textPreset(part.presetId).style, ...part.style };
                  return <span key={index} className="design__preset-name" style={{ fontFamily: fontStack(spec.font), fontWeight: nearestFace(spec.font, spec.weight, spec.italic).weight, fontStyle: spec.italic ? "italic" : "normal", textTransform: spec.uppercase ? "uppercase" : "none", letterSpacing: `${Math.min(spec.trackingEm, 0.2)}em`, textAlign: spec.align === "justify" ? "left" : spec.align, fontSize: `${Math.min(24, Math.max(9, spec.sizePt * 0.45))}px`, lineHeight: spec.lineHeight }}>{part.text}</span>;
                })}
                <small>{preset.use}</small>
              </button>
            ))}
          </div>
          </div>
          ))}
          {savedStyles.length ? (
            <>
              <h4>I tuoi stili</h4>
              <div className="design__chips">{savedStyles.map((saved) => <button key={saved.id} type="button" className="chip" onClick={() => actions.addText({ presetId: "body", style: saved.style, styleName: saved.name, text: "Il tuo testo", at: insertAt })}>{saved.name}</button>)}</div>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Libreria
// ---------------------------------------------------------------------------

function LibraryTab({ actions, phrases, setPhrases, savedStyles, setSavedStyles, insertAt }: { actions: DesignActions; phrases: Phrase[]; setPhrases: (next: Phrase[]) => void; savedStyles: SavedTextStyle[]; setSavedStyles: (next: SavedTextStyle[]) => void; insertAt: { x: number; y: number } }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("tutte");
  const [draft, setDraft] = useState("");
  const [draftGroup, setDraftGroup] = useState("Le mie");
  const [styleId, setStyleId] = useState("headline");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const groups = useMemo(() => phraseGroups(phrases), [phrases]);
  const shown = phrases.filter((phrase) => (group === "tutte" || phrase.group === group) && (!query.trim() || phrase.text.toLowerCase().includes(query.trim().toLowerCase())));
  const insert = (phrase: Phrase) => {
    const saved = savedStyles.find((entry) => entry.id === styleId);
    actions.addText(saved ? { presetId: "body", style: saved.style, styleName: saved.name, text: phrase.text, at: insertAt } : { presetId: styleId, text: phrase.text, at: insertAt });
  };
  return (
    <div className="design__section">
      <div className="design__head"><h4>Le mie frasi</h4><span className="small muted">{phrases.length}</span></div>
      <div className="design__inline">
        <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca una frase" aria-label="Cerca nelle frasi" />
        <select className="input" value={styleId} onChange={(event) => setStyleId(event.target.value)} aria-label="Stile con cui inserire le frasi" title="Stile con cui inserire le frasi">
          <optgroup label="Stili">{TEXT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>
          {savedStyles.length ? <optgroup label="I tuoi stili">{savedStyles.map((saved) => <option key={saved.id} value={saved.id}>{saved.name}</option>)}</optgroup> : null}
        </select>
      </div>
      <div className="design__chips">
        {["tutte", ...groups].map((name) => <button key={name} type="button" className={`chip${group === name ? " is-active" : ""}`} aria-pressed={group === name} onClick={() => setGroup(name)}>{name === "tutte" ? "Tutte" : name}</button>)}
      </div>
      <ul className="design__phrases">
        {shown.map((phrase) => (
          <li key={phrase.id}>
            {editing?.id === phrase.id ? (
              <div className="design__inline">
                <input className="input" value={editing.text} onChange={(event) => setEditing({ id: phrase.id, text: event.target.value })} aria-label="Modifica la frase" autoFocus onKeyDown={(event) => { if (event.key === "Enter") { setPhrases(updatePhrase(phrases, phrase.id, { text: editing.text })); setEditing(null); } if (event.key === "Escape") setEditing(null); }} />
                <button type="button" className="btn btn--sm" onClick={() => { setPhrases(updatePhrase(phrases, phrase.id, { text: editing.text })); setEditing(null); }}>Salva</button>
              </div>
            ) : (
              <>
                <button type="button" className="design__phrase" onClick={() => insert(phrase)} title="Inserisci nello spread">{phrase.text}</button>
                <span className="design__phrase-tools">
                  <IconButton icon="pencil" label="Modifica" onClick={() => setEditing({ id: phrase.id, text: phrase.text })} size={14} />
                  <IconButton icon="trash" label="Elimina" danger onClick={() => setPhrases(removePhrase(phrases, phrase.id))} size={14} />
                </span>
              </>
            )}
          </li>
        ))}
        {shown.length === 0 ? <li className="small muted">Nessuna frase trovata.</li> : null}
      </ul>
      <div className="design__card">
        <textarea className="input" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Nuova frase da tenere nel tuo archivio" aria-label="Nuova frase" />
        <div className="design__inline">
          <input className="input" list="design-groups" value={draftGroup} onChange={(event) => setDraftGroup(event.target.value)} aria-label="Gruppo" placeholder="Gruppo" maxLength={40} />
          <datalist id="design-groups">{groups.map((name) => <option key={name} value={name} />)}</datalist>
          <button type="button" className="btn btn--sm btn--primary" disabled={!draft.trim()} onClick={() => { setPhrases(addPhrase(phrases, draft, draftGroup)); setDraft(""); }}>Aggiungi</button>
        </div>
      </div>

      <div className="design__head"><h4>I miei stili di testo</h4></div>
      {savedStyles.length === 0 ? <p className="small muted">Quando hai un testo che ti piace, salvalo come stile dalla scheda «Testo».</p> : (
        <ul className="design__phrases">
          {savedStyles.map((saved) => (
            <li key={saved.id}>
              <button type="button" className="design__phrase" style={{ fontFamily: fontStack(saved.style.font), fontStyle: saved.style.italic ? "italic" : "normal", fontWeight: saved.style.weight }} onClick={() => actions.addText({ presetId: "body", style: saved.style, styleName: saved.name, text: saved.name, at: insertAt })}>{saved.name}</button>
              <span className="design__phrase-tools"><IconButton icon="trash" label="Elimina lo stile" danger onClick={() => setSavedStyles(removeSavedStyle(savedStyles, saved.id))} size={14} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Grafiche e ornamenti: PNG (anche con trasparenza), SVG, WebP o JPG come loghi, filetti e ornamenti da posizionare liberamente sopra le foto. */
function GraphicsTab({ actions, insertAt }: { actions: DesignActions; insertAt: { x: number; y: number } }) {
  const graphics = useMediaList("graphic");
  const uploadGraphics = async (files: File[]) => {
    try { for (const file of files) await importMediaFile(file, "graphic"); actions.notify(files.length === 1 ? "Grafica aggiunta alla libreria." : `${files.length} grafiche aggiunte alla libreria.`); }
    catch (error) { actions.notify(error instanceof Error ? error.message : "Grafica non caricata."); }
  };

  return (
    <div className="design__section">
      <div className="design__head">
        <h4>Loghi e ornamenti</h4>
        <FileButton label="Carica grafica" accept="image/png,image/svg+xml,image/webp,image/jpeg,.svg" multiple onFiles={(files) => void uploadGraphics(files)} />
      </div>
      {graphics.length === 0 ? <p className="small muted">PNG con trasparenza o SVG: filetti, ornamenti, logo dello studio, firme scansionate.</p> : (
        <div className="design__grid">
          {graphics.map((record) => (
            <div key={record.id} className="design__card-thumb">
              <button type="button" className="design__thumb design__thumb--checker" onClick={() => actions.addGraphic({ mediaId: record.id, aspect: record.width / record.height, at: insertAt })} title={`Inserisci «${record.name}»`}>
                <img src={record.dataUrl} alt="" draggable={false} /><span>{record.name}</span>
              </button>
              <button type="button" className="design__remove" aria-label={`Elimina ${record.name}`} title="Elimina dalla libreria" onClick={() => { void removeMedia(record.id).then(() => forgetMediaUrl(record.id)); }}><Icon name="close" size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <p className="small muted">Un clic inserisce la grafica nella pagina attiva, sopra le foto. Poi la trascini dove vuoi, la ridimensioni, la ruoti e ne regoli la visibilità.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pannello
// ---------------------------------------------------------------------------

/** «Personalizza»: sfondi a immagine, testi in stile rivista e il tuo archivio di frasi, stili e grafiche. */
export function DesignPanel({ project, spread, two, areaIndex, tab, onTab, selectedOverlayId, extraOverlayIds, focusSignal, actions, onClose }: {
  project: AlbumProjectV2;
  spread: AlbumSpread;
  two: boolean;
  areaIndex: number;
  tab: DesignTab;
  onTab: (tab: DesignTab) => void;
  selectedOverlayId: string | null;
  extraOverlayIds: readonly string[];
  /** Aumenta quando si fa doppio clic su un testo: porta il cursore nella casella del testo. */
  focusSignal: number;
  actions: DesignActions;
  onClose: () => void;
}) {
  const [phrases, setPhrasesState] = useState<Phrase[]>(() => loadPhrases());
  const [savedStyles, setSavedStylesState] = useState<SavedTextStyle[]>(() => loadSavedStyles());
  const textRef = useRef<HTMLTextAreaElement>(null);
  const selected = overlaysOf(spread).find((overlay) => overlay.id === selectedOverlayId);
  const insertAt = useMemo(() => ({ x: !two ? 0.5 : areaIndex === 0 ? 0.25 : 0.75, y: 0.4 }), [two, areaIndex]);
  // Colore della pagina dove finisce il testo (uno sfondo di serie conta come il suo colore dominante).
  const scopeOf = !two ? "spread" : areaIndex === 0 ? "left" : "right";
  const pictured = backgroundsOf(spread).find((background) => background.scope === "spread" || background.scope === scopeOf);
  const backdrop = (pictured && pictured.opacity >= 0.6 ? BUILTIN_BACKDROP[pictured.mediaId] : undefined) ?? spread.areas[Math.min(areaIndex, spread.areas.length - 1)].style.background;
  const designActions = useMemo<DesignActions>(() => ({ ...actions, addText: (options) => actions.addText({ backdrop, ...options }) }), [actions, backdrop]);

  const setPhrases = useCallback((next: Phrase[]) => { setPhrasesState(next); if (!savePhrases(next)) actions.notify("Non riesco a salvare l'archivio delle frasi."); }, [actions]);
  const setSavedStyles = useCallback((next: SavedTextStyle[]) => { setSavedStylesState(next); if (!saveSavedStyles(next)) actions.notify("Non riesco a salvare gli stili."); }, [actions]);

  useEffect(() => {
    if (!focusSignal) return;
    onTab("text");
    const timer = setTimeout(() => { textRef.current?.focus(); textRef.current?.select(); }, 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  const tabs: Array<{ value: DesignTab; label: string }> = [{ value: "backgrounds", label: "Sfondi" }, { value: "text", label: "Testo" }, { value: "story", label: "Racconto" }, { value: "library", label: "Libreria" }, { value: "graphics", label: "Grafiche" }];
  return (
    <aside className="layouts design" aria-label="Personalizza lo spread">
      <header className="layouts__head">
        <div>
          <h3>Personalizza</h3>
          <p className="muted small">Sfondi, testi e grafiche per impaginare come una rivista.</p>
        </div>
        <IconButton icon="close" label="Chiudi" onClick={onClose} />
      </header>
      <div className="design__tabs" role="tablist">
        {tabs.map((entry) => <button key={entry.value} type="button" role="tab" aria-selected={tab === entry.value} className={`design__tab${tab === entry.value ? " is-active" : ""}`} onClick={() => onTab(entry.value)}>{entry.label}</button>)}
      </div>
      <div className="layouts__body design__body">
        {tab === "backgrounds" ? <BackgroundsTab spread={spread} two={two} actions={actions} /> : null}
        {tab === "text" ? (
          <TextTab spread={spread} selected={selected} extraIds={extraOverlayIds} actions={designActions} savedStyles={savedStyles} textRef={textRef} insertAt={insertAt}
            onSaveStyle={(name, style) => { setSavedStyles(upsertSavedStyle(savedStyles, name, style)); actions.notify(`Stile «${name.trim()}» salvato.`); }}
            onSavePhrase={(text) => { if (!text.trim()) return; setPhrases(addPhrase(phrases, text)); actions.notify("Frase aggiunta al tuo archivio."); }} />
        ) : null}
        {tab === "story" ? <StoryTab project={project} spread={spread} areaIndex={Math.min(areaIndex, spread.areas.length - 1)} selected={selected} actions={designActions} /> : null}
        {tab === "graphics" ? <GraphicsTab actions={designActions} insertAt={insertAt} /> : null}
        {tab === "library" ? <LibraryTab actions={designActions} phrases={phrases} setPhrases={setPhrases} savedStyles={savedStyles} setSavedStyles={setSavedStyles} insertAt={insertAt} /> : null}
      </div>
    </aside>
  );
}
