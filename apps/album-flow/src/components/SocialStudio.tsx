import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { canRedo, canUndo, createHistory, pushHistory, redo, replacePresent, undo, type History } from "../history";
import type { Project } from "../model/project";
import { suggestKindOf } from "../social/suggest";
import { canvasMeasure, loadFonts } from "../render/fonts";
import { carouselReport } from "../social/check";
import { FONT_PAIRS, PALETTES, brandFontIds, defaultBrand, fontPairOf } from "../social/brand";
import {
  acceptSelection, addPanorama, addSlide, duplicateSlide, moveSlide, removeSlide, renameCarousel, replacePhoto, resetSlideText, setCaption, setFormat, setSlideSpread,
  bestSlotFor, reselectSlidePhotos, resizeCarousel, swapPhotos, type PhotoSpot, setSlideFlip, setSlideFraming, setSlideTemplate, setSlideText, setSlideTone, updateBrand, usedAssetIds,
} from "../social/edit";
import { setSlideTextStyle, suggestCarouselTexts, suggestFieldText, suggestSlideTexts } from "../social/edit-text";
import { buildSlide } from "../social/build";
import { photoAt } from "../social/hit";
import { layoutOf } from "../social/kit";
import { usePhotoDrag, type DropTarget } from "../social/usePhotoDrag";
import { usePreviewInteraction, type PreviewMode } from "../social/usePreviewInteraction";
import { envFor, reselectPhotos, restyle, selectionBasis, selectionChanged, variation } from "../social/plan";
import { renderSlideSvg } from "../social/render";
import { loadCarousels, saveBrand, saveCarousels } from "../social/store";
import { SETS, setInfo, templateOf, templatesForSet } from "../social/templates";
import { MAX_SLIDES, SOCIAL_FORMATS, formatOf, type Carousel, type Slide, type Tone } from "../social/types";
import { clearPreviewCache, useBrandFonts, usePreviewMedia } from "../social/useSocialMedia";
import "../social/social.css";
import { Icon } from "./icons";
import { SocialExportDialog } from "./SocialExportDialog";
import { SocialNewDialog } from "./SocialNewDialog";
import { SocialFraming } from "./SocialFraming";
import { SocialTextFields } from "./SocialTextFields";
import { SocialPhotoPicker } from "./SocialPhotoPicker";
import { Segmented } from "./ui";

/** Un SVG già pronto, disegnato dentro un riquadro. */
function SlideView({ svg, className = "" }: { svg: string; className?: string }) {
  return <div className={`social-slide ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function SlotThumb({ asset, label, slot, dropping, onPick, onClear, onDragBegin }: {
  asset: AlbumAssetV2 | undefined; label: string; slot: number; dropping: boolean;
  onPick: () => void; onClear?: () => void; onDragBegin?: (event: { clientX: number; clientY: number; pointerId: number }) => void;
}) {
  const src = useAssetSrc(asset, 200);
  return (
    <div className={`social-slot${dropping ? " is-drop" : ""}`} data-slot-thumb={slot}>
      <button type="button" className={`social-slot__img${asset && onDragBegin ? " is-draggable" : ""}`} onClick={onPick} title={asset && onDragBegin ? "Clic per cambiare foto · trascinala su un'altra foto o su una slide per spostarla" : "Cambia foto"} aria-label={`${label}: cambia foto`}
        onPointerDown={(event) => { if (asset && onDragBegin && event.button === 0) onDragBegin(event); }}>
        {src ? <img src={src} alt="" draggable={false} /> : <span className="social-slot__empty"><Icon name="plus" size={18} /></span>}
      </button>
      <span className="social-slot__label">{label}</span>
      {asset && onClear ? <button type="button" className="icon-btn icon-btn--sm social-slot__clear" onClick={onClear} aria-label={`${label}: togli la foto`}><Icon name="close" size={12} /></button> : null}
    </div>
  );
}

export function SocialStudio({ project, onClose, onStatus, onImportFolder, onImportFiles }: {
  project: Project;
  onClose: () => void;
  onStatus: (message: string) => void;
  onImportFolder: () => void;
  onImportFiles: () => void;
}) {
  // I caroselli salvati si rileggono così come sono; il primo carosello nasce dalla creazione guidata, non da solo.
  const [hist, setHist] = useState<History<Carousel[]>>(() => createHistory(loadCarousels(project.projectId)));
  const list = hist.present;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | { kind: "slot"; slideId: string; slot: number } | { kind: "panorama" }>(null);
  const [panoCount, setPanoCount] = useState<"2" | "3" | "4">("2");
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastEdit = useRef({ key: "", time: 0 });
  const mainRef = useRef<HTMLDivElement>(null);
  const [activeSlot, setActiveSlot] = useState(0);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [inlineField, setInlineField] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<PreviewMode>("frame");
  const [scope, setScope] = useState<"slide" | "all">("slide");
  const [tab, setTab] = useState<"model" | "photos" | "texts" | "look">("model");
  const suggestions = useRef(new Map<string, number>());
  const [textAttempt, setTextAttempt] = useState(0);

  const carousel = list.find((candidate) => candidate.id === activeId) ?? list[0] ?? null;
  const activeRef = useRef<string | null>(carousel?.id ?? null);
  activeRef.current = carousel?.id ?? null;

  // Salvataggio locale a ogni modifica.
  useEffect(() => { saveCarousels(project.projectId, list); }, [project.projectId, list]);
  useEffect(() => () => clearPreviewCache(), []);


  const commit = useCallback((fn: (current: Carousel) => Carousel, coalesce?: string) => {
    const now = Date.now();
    const merge = Boolean(coalesce) && lastEdit.current.key === coalesce && now - lastEdit.current.time < 1200;
    lastEdit.current = { key: coalesce ?? "", time: now };
    setHist((current) => {
      const next = current.present.map((item) => (item.id === activeRef.current ? fn(item) : item));
      return merge ? replacePresent(current, next) : pushHistory(current, next);
    });
  }, []);

  const commitList = useCallback((fn: (current: Carousel[]) => Carousel[]) => {
    lastEdit.current = { key: "", time: 0 };
    setHist((current) => pushHistory(current, fn(current.present)));
  }, []);

  const doUndo = () => setHist((current) => undo(current));
  const doRedo = () => setHist((current) => redo(current));

  // ----------------------------------------------------------------- disegno
  const env = useMemo(() => envFor(project, canvasMeasure), [project]);
  const fontTick = useBrandFonts(carousel?.brand ?? defaultBrand(""));
  const [setFontTick, setSetFontTick] = useState(0);
  useEffect(() => {
    const ids = [...new Set(SETS.flatMap((set) => brandFontIds({ name: "", handle: "", paletteId: set.paletteId, fontPairId: set.fontPairId })))];
    let cancelled = false;
    void loadFonts(ids).then(() => { if (!cancelled) setSetFontTick((value) => value + 1); });
    return () => { cancelled = true; };
  }, []);

  const selectedIndex = carousel ? Math.max(0, carousel.slides.findIndex((slide) => slide.id === selectedId)) : 0;
  const slide = carousel?.slides[selectedIndex] ?? null;
  const template = slide && carousel ? templateOf(slide.templateId) ?? templateOf(setInfo(carousel.setId).arc.open) : undefined;

  const photosSignature = carousel ? carousel.slides.map((item) => item.photos.join(",")).join(";") : "";
  const setPreviews = useMemo(() => (carousel ? SETS.map((set) => ({ set, carousel: restyle(project, carousel, set.id) })) : []),
    // La proposta dei set dipende dalle foto scelte e dalla marca, non dai testi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, photosSignature, carousel?.format, carousel?.brand.name, carousel?.brand.handle]);
  // Le miniature dei modelli si ricalcolano con calma: mentre si trascina una foto o si scrive, l'anteprima grande resta fluida.
  const deferredCarousel = useDeferredValue(carousel);
  const deferredSlide = deferredCarousel?.slides.find((item) => item.id === slide?.id) ?? null;
  const tiles = useMemo(() => {
    if (!deferredCarousel || !deferredSlide || deferredSlide.span) return [];
    return templatesForSet(deferredCarousel.setId)
      .filter((candidate) => candidate.id !== "sh-pano" && (candidate.id !== "sh-mockup" || project.spreads.length > 0))
      .map((candidate) => {
        const trial = setSlideTemplate(deferredCarousel, project, deferredSlide.id, candidate.id);
        return { template: candidate, carousel: trial, index: trial.slides.findIndex((item) => item.id === deferredSlide.id) };
      });
  }, [deferredCarousel, deferredSlide, project]);

  const wantedAssets = useMemo(() => {
    const ids = new Set<string>();
    if (carousel) for (const id of usedAssetIds(carousel)) ids.add(id);
    for (const preview of setPreviews) for (const id of preview.carousel.slides[0]?.photos ?? []) if (id) ids.add(id);
    for (const tile of tiles) for (const id of tile.carousel.slides[tile.index]?.photos ?? []) if (id) ids.add(id);
    return [...ids];
  }, [carousel, setPreviews, tiles]);
  const wantedSpreads = useMemo(() => {
    const ids = new Set<string>();
    const add = (item: { spreadId?: string | null; spreadId2?: string | null } | undefined) => { if (item?.spreadId) ids.add(item.spreadId); if (item?.spreadId2) ids.add(item.spreadId2); };
    if (carousel) for (const item of carousel.slides) add(item);
    for (const tile of tiles) add(tile.carousel.slides[tile.index]);
    return [...ids];
  }, [carousel, tiles]);
  const media = usePreviewMedia(project, wantedAssets, wantedSpreads);

  const svgOf = useCallback((target: Carousel, index: number, prefix: string) => {
    try { return renderSlideSvg(target, index, env, media, { idPrefix: prefix, placeholders: true }); } catch { return ""; }
    // `fontTick` e `setFontTick` forzano il ridisegno quando i font sono pronti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, media, fontTick, setFontTick]);

  const mainSvg = useMemo(() => (carousel ? svgOf(carousel, selectedIndex, "main") : ""), [svgOf, carousel, selectedIndex]);
  // Ogni slide si ridisegna solo se è cambiata lei (o la marca, il formato, le immagini): trascinando una foto non si rifanno le altre 19.
  const thumbCache = useMemo(() => new WeakMap<Slide, Map<string, string>>(), [svgOf, carousel?.brand, carousel?.format, carousel?.setId]);
  const thumbSvgs = useMemo(() => {
    if (!carousel) return [];
    return carousel.slides.map((item, index) => {
      const key = `${index}/${carousel.slides.length}`;
      let perSlide = thumbCache.get(item);
      if (!perSlide) { perSlide = new Map(); thumbCache.set(item, perSlide); }
      let svg = perSlide.get(key);
      if (svg === undefined) { svg = svgOf(carousel, index, `t-${item.id}`); perSlide.set(key, svg); }
      return svg;
    });
  }, [svgOf, carousel, thumbCache]);
  const tileSvgs = useMemo(() => tiles.map((tile) => svgOf(tile.carousel, tile.index, `tile-${tile.template.id}`)), [tiles, svgOf]);

  // Anteprima grande: livelli già calcolati, per trascinare le foto e cliccare i testi.
  const mainLayers = useMemo(() => {
    if (!carousel) return [];
    try { return buildSlide(carousel, selectedIndex, env).layers; } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carousel, selectedIndex, env, fontTick, setFontTick]);
  useEffect(() => { setActiveSlot(0); setActiveField(null); setInlineField(null); }, [slide?.id]);
  const canvasWidth = carousel ? formatOf(carousel.format).width : 1080;
  const interaction = usePreviewInteraction({
    wrapRef: mainRef, layers: mainLayers, env, canvasWidth, slideId: slide?.id,
    mode,
    onFraming: (photoSlot, patch, key) => commit((current) => setSlideFraming(current, slide!.id, photoSlot, patch), key),
    onSlot: setActiveSlot,
    onField: (field) => { setInlineField(field); },
    onEmptySlot: (photoSlot) => setPicker({ kind: "slot", slideId: slide!.id, slot: photoSlot }),
    onMoveStart: (photoSlot, assetId, pointer) => startDrag(photoSlot, assetId, pointer),
  });

  // Spostare le foto: dall'anteprima (modo «Sposta») o dalle miniature a destra, su un'altra foto, su uno spazio vuoto o su una slide della striscia.
  const resolveDrop = (clientX: number, clientY: number): DropTarget | null => {
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit || !slide) return null;
    const strip = hit.closest("[data-strip-slide]");
    if (strip) return { kind: "slide", slideId: strip.getAttribute("data-strip-slide")! };
    const thumb = hit.closest("[data-slot-thumb]");
    if (thumb) return { kind: "slot", slideId: slide.id, slot: Number(thumb.getAttribute("data-slot-thumb")) };
    const svg = mainRef.current?.querySelector("svg");
    if (svg && mainRef.current?.contains(hit)) {
      const rect = svg.getBoundingClientRect();
      const scale = rect.width > 0 ? canvasWidth / rect.width : 1;
      const layer = photoAt(mainLayers, (clientX - rect.left) * scale, (clientY - rect.top) * scale);
      if (layer) return { kind: "slot", slideId: slide.id, slot: layer.slot };
    }
    return null;
  };
  const dropPhoto = (from: PhotoSpot, assetId: string, target: DropTarget) => {
    if (!carousel) return;
    const slot = target.kind === "slot" ? target.slot : bestSlotFor(carousel, target.slideId, env.photos.get(assetId)?.aspect);
    if (slot === null) { onStatus("Questa slide non ha spazi per le foto (o è un panorama): scegli un'altra slide."); return; }
    const to: PhotoSpot = { slideId: target.slideId, slot };
    if (to.slideId === from.slideId && to.slot === from.slot) return;
    if (swapPhotos(carousel, from, to) === carousel) { onStatus("Non posso spostarla qui: la slide ha già questa foto, oppure è un panorama."); return; }
    commit((current) => swapPhotos(current, from, to));
  };
  const { drag, begin: beginDrag } = usePhotoDrag({ resolve: resolveDrop, onDrop: dropPhoto });
  const startDrag = (photoSlot: number, assetId: string, pointer: { clientX: number; clientY: number }, immediate = true) => {
    if (!slide) return;
    if (slide.span) { onStatus("Un panorama si sposta insieme: usa le frecce «Sposta prima / dopo»."); return; }
    setActiveSlot(photoSlot);
    beginDrag({ slideId: slide.id, slot: photoSlot }, assetId, pointer, immediate);
  };

  const report = useMemo(() => (carousel ? carouselReport(carousel, project) : null), [carousel, project]);

  // ----------------------------------------------------------------- tastiera
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (event.key === "Escape") {
        event.stopPropagation();
        if (picker) setPicker(null); else if (inlineField) setInlineField(null); else if (creating) setCreating(false); else if (adding) setAdding(false); else if (!exporting) onClose();
        return;
      }
      if (typing || exporting || picker || creating) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && key === "y") { event.preventDefault(); doRedo(); return; }
      if (!carousel) return;
      if (event.key === "ArrowLeft" && selectedIndex > 0) { event.preventDefault(); setSelectedId(carousel.slides[selectedIndex - 1].id); }
      if (event.key === "ArrowRight" && selectedIndex < carousel.slides.length - 1) { event.preventDefault(); setSelectedId(carousel.slides[selectedIndex + 1].id); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picker, adding, exporting, creating, inlineField, carousel, selectedIndex, onClose]);

  // ----------------------------------------------------------------- vuoto
  if ((!carousel || !slide) && project.assets.length > 0) {
    return <SocialNewDialog project={project} name="Carosello 1" setId="editoriale" onCancel={onClose}
      onCreate={(created) => { commitList((current) => [...current, created]); setActiveId(created.id); setSelectedId(null); }} />;
  }
  if (!carousel || !slide) {
    return (
      <div className="social" role="dialog" aria-label="Carosello per i social">
        <header className="social__bar">
          <button type="button" className="btn btn--ghost" onClick={onClose}><Icon name="chevronLeft" size={16} /> Album</button>
          <h2 className="social__title">Carosello per i social</h2>
        </header>
        <div className="social__empty">
          <div className="empty-card">
            <Icon name="image" size={34} />
            <h2>Servono delle foto</h2>
            <p className="muted">Il carosello nasce dalle foto dell'album: sceglie da solo le più belle e le mette in pagina. Importa le foto, poi torna qui.</p>
            <div className="btn-row btn-row--center">
              <button type="button" className="btn btn--primary" onClick={onImportFolder}><Icon name="import" size={16} /> Importa una cartella</button>
              <button type="button" className="btn" onClick={onImportFiles}>Scegli file…</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const format = formatOf(carousel.format);
  const ratio = format.width / format.height;
  const selectSlide = (id: string) => setSelectedId(id);
  const assetOf = (id: string | null | undefined) => (id ? project.assets.find((asset) => asset.id === id) : undefined);
  const usedNow = usedAssetIds(carousel);
  const inPanorama = Boolean(slide.span);
  const framingSlot = Math.min(activeSlot, Math.max(0, slide.photos.length - 1));
  const hasFramingPhoto = Boolean(slide.photos[framingSlot]);
  const toneNow: Tone = slide.tone ?? template?.tone ?? "dark";

  const afterEdit = (next: Carousel, pickId?: (before: Set<string>) => string | undefined) => {
    const before = new Set(carousel.slides.map((item) => item.id));
    commit(() => next);
    const added = pickId ? pickId(before) : next.slides.find((item) => !before.has(item.id))?.id;
    if (added) setSelectedId(added);
  };

  // Sopra l'anteprima: lo spazio su cui si sta per rilasciare la foto, la foto che si trascina e il campo del testo in modifica.
  const svgBox = mainRef.current?.querySelector("svg")?.getBoundingClientRect();
  const px = svgBox && svgBox.width > 0 ? svgBox.width / canvasWidth : 1;
  const overSlot = drag?.over?.kind === "slot" && drag.over.slideId === slide.id ? mainLayers.find((layer) => layer.kind === "photo" && !layer.blur && layer.slot === (drag.over as { slot: number }).slot) : undefined;
  const textField = inlineField ? template?.fields.find((field) => field.key === inlineField) : undefined;
  const textLayer = textField ? mainLayers.find((layer) => layer.kind === "text" && layer.field === textField.key) : undefined;
  let editorBox: { left: number; top: number } | null = null;
  if (svgBox && textLayer && textLayer.kind === "text") {
    const textHeight = layoutOf(textLayer, env.measure).height * px;
    const below = svgBox.top + textLayer.y * px + textHeight + 10;
    editorBox = { left: Math.max(8, Math.min(window.innerWidth - 340, svgBox.left + textLayer.x * px)), top: below + 176 > window.innerHeight ? Math.max(8, svgBox.top + textLayer.y * px - 186) : below };
  }
  const overlays = (
    <>
      {drag && svgBox && overSlot && overSlot.kind === "photo" ? <div className="social-drop" style={{ left: svgBox.left + overSlot.x * px, top: svgBox.top + overSlot.y * px, width: overSlot.w * px, height: overSlot.h * px }} /> : null}
      {drag ? <div className="social-ghost" style={{ left: drag.x + 14, top: drag.y + 14 }}>{media.photos.get(drag.assetId) ? <img src={media.photos.get(drag.assetId)!.url} alt="" draggable={false} /> : null}</div> : null}
      {editorBox && textField ? (
        <div className="social-inline" style={editorBox} role="group" aria-label={`Scrivi: ${textField.label}`}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInlineField(null); }}>
          <label htmlFor="social-inline-input">{textField.label}</label>
          {(() => {
            const value = slide.texts[textField.key] ?? textField.fallback({ brand: carousel.brand, albumName: project.projectName });
            const write = (next: string) => commit((current) => setSlideText(current, slide.id, textField.key, next), `t:${slide.id}:${textField.key}`);
            return textField.multiline
              ? <textarea id="social-inline-input" className="input" rows={3} autoFocus value={value} onChange={(event) => write(event.target.value)} />
              : <input id="social-inline-input" className="input" autoFocus value={value} onChange={(event) => write(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setInlineField(null); }} />;
          })()}
          <div className="social-inline__row">
            {suggestKindOf(textField.key) ? <button type="button" className="btn btn--sm" onClick={() => { const attempt = (suggestions.current.get(`${slide.id}:${textField.key}`) ?? -1) + 1; suggestions.current.set(`${slide.id}:${textField.key}`, attempt); commit((current) => suggestFieldText(current, slide.id, textField.key, attempt)); }}><Icon name="wand" size={13} /> Suggerisci</button> : null}
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setActiveField(textField.key); setTab("texts"); setInlineField(null); }} title="Carattere, dimensione, colore, allineamento">Aa Stile</button>
            <span className="spacer" />
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setInlineField(null)}>Fine</button>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="social" role="dialog" aria-label="Carosello per i social" style={{ ["--ratio" as string]: ratio }}>
      <header className="social__bar">
        <button type="button" className="btn btn--ghost" onClick={onClose}><Icon name="chevronLeft" size={16} /> Album</button>
        <input className="social__title-input" key={`${carousel.id}:${carousel.name}`} defaultValue={carousel.name} aria-label="Nome del carosello"
          onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== carousel.name) commit((current) => renameCarousel(current, value)); else event.target.value = carousel.name; }}
          onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />
        {list.length > 1 ? (
          <select className="select social__select" value={carousel.id} onChange={(event) => { setActiveId(event.target.value); setSelectedId(null); }} aria-label="Altri caroselli di questo album">
            {list.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : null}
        <button type="button" className="btn btn--sm" onClick={() => setCreating(true)} title="Un altro carosello dallo stesso album, scegliendo foto e numero di slide"><Icon name="plus" size={14} /> Nuovo</button>
        <button type="button" className={`btn btn--sm btn--danger${confirmDelete ? " is-armed" : ""}`} onClick={() => {
          if (!confirmDelete) { setConfirmDelete(true); window.setTimeout(() => setConfirmDelete(false), 3000); return; }
          setConfirmDelete(false);
          commitList((current) => current.filter((item) => item.id !== carousel.id));
          setActiveId(null); setSelectedId(null);
        }} title="Elimina questo carosello (l'album non cambia)"><Icon name="trash" size={14} /> {confirmDelete ? "Conferma" : "Elimina"}</button>
        <span className="spacer" />
        <div className="btn-group">
          <button type="button" className="icon-btn" onClick={doUndo} disabled={!canUndo(hist)} aria-label="Annulla (Ctrl/⌘+Z)" title="Annulla (Ctrl/⌘+Z)"><Icon name="undo" /></button>
          <button type="button" className="icon-btn" onClick={doRedo} disabled={!canRedo(hist)} aria-label="Ripeti (Ctrl/⌘+Maiusc+Z)" title="Ripeti (Ctrl/⌘+Maiusc+Z)"><Icon name="redo" /></button>
        </div>
        <Segmented label="Formato" value={carousel.format} onChange={(value) => commit((current) => setFormat(current, value))} options={SOCIAL_FORMATS.map((item) => ({ value: item.id, label: item.label }))} />
        <button type="button" className="btn btn--primary" onClick={() => setExporting(true)} title="Esporta le immagini per Instagram">
          <Icon name="export" size={16} /> Esporta{report && report.warnings > 0 ? <span className="social__badge" title={`${report.warnings} avvisi`}>{report.warnings}</span> : null}
        </button>
      </header>

      {selectionChanged(project, carousel) ? (
        <div className="social__notice" role="status">
          <Icon name="info" size={16} />
          <span>Da quando hai creato questo carosello sono cambiate le stelle o le foto segnate «Per i social». Le foto scelte non si aggiornano da sole.</span>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => commit((current) => reselectPhotos(project, current))}>Riscegli le foto</button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => commit((current) => acceptSelection(current, selectionBasis(project)))}>Tienilo così</button>
        </div>
      ) : null}

      <div className="social__body">
        <aside className="social__side social__side--left" aria-label="Stile">
          <h3>Stile</h3>
          <div className="social-sets">
            {setPreviews.map(({ set, carousel: preview }) => (
              <button key={set.id} type="button" className={`social-set${set.id === carousel.setId ? " is-active" : ""}`} onClick={() => commit((current) => restyle(project, current, set.id))} title={set.note}>
                <SlideView svg={svgOf(preview, 0, `set-${set.id}`)} className="social-set__preview" />
                <strong>{set.label}</strong>
              </button>
            ))}
          </div>
          <p className="muted small social-hint">{setInfo(carousel.setId).note}. Cambiare stile mantiene le foto e i testi.</p>
          <button type="button" className="btn btn--sm social__full" onClick={() => commit((current) => variation(project, current))} title="Stesse foto e stessi testi, ma modelli in un altro ordine e qualche slide specchiata: per non fare sempre lo stesso carosello">
            <Icon name="shuffle" size={14} /> Altra variante
          </button>

          <h3>Numero di slide</h3>
          <div className="social-count">
            <input type="range" min={2} max={MAX_SLIDES} step={1} value={carousel.slides.length} aria-label="Numero di slide"
              onChange={(event) => commit((current) => resizeCarousel(current, project, Number(event.target.value)), "count")} />
            <strong>{carousel.slides.length}</strong>
          </div>
          <p className="muted small social-hint">Instagram ne accetta fino a {MAX_SLIDES}. Si aggiungono e si tolgono prima della chiusura, senza toccare le altre.</p>

          <h3>Colori</h3>
          <div className="social-palettes">
            {PALETTES.map((palette) => (
              <button key={palette.id} type="button" className={`social-palette${palette.id === carousel.brand.paletteId ? " is-active" : ""}`} title={palette.label} aria-label={palette.label}
                onClick={() => { const brand = { ...carousel.brand, paletteId: palette.id }; saveBrand(brand); commit((current) => updateBrand(current, { paletteId: palette.id })); }}>
                <span style={{ background: palette.dark }} /><span style={{ background: palette.light }} /><span style={{ background: palette.accent }} /><span style={{ background: palette.soft }} />
              </button>
            ))}
          </div>

          <h3>Caratteri</h3>
          <select className="select social__full" value={carousel.brand.fontPairId} aria-label="Coppia di caratteri" onChange={(event) => { saveBrand({ ...carousel.brand, fontPairId: event.target.value }); commit((current) => updateBrand(current, { fontPairId: event.target.value })); }}>
            {FONT_PAIRS.map((pair) => <option key={pair.id} value={pair.id}>{pair.label}</option>)}
          </select>
          <p className="muted small social-hint">Titoli {fontPairOf(carousel.brand.fontPairId).display.replaceAll("-", " ")}, parole calligrafiche e testi piccoli: tutti inclusi nell'app.</p>

          <h3>Aiuto automatico</h3>
          <Segmented<"slide" | "all"> label="A cosa si applica" value={scope} onChange={setScope}
            options={[{ value: "slide", label: `Slide ${selectedIndex + 1}` }, { value: "all", label: "Tutto il carosello" }]} />
          <button type="button" className="btn btn--sm social__full social-auto" onClick={() => commit((current) => (scope === "all" ? reselectPhotos(project, current) : reselectSlidePhotos(current, project, slide.id)))}
            title="Sceglie di nuovo le foto con le stelle e i segnalini di adesso. Sostituisce le foto scelte a mano: puoi annullare.">
            <Icon name="wand" size={14} /> Riscegli le foto
          </button>
          <button type="button" className="btn btn--sm social__full social-auto" onClick={() => {
            const key = scope === "all" ? "*" : slide.id;
            const attempt = (suggestions.current.get(`${key}:all`) ?? -1) + 1;
            suggestions.current.set(`${key}:all`, attempt);
            commit((current) => (scope === "all" ? suggestCarouselTexts(current, attempt) : suggestSlideTexts(current, slide.id, attempt)));
          }} title="Propone titoli, parole e frasi dalla libreria editoriale dei fotolibri. Sostituisce i testi attuali: puoi annullare.">
            <Icon name="wand" size={14} /> Suggerisci i testi
          </button>
          <p className="muted small social-hint">{scope === "all"
            ? "Agisce su tutte le slide. Le foto segnate «Per i social» (clic destro in libreria → «Segna come») vengono usate per prime, poi quelle con più stelle."
            : `Agisce solo sulla slide ${selectedIndex + 1}. Ogni clic propone qualcosa di nuovo.`}</p>

          <h3>Il tuo studio</h3>
          <label className="field"><span className="field__label">Nome</span>
            <input className="input" value={carousel.brand.name} placeholder={project.projectName} onChange={(event) => { saveBrand({ ...carousel.brand, name: event.target.value }); commit((current) => updateBrand(current, { name: event.target.value }), "brand-name"); }} /></label>
          <label className="field"><span className="field__label">Profilo</span>
            <input className="input" value={carousel.brand.handle} placeholder="@iltuostudio" onChange={(event) => { saveBrand({ ...carousel.brand, handle: event.target.value }); commit((current) => updateBrand(current, { handle: event.target.value }), "brand-handle"); }} /></label>

          <h3>Testo del post</h3>
          <textarea className="input social__caption" rows={5} maxLength={2200} value={carousel.caption} placeholder="Scrivi qui la didascalia: si salva accanto alle immagini quando esporti."
            onChange={(event) => commit((current) => setCaption(current, event.target.value), "caption")} />
          <span className="field__hint">{carousel.caption.length} / 2200</span>
        </aside>

        <main className="social__stage" aria-label="Anteprima">
          <div className="social__canvas">
            <button type="button" className="icon-btn icon-btn--round social__nav social__nav--prev" disabled={selectedIndex === 0} onClick={() => selectSlide(carousel.slides[selectedIndex - 1].id)} aria-label="Slide precedente"><Icon name="chevronLeft" /></button>
            <div ref={mainRef} className="social-main" onPointerDown={interaction.onPointerDown} onPointerMove={interaction.onPointerMove} onPointerUp={interaction.onPointerUp} onPointerCancel={interaction.onPointerUp}>
              <SlideView svg={mainSvg} className="social-slide--main" />
            </div>
            <button type="button" className="icon-btn icon-btn--round social__nav social__nav--next" disabled={selectedIndex >= carousel.slides.length - 1} onClick={() => selectSlide(carousel.slides[selectedIndex + 1].id)} aria-label="Slide successiva"><Icon name="chevronRight" /></button>
          </div>
          {overlays}
          <div className="social__tools">
            <Segmented<PreviewMode> label="Trascinando una foto nella slide" value={mode} onChange={setMode}
              options={[{ value: "frame", label: "Inquadra" }, { value: "move", label: "Sposta" }]} />
            <span className="muted small">{mode === "frame" ? "Trascina la foto per inquadrarla, rotella per lo zoom. Clic su un testo per scriverlo." : "Trascina una foto su un'altra foto, su uno spazio vuoto o su una slide qui sotto."}</span>
          </div>
          <div className="social__strip-wrap">
            <div className="social__strip" role="listbox" aria-label="Slide del carosello">
              {carousel.slides.map((item, index) => (
                <button key={item.id} type="button" role="option" aria-selected={index === selectedIndex} data-strip-slide={item.id} className={`social__thumb${index === selectedIndex ? " is-selected" : ""}${item.span && item.span.index > 0 ? " is-joined" : ""}${drag?.over?.kind === "slide" && drag.over.slideId === item.id ? " is-drop" : ""}`} onClick={() => selectSlide(item.id)} aria-label={`Slide ${index + 1}`}>
                  <SlideView svg={thumbSvgs[index] ?? ""} className="social-slide--thumb" />
                  <span className="social__num">{index + 1}</span>
                </button>
              ))}
              <div className="social__add">
                <button type="button" className="btn btn--sm" disabled={carousel.slides.length >= MAX_SLIDES} onClick={() => setAdding((value) => !value)}><Icon name="plus" size={14} /> Slide</button>
                <button type="button" className="btn btn--sm" disabled={carousel.slides.length + 2 > MAX_SLIDES} onClick={() => setPicker({ kind: "panorama" })} title="Una foto larga distesa su più slide: invita a scorrere"><Icon name="columns" size={14} /> Panorama</button>
              </div>
            </div>
            <p className="social__count muted small">{carousel.slides.length} {carousel.slides.length === 1 ? "slide" : "slide"} su {MAX_SLIDES} · {format.width} × {format.height} px</p>
            {adding ? (
              <div className="social__tray" role="menu" aria-label="Aggiungi una slide">
                {templatesForSet(carousel.setId).filter((candidate) => candidate.id !== "sh-pano" && (candidate.id !== "sh-mockup" || project.spreads.length > 0)).map((candidate) => (
                  <button key={candidate.id} type="button" className="chip" role="menuitem" title={candidate.note} onClick={() => { setAdding(false); afterEdit(addSlide(carousel, project, candidate.id, slide.id)); }}>{candidate.label}</button>
                ))}
              </div>
            ) : null}
          </div>
        </main>

        <aside className="social__side social__side--right" aria-label="Slide selezionata">
          <div className="social__side-head">
            <h3>Slide {selectedIndex + 1}{template ? <span className="muted"> · {template.label}</span> : null}</h3>
            <div className="btn-group">
              <button type="button" className="icon-btn icon-btn--sm" disabled={selectedIndex === 0} onClick={() => commit((current) => moveSlide(current, slide.id, -1))} aria-label="Sposta prima" title="Sposta prima"><Icon name="chevronLeft" size={14} /></button>
              <button type="button" className="icon-btn icon-btn--sm" disabled={selectedIndex >= carousel.slides.length - 1} onClick={() => commit((current) => moveSlide(current, slide.id, 1))} aria-label="Sposta dopo" title="Sposta dopo"><Icon name="chevronRight" size={14} /></button>
              <button type="button" className="icon-btn icon-btn--sm" disabled={inPanorama || carousel.slides.length >= MAX_SLIDES} onClick={() => afterEdit(duplicateSlide(carousel, slide.id))} aria-label="Duplica la slide" title="Duplica"><Icon name="copy" size={14} /></button>
              <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" disabled={carousel.slides.length <= 2} onClick={() => { const next = removeSlide(carousel, slide.id); commit(() => next); setSelectedId(next.slides[Math.min(selectedIndex, next.slides.length - 1)]?.id ?? null); }} aria-label="Elimina la slide" title="Elimina"><Icon name="trash" size={14} /></button>
            </div>
          </div>

          <div className="social__tabs" role="tablist" aria-label="Cosa modificare in questa slide">
            {([["model", "Modello"], ["photos", "Foto"], ["texts", "Testi"], ["look", "Aspetto"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {tab !== "model" ? null : inPanorama ? (
            <p className="notice social-hint">Questa slide è la parte {slide.span!.index + 1} di {slide.span!.count} di un <strong>panorama</strong>: la foto continua da una slide all'altra. Cambiando foto cambia su tutte le parti; spostarla o eliminarla riguarda l'intero panorama.</p>
          ) : (
            <>
              <h4>Modello</h4>
              <div className="social-tiles">
                {tiles.map((tile) => (
                  <button key={tile.template.id} type="button" className={`social-tile${tile.template.id === slide.templateId ? " is-active" : ""}`} onClick={() => commit((current) => setSlideTemplate(current, project, slide.id, tile.template.id))} title={tile.template.note}>
                    <SlideView svg={tileSvgs[tiles.indexOf(tile)] ?? ""} className="social-slide--tile" />
                    <span>{tile.template.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {tab !== "photos" || (template && !template.needsSpread) ? null : (
            <>
              <h4>Pagine dell'album</h4>
              {([1, 2] as const).map((which) => (
                <select key={which} className="select social__full social__spread-select" value={(which === 1 ? slide.spreadId : slide.spreadId2) ?? ""} aria-label={which === 1 ? "Prima doppia pagina" : "Seconda doppia pagina (facoltativa)"}
                  onChange={(event) => commit((current) => setSlideSpread(current, slide.id, which, event.target.value || null))}>
                  <option value="">{which === 1 ? "Scegli la doppia pagina…" : "Seconda doppia pagina (facoltativa)"}</option>
                  {project.spreads.map((spread, index) => <option key={spread.id} value={spread.id}>Doppia pagina {index + 1}</option>)}
                </select>
              ))}
              <p className="muted small social-hint">Con due doppie pagine, nei formati alti si mostrano impilate.</p>
            </>
          )}

          {tab === "photos" && template && template.slots.length > 0 ? (
            <>
              <h4>{inPanorama ? "Foto del panorama" : "Foto"}</h4>
              <div className="social-slots">
                {(inPanorama ? [slide.photos[0] ?? null] : slide.photos).map((assetId, slot) => (
                  <SlotThumb key={slot} asset={assetOf(assetId)} label={inPanorama ? "Panorama" : `Foto ${slot + 1}`} slot={slot}
                    dropping={drag?.over?.kind === "slot" && drag.over.slideId === slide.id && drag.over.slot === slot}
                    onDragBegin={inPanorama || !assetId ? undefined : (pointer) => startDrag(slot, assetId, pointer, false)}
                    onPick={() => setPicker({ kind: "slot", slideId: slide.id, slot })}
                    onClear={inPanorama ? undefined : () => commit((current) => replacePhoto(current, slide.id, slot, null))} />
                ))}
              </div>
              {hasFramingPhoto ? (
                <SocialFraming slide={slide} slot={framingSlot} onSlot={setActiveSlot} shapeLocked={inPanorama}
                  onChange={(patch, key) => commit((current) => setSlideFraming(current, slide.id, framingSlot, patch), key)} />
              ) : null}
            </>
          ) : null}

          {template && tab === "texts" ? (
            <>
              <SocialTextFields
                slide={slide} template={template} brand={carousel.brand} albumName={project.projectName} tone={toneNow}
                activeField={activeField} onActiveField={setActiveField}
                onText={(key, value) => commit((current) => setSlideText(current, slide.id, key, value), `t:${slide.id}:${key}`)}
                onReset={(key) => commit((current) => resetSlideText(current, slide.id, key))}
                onStyle={(key, patch) => commit((current) => setSlideTextStyle(current, slide.id, key, patch), patch && "scale" in patch ? `style:${slide.id}:${key}` : undefined)}
                onSuggest={(key) => { const attempt = (suggestions.current.get(`${slide.id}:${key}`) ?? -1) + 1; suggestions.current.set(`${slide.id}:${key}`, attempt); commit((current) => suggestFieldText(current, slide.id, key, attempt)); }}
                onSuggestAll={() => { const attempt = (suggestions.current.get(`${slide.id}:*`) ?? -1) + 1; suggestions.current.set(`${slide.id}:*`, attempt); commit((current) => suggestSlideTexts(current, slide.id, attempt)); }}
              />
            </>
          ) : null}

          {template && tab === "look" ? (
            <>
              <h4>Fondo</h4>
              <Segmented<"auto" | Tone> label="Fondo della slide" value={slide.tone ?? "auto"} onChange={(value) => commit((current) => setSlideTone(current, slide.id, value === "auto" ? undefined : value))}
                options={[{ value: "auto", label: "Del modello" }, { value: "dark", label: "Scuro" }, { value: "light", label: "Chiaro" }]} />
              {inPanorama ? null : (
                <>
                  <h4>Disposizione</h4>
                  <Segmented<"normal" | "mirror"> label="Disposizione della slide" value={slide.flip ? "mirror" : "normal"} onChange={(value) => commit((current) => setSlideFlip(current, slide.id, value === "mirror"))}
                    options={[{ value: "normal", label: "Normale" }, { value: "mirror", label: "Specchiata" }]} />
                  <p className="muted small social-hint">Specchiata scambia destra e sinistra: lo stesso modello, con un altro aspetto.</p>
                </>
              )}
            </>
          ) : null}
        </aside>
      </div>

      {picker ? (
        <SocialPhotoPicker
          project={project}
          title={picker.kind === "panorama" ? "Scegli la foto da distendere su più slide" : "Scegli la foto"}
          used={usedNow}
          wideOnly={picker.kind === "panorama"}
          onClose={() => setPicker(null)}
          onPick={(assetId) => {
            if (picker.kind === "panorama") { setPicker(null); afterEdit(addPanorama(carousel, assetId, Number(panoCount), slide.id)); return; }
            commit((current) => replacePhoto(current, picker.slideId, picker.slot, assetId));
            setPicker(null);
          }}
          footer={picker.kind === "panorama" ? (
            <div className="social-pick__pano">
              <span className="muted small">Su quante slide? Più slide chiedono una foto più larga.</span>
              <Segmented<"2" | "3" | "4"> label="Slide del panorama" value={panoCount} onChange={setPanoCount} options={[{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }]} />
            </div>
          ) : null}
        />
      ) : null}

      {creating ? <SocialNewDialog project={project} name={`Carosello ${list.length + 1}`} setId={carousel.setId} onCancel={() => setCreating(false)}
        onCreate={(created) => { setCreating(false); commitList((current) => [...current, created]); setActiveId(created.id); setSelectedId(null); }} /> : null}
      {exporting ? <SocialExportDialog project={project} carousel={carousel} onClose={() => setExporting(false)} onStatus={onStatus} onGoTo={(index) => setSelectedId(carousel.slides[index]?.id ?? null)} /> : null}
    </div>
  );
}

