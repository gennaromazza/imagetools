import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlbumAssetTag, AlbumProjectV2, AlbumSortKey, AlbumStage, AreaTemplate } from "@photo-tools/shared-types";
import { shapeOfTree } from "../engine/tree";
import { getDesktop, hasDesktop, openInEditor, refreshChangedFiles, revealInFolder, writeRatingToXmp } from "../desktop/api";
import { candidatesFromFiles, chooseFolderAndScan, fileKey, scanDroppedPaths } from "../desktop/importer";
import { alignFitAreas, refreshAssetShapes, applyCandidate, applyCandidateByNumber, applyFavoriteLayout, applyStyleToAlbum, applyStyleToSpread, mirrorArea, removeFavoriteLayout, resetDividerRatio, saveFavoriteLayout, setAreaStyle, setDividerRatio, setLinked, shuffleArea, shuffleSpread } from "../model/areas";
import { autoBuildAlbum, fillSpread, nextEmptySpread, nextUnusedAssets, type AutoBuildOptions } from "../model/autobuild";
import { applyChapterPreset, assignAssets, createChapter, moveChapter, recolorChapter, removeChapter, renameChapter, type ChapterPreset } from "../model/chapters";
import { applyImport, folderOf, planImport } from "../model/import";
import { alignArea, appendAssets, dropOnSpread, moveToNewSpread, moveToSpread, removeItem, replaceItemAsset, resetItemView, setItemView, toggleItemLock } from "../model/items";
import { assetUsage, unusedAssets, clearRatings, setRatingPolicy, locateAsset, removeAssets, reorderAssets, setRating, setSortKey, toggleAssetTag, type LibraryTab } from "../model/library";
import { findItem, nowIso, touch } from "../model/project";
import { addSpread, clearSpread, duplicateSpread, moveSpread, removeSpread, setSpreadDone, setSplitMode, swapAreas } from "../model/spreads";
import { STAGES } from "../model/store";
import { canRedo, canUndo, createHistory, pushHistory, redo, replacePresent, undo, type History } from "../history";
import { AutoBuildDialog } from "./AutoBuildDialog";
import { ChapterManager } from "./ChapterManager";
import { ClientPreview } from "./ClientPreview";
import { isExternalFileDrag } from "./dnd";
import { ExportDialog } from "./ExportDialog";
import { FormatDialog } from "./FormatDialog";
import { TemplateEditor, seedFromArea, type TemplateSeed } from "./TemplateEditor";
import { applyTemplate as applyTemplateModel, applyTemplatesToAlbum, createTemplateId, loadTemplates, removeTemplate, reorderFrame, saveTemplates, setFrame, templateFromArea, templateTarget, upsertTemplate } from "../model/templates";
import { Filmstrip } from "./Filmstrip";
import { Icon } from "./icons";
import { ImportDialog, type ImportDecision, type ImportSource } from "./ImportDialog";
import { LibraryDock } from "./LibraryDock";
import { PhotoViewer } from "./PhotoViewer";
import { ShortcutsDialog } from "./ShortcutsDialog";
import type { Draft } from "./SpreadView";
import { Stage, type StageActions } from "./Stage";
import type { DesignActions, DesignTab } from "./DesignPanel";
import { CloudDialog } from "./CloudDialog";
import { RelinkDialog } from "./RelinkDialog";
import { useMissingPhotos } from "../hooks/useMissingPhotos";
import { useNewFeature } from "../hooks/useNewFeature";
import { applyRelink } from "../model/relinkAssets";
import { driveAvailable } from "../desktop/cloud";
import { addGraphicOverlay, addTextOverlay, addTextStack, duplicateOverlay, orderOverlay, groupOverlays, moveOverlayGroup, removeOverlay, setAlbumBackground, setSpreadBackground, ungroupOverlay, updateOverlay, updateSpreadBackground } from "../model/design";
import { IconButton } from "./ui";
import { useStableCallbacks } from "../hooks/useStableCallbacks";

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable;
};

function readNumber(key: string, fallback: number): number {
  try { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : fallback; } catch { return fallback; }
}
function writeNumber(key: string, value: number) {
  try { localStorage.setItem(key, String(value)); } catch { /* preferenza non critica */ }
}

export interface WorkspaceProps {
  initial: AlbumProjectV2;
  onChange: (project: AlbumProjectV2) => void;
  onExit: () => void;
  /** Apre come album nuovo una copia (ripristino da Drive): quello attuale non viene toccato. */
  onOpenCopy?: (copy: AlbumProjectV2) => void;
}

interface Toast { message: string; undo?: boolean }

/** L'editor: cronologia, selezione, gesti sulle foto, libreria, importazione, esportazione. */
export function Workspace({ initial, onChange, onExit, onOpenCopy }: WorkspaceProps) {
  const [history, setHistoryState] = useState<History<AlbumProjectV2>>(() => createHistory(initial));
  // La cronologia più recente vive anche in una ref: i comandi si applicano in modo sincrono (una sola volta, anche in
  // StrictMode) e due modifiche nello stesso istante si compongono invece di sovrascriversi.
  const historyRef = useRef(history);
  const setHistory = useCallback((next: History<AlbumProjectV2>) => { historyRef.current = next; setHistoryState(next); }, []);
  const project = history.present;
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onChange(project);
  }, [onChange, project]);

  const [spreadIndex, setSpreadIndex] = useState(0);
  const [activeArea, setActiveArea] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  // «Personalizza»: pannello di sfondi, testi e libreria; il testo o la grafica selezionati stanno sopra le foto.
  const [designOpen, setDesignOpen] = useState(false);
  const [designTab, setDesignTab] = useState<DesignTab>("text");
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  // Elementi selezionati insieme al principale (Maiusc o Ctrl+clic), per agganciarli.
  const [extraOverlayIds, setExtraOverlayIds] = useState<string[]>([]);
  useEffect(() => { if (!selectedOverlayId) setExtraOverlayIds([]); }, [selectedOverlayId]);
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [libTab, setLibTab] = useState<LibraryTab>("all");
  const [libSelection, setLibSelection] = useState<string[]>([]);
  /** Richiesta di mostrare una foto nella libreria (tasto destro → «Trova nella libreria»). */
  const [revealAsset, setRevealAsset] = useState<{ id: string; n: number } | null>(null);
  const [thumbSize, setThumbSize] = useState(() => readNumber("filex.albumFlow.thumbSize", 120));
  // Altezza della libreria: finché non la sposti tu si adatta alla finestra (null).
  const [dockHeight, setDockHeight] = useState<number | null>(() => { const stored = readNumber("filex.albumFlow.dockHeight", 0); return stored >= 120 ? stored : null; });
  const [dockCollapsed, setDockCollapsed] = useState(() => readNumber("filex.albumFlow.dockCollapsed", 0) === 1);
  const toggleDock = useCallback(() => setDockCollapsed((collapsed) => { writeNumber("filex.albumFlow.dockCollapsed", collapsed ? 0 : 1); return !collapsed; }), []);
  const [zoom, setZoom] = useState(1);
  const [guides, setGuides] = useState(false);
  const [sizes, setSizes] = useState(() => readNumber("filex.albumFlow.sizes", 0) === 1);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [zone, setZone] = useState<"stage" | "library">("stage");
  const [dialog, setDialog] = useState<null | "autobuild" | "export" | "shortcuts" | "chapters" | "format" | "template" | "cloud" | "relink">(null);
  const [templates, setTemplates] = useState<AreaTemplate[]>(() => loadTemplates());
  const [templateEdit, setTemplateEdit] = useState<{ initial?: AreaTemplate; seed?: TemplateSeed } | null>(null);
  const [viewer, setViewer] = useState<null | { ids: string[]; index: number }>(null);
  const [presenting, setPresenting] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [dropOverlay, setDropOverlay] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const desktop = hasDesktop();

  const notify = useCallback((message: string, undoable = false) => {
    setToast({ message, undo: undoable });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), undoable ? 7000 : 4500);
  }, []);

  const storeTemplates = useCallback((next: AreaTemplate[]) => { setTemplates(next); if (!saveTemplates(next)) notify("Non riesco a salvare i template su questo computer."); }, [notify]);

  const commit = useCallback((updater: (current: AlbumProjectV2) => AlbumProjectV2, coalesceKey?: string) => {
    const current = historyRef.current;
    let next: AlbumProjectV2;
    try { next = updater(current.present); } catch (error) {
      notify(error instanceof Error ? error.message : "Operazione non riuscita.");
      return;
    }
    const now = Date.now();
    const previous = lastCoalesce.current;
    const merge = Boolean(coalesceKey) && previous !== null && previous.key === coalesceKey && now - previous.at < 900;
    lastCoalesce.current = coalesceKey ? { key: coalesceKey, at: now } : null;
    setHistory(merge ? replacePresent(current, next) : pushHistory(current, next));
  }, [notify, setHistory]);

  const assets = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets]);
  const usage = useMemo(() => assetUsage(project), [project]);
  const count = project.spreads.length;
  const index = Math.min(spreadIndex, Math.max(count - 1, 0));
  const spread = project.spreads[index];
  const areaIndex = spread ? Math.min(activeArea, spread.areas.length - 1) : 0;

  useEffect(() => { if (spreadIndex !== index) setSpreadIndex(index); }, [index, spreadIndex]);
  useEffect(() => {
    if (selectedItemId && !spread?.areas.some((area) => area.items.some((item) => item.id === selectedItemId))) { setSelectedItemId(null); setCropMode(false); }
  }, [selectedItemId, spread]);
  useEffect(() => { if (activeArea !== areaIndex) setActiveArea(areaIndex); }, [activeArea, areaIndex]);

  // Un file modificato fuori dal programma (per esempio salvato da Photoshop): al ritorno nella finestra le foto si rileggono
  // e, se le misure sono cambiate, i layout si riallineano.
  useEffect(() => {
    if (!hasDesktop()) return undefined;
    let busy = false;
    let last = 0;
    const check = async () => {
      if (busy || document.visibilityState === "hidden" || Date.now() - last < 1500) return;
      busy = true;
      last = Date.now();
      try {
        const withPath = historyRef.current.present.assets.filter((asset) => asset.absolutePath);
        const changed = new Set(await refreshChangedFiles(withPath.map((asset) => asset.absolutePath!)));
        if (changed.size === 0) return;
        const updates: Array<{ assetId: string; width: number; height: number }> = [];
        for (const asset of withPath) {
          if (!changed.has(asset.absolutePath!)) continue;
          const size = await getDesktop()?.getImageDimensions?.(asset.absolutePath!).catch(() => null);
          if (size) updates.push({ assetId: asset.id, width: size.width, height: size.height });
        }
        if (updates.length) commit((p) => refreshAssetShapes(p, updates));
        notify(changed.size === 1 ? "Una foto è stata modificata sul disco: l'ho aggiornata." : `${changed.size} foto sono state modificate sul disco: le ho aggiornate.`);
      } finally { busy = false; }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [commit, notify]);

  // Le stelle cambiate (anche con annulla/ripeti) vengono scritte nel file XMP accanto alla foto, come fa il Selector.
  const ratings = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    for (const asset of project.assets) {
      const value = asset.rating ?? 0;
      const known = ratings.current.get(asset.id);
      if (known === undefined) ratings.current.set(asset.id, value);
      else if (known !== value) {
        ratings.current.set(asset.id, value);
        if (asset.absolutePath && getDesktop() && project.settings.ratingPolicy !== "project") void writeRatingToXmp(asset.absolutePath, value).then((ok) => { if (!ok) notify("Non sono riuscito a scrivere le stelle nel file XMP: restano salvate nell'album."); });
      }
    }
  }, [project.assets, notify]);

  const goTo = useCallback((next: number) => {
    setSpreadIndex(Math.min(Math.max(next, 0), Math.max(count - 1, 0)));
    setSelectedItemId(null); setSelectedOverlayId(null); setCropMode(false); setDraft(null); setActiveArea(0);
  }, [count]);

  const doUndo = useCallback(() => { lastCoalesce.current = null; setHistory(undo(historyRef.current)); setDraft(null); }, [setHistory]);
  const doRedo = useCallback(() => { lastCoalesce.current = null; setHistory(redo(historyRef.current)); setDraft(null); }, [setHistory]);

  // ------------------------------------------------------------------- libreria
  /** Avviso per le foto già presenti altrove nell'album: una foto dalla libreria si copia, quindi finirebbe in due posti. */
  const usedNote = useCallback((ids: readonly string[], _where?: number): string => {
    const spreads = new Set<number>();
    let count = 0;
    for (const id of ids) {
      const refs = usage.get(id) ?? [];
      if (refs.length) { count += 1; refs.forEach((ref) => spreads.add(ref.spreadIndex + 1)); }
    }
    if (count === 0) return "";
    return ` Attenzione: ${count === 1 ? "è già" : `${count} sono già`} nell'album (spread ${[...spreads].sort((a, b) => a - b).slice(0, 4).join(", ")}): ora ${count === 1 ? "compare" : "compaiono"} due volte.`;
  }, [usage]);

  const placeAssets = useCallback((assetIds: string[]) => {
    if (assetIds.length === 0) return;
    let targetSpread = index;
    const created = project.spreads.length === 0;
    commit((p) => {
      let next = p;
      if (next.spreads.length === 0) next = addSpread(next);
      const current = next.spreads[Math.min(index, next.spreads.length - 1)];
      const area = Math.min(areaIndex, current.areas.length - 1);
      const after = selectedItemId && current.areas[area].items.some((item) => item.id === selectedItemId) ? selectedItemId : undefined;
      return appendAssets(next, current.id, area, assetIds, after);
    });
    if (created) { targetSpread = 0; setSpreadIndex(0); }
    const room = project.spreads[targetSpread]?.areas[areaIndex]?.items.length ?? 0;
    notify(room + assetIds.length > 12 ? "Un'area contiene al massimo 12 foto." : `${assetIds.length === 1 ? "Foto aggiunta" : `${assetIds.length} foto aggiunte`} allo spread ${targetSpread + 1}.${usedNote(assetIds, targetSpread)}`);
  }, [areaIndex, commit, index, notify, project.spreads, selectedItemId]);

  const rate = useCallback((assetId: string, rating: number) => commit((p) => setRating(p, assetId, rating)), [commit]);
  const rateMany = useCallback((ids: string[], rating: number) => commit((p) => ids.reduce((current, id) => setRating(current, id, rating), p)), [commit]);
  const tagMany = useCallback((ids: string[], tag: AlbumAssetTag) => {
    commit((p) => ids.reduce((current, id) => toggleAssetTag(current, id, tag), p));
    notify("Segnalazione aggiornata: con Auto Build le foto «copertina» e «principale» hanno un'area propria, il «panorama» un foglio intero.");
  }, [commit, notify]);

  const assign = useCallback((ids: string[], chapterId: string | null) => {
    commit((p) => assignAssets(p, ids, chapterId));
    const chapter = chapterId ? project.chapters.find((candidate) => candidate.id === chapterId) : null;
    notify(`${ids.length === 1 ? "Foto spostata" : `${ids.length} foto spostate`} ${chapter ? `in «${chapter.title}»` : "fuori dai capitoli"}.`);
  }, [commit, notify, project.chapters]);

  const localize = useCallback((assetId: string) => {
    const ref = locateAsset(project, assetId);
    if (!ref) { notify("Questa foto non è ancora in nessuno spread."); return; }
    goTo(ref.spreadIndex);
    setActiveArea(ref.areaIndex);
    setSelectedItemId(ref.itemId);
    setHighlightItemId(ref.itemId);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setHighlightItemId(null), 1800);
  }, [goTo, notify, project]);

  const openViewer = useCallback((assetId: string, ids: string[]) => {
    const at = ids.indexOf(assetId);
    setViewer({ ids: ids.length ? ids : [assetId], index: Math.max(0, at) });
  }, []);

  const viewItem = useCallback((itemId: string) => {
    if (!spread) return;
    const ids = spread.areas.flatMap((area) => area.items.map((item) => item.assetId));
    const found = findItem(project, itemId);
    if (found) openViewer(found.item.assetId, Array.from(new Set(ids)));
  }, [openViewer, project, spread]);

  const edit = useCallback(async (assetId: string) => {
    const asset = assets.get(assetId);
    if (!asset?.absolutePath) return;
    const result = await openInEditor(asset.absolutePath);
    notify(result.message);
  }, [assets, notify]);

  const reveal = useCallback(async (assetId: string) => {
    const asset = assets.get(assetId);
    if (asset?.absolutePath && !(await revealInFolder(asset.absolutePath))) notify("Il file non si trova più nella sua cartella.");
  }, [assets, notify]);

  /** Copia uno o più nomi di file, uno per riga, nell'ordine in cui sono nella libreria. */
  const copyName = useCallback(async (assetIds: string[]) => {
    const chosen = assetIds.map((id) => assets.get(id)).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    if (chosen.length === 0) return;
    const order = new Map(project.assets.map((asset, index) => [asset.id, index]));
    chosen.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    try {
      await navigator.clipboard.writeText(chosen.map((asset) => asset.fileName).join("\n"));
      notify(chosen.length === 1 ? `Nome copiato: ${chosen[0].fileName}` : `${chosen.length} nomi copiati, uno per riga.`);
    } catch { notify("Non riesco a copiare negli appunti."); }
  }, [assets, notify, project.assets]);

  // ------------------------------------------------------------------ importazione
  const importFolder = useCallback(async () => {
    try {
      const result = await chooseFolderAndScan();
      if (!result) return;
      if (result.candidates.length === 0) { notify("Nessuna foto trovata nella cartella scelta."); return; }
      setImportSource({ candidates: result.candidates, label: result.sourceName ? `Cartella «${result.sourceName}»` : "Cartella scelta", ignoredRaw: result.ignoredRaw, folders: result.folders, originals: null });
    } catch (error) { notify(error instanceof Error ? error.message : "Impossibile leggere la cartella."); }
  }, [notify]);

  const importFromFiles = useCallback((files: File[]) => {
    const candidates = candidatesFromFiles(files);
    if (candidates.length === 0) { notify("Nessun file immagine riconosciuto (JPG, PNG, WebP, TIFF, RAW)."); return; }
    const originals = new Map(files.map((file) => [fileKey(file), file]));
    setImportSource({ candidates, label: candidates.length === 1 ? candidates[0].fileName : `${candidates.length} foto scelte`, ignoredRaw: 0, folders: 0, originals });
  }, [notify]);

  const confirmImport = useCallback((decision: ImportDecision) => {
    setImportSource(null);
    let added = 0;
    let skipped = 0;
    let chapterTitle = "";
    let targetTab: LibraryTab = libTab;
    commit((p) => {
      let next = p;
      let chapterId = decision.chapterId;
      if (decision.newChapterTitle) {
        next = createChapter(next, decision.newChapterTitle);
        chapterId = next.chapters[next.chapters.length - 1].id;
      }
      const plan = planImport(next, decision.candidates);
      const result = applyImport(next, plan, { chapterId, duplicates: decision.duplicates });
      added = result.addedAssetIds.length;
      skipped = result.skipped;
      chapterTitle = chapterId ? result.project.chapters.find((chapter) => chapter.id === chapterId)?.title ?? "" : "";
      targetTab = chapterId ?? "all";
      const firstPath = decision.candidates.find((candidate) => candidate.absolutePath)?.absolutePath;
      return result.project.sourceFolderPath || !firstPath ? result.project : touch({ ...result.project, sourceFolderPath: folderOf(firstPath) });
    });
    setLibTab(targetTab);
    notify(added === 0 ? "Nessuna nuova foto da importare." : `${added} ${added === 1 ? "foto importata" : "foto importate"}${chapterTitle ? ` in «${chapterTitle}»` : ""}${skipped ? `, ${skipped} già presenti saltate` : ""}.`);
  }, [commit, libTab, notify]);

  // Trascinamento di file e cartelle dal sistema sulla finestra.
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!isExternalFileDrag(event as unknown as { dataTransfer: DataTransfer | null })) return;
      event.preventDefault();
      setDropOverlay(true);
    };
    const leave = (event: DragEvent) => { if (event.relatedTarget === null) setDropOverlay(false); };
    const drop = (event: DragEvent) => {
      if (!isExternalFileDrag(event as unknown as { dataTransfer: DataTransfer | null })) return;
      event.preventDefault();
      setDropOverlay(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const api = getDesktop();
      if (api?.getPathForFile) {
        const paths = files.map((file) => { try { return api.getPathForFile(file); } catch { return ""; } }).filter(Boolean);
        void scanDroppedPaths(paths).then((result) => {
          if (result.candidates.length === 0) { notify("Nessuna foto trovata tra gli elementi trascinati."); return; }
          setImportSource({ candidates: result.candidates, label: result.folders ? `${result.folders} ${result.folders === 1 ? "cartella trascinata" : "cartelle trascinate"}` : `${result.candidates.length} foto trascinate`, ignoredRaw: result.ignoredRaw, folders: result.folders, originals: null });
        });
      } else importFromFiles(files);
    };
    window.addEventListener("dragenter", over);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", over); window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, [importFromFiles, notify]);

  // -------------------------------------------------------------------- azioni dello spread
  const spreadId = spread?.id ?? "";
  const actions: StageActions = useMemo(() => ({
    activateArea: (i) => setActiveArea(i),
    selectItem: (itemId, i) => { setZone("stage"); setActiveArea(i); setSelectedOverlayId(null); setSelectedItemId(itemId); if (!itemId) setCropMode(false); else setCropMode((on) => (itemId === selectedItemId ? on : false)); },
    toggleCrop: (itemId) => {
      const found = findItem(project, itemId);
      if (!found) return;
      if (found.item.locked) { notify("La foto è bloccata: sbloccala per ritagliarla."); return; }
      if (found.area.style.mode !== "fill") { notify("Per ritagliare passa a «Riempi lo spazio» (pulsante MODO)."); return; }
      setSelectedItemId(itemId);
      setActiveArea(found.areaIndex);
      setCropMode((on) => (selectedItemId === itemId ? !on : true));
    },
    dropAssets: (target, ids) => {
      const area = spread?.areas[target.areaIndex];
      commit((p) => dropOnSpread(p, spreadId, target, { kind: "assets", assetIds: ids }));
      setActiveArea(target.areaIndex);
      if (area && area.items.length + ids.length > 12 && target.zone !== "center") notify("Un'area contiene al massimo 12 foto.");
      else { const note = usedNote(ids, index); if (note) notify(`Foto aggiunta.${note}`, true); }
    },
    dropItem: (target, itemId) => { commit((p) => dropOnSpread(p, spreadId, target, { kind: "item", itemId })); setActiveArea(target.areaIndex); },
    setDraft,
    commitRatio: (i, path, ratio) => { setDraft(null); commit((p) => setDividerRatio(p, spreadId, i, path, ratio), `ratio:${spreadId}:${i}:${path}`); },
    resetRatio: (i, path) => commit((p) => resetDividerRatio(p, spreadId, i, path)),
    commitView: (itemId, view) => { setDraft(null); commit((p) => setItemView(p, itemId, { zoom: view.zoom, cx: view.cx, cy: view.cy, angle: view.angle }), `view:${itemId}`); },
    style: (i, changes, key) => commit((p) => setAreaStyle(p, spreadId, i, changes), key ? `style:${spreadId}:${i}:${key}` : undefined),
    align: (i, align) => commit((p) => alignArea(p, spreadId, i, align)),
    split: (mode) => { commit((p) => setSplitMode(p, spreadId, mode)); setActiveArea(0); setSelectedItemId(null); },
    link: () => commit((p) => setLinked(p, spreadId, !spread?.linked)),
    swapAreas: () => commit((p) => swapAreas(p, spreadId)),
    shuffleArea: (i) => { if (spread?.done) { notify("Spread finito: riaprilo (D) per cambiare il layout."); return; } commit((p) => shuffleArea(p, spreadId, i, 1, templates)); },
    shuffleSpread: () => { if (spread?.done) { notify("Spread finito: riaprilo (D) per cambiare il layout."); return; } commit((p) => shuffleSpread(p, spreadId, 1, templates)); },
    fillSpread: () => {
      if (!spread) return;
      if (spread.done) { notify("Spread finito: riaprilo (D) per modificarlo."); return; }
      const before = unusedAssets(historyRef.current.present).length;
      commit((p) => fillSpread(p, spreadId));
      const added = before - unusedAssets(historyRef.current.present).length;
      notify(added > 0 ? `${added} ${added === 1 ? "foto aggiunta" : "foto aggiunte"} allo spread ${index + 1}.` : before === 0 ? "Non ci sono più foto da usare." : "Lo spread non ha pagine vuote da riempire.", added > 0);
    },
    toggleDone: () => { if (!spread) return; commit((p) => setSpreadDone(p, spreadId, !spread.done)); notify(spread.done ? `Spread ${index + 1} riaperto.` : `Spread ${index + 1} segnato come finito: Auto Build e Mescola non lo toccano.`, true); },
    toggleFavorite: (i) => {
      const area = spread?.areas[i];
      if (!area?.layout) return;
      const signature = JSON.stringify(shapeOfTree(area.layout));
      const existing = project.favoriteLayouts.find((favorite) => JSON.stringify(favorite.layout) === signature);
      if (existing) { commit((p) => removeFavoriteLayout(p, existing.id)); notify("Layout tolto dai preferiti."); }
      else { commit((p) => saveFavoriteLayout(p, spreadId, i)); notify("Layout salvato nei preferiti: lo ritrovi tra i layout con lo stesso numero di foto."); }
    },
    openLayouts: (open) => { setLayoutsOpen(open); if (open) setDesignOpen(false); },
    applyLayout: (i, candidate) => commit((p) => applyCandidate(p, spreadId, i, candidate, templates)),
    newTemplate: (i) => { const area = spread?.areas[i]; setTemplateEdit({ seed: area && spread ? seedFromArea(area, templateTarget(spread, i)) ?? { kind: "tree", target: templateTarget(spread, i) } : undefined }); setDialog("template"); },
    editTemplate: (templateId, asCopy) => { const found = templates.find((candidate) => candidate.id === templateId); const initial = found && asCopy ? { ...found, id: createTemplateId(), name: `${found.name} (copia)`, createdAt: new Date().toISOString() } : found; if (initial) { setTemplateEdit({ initial }); setDialog("template"); } },
    deleteTemplate: (templateId) => { const old = templates.find((candidate) => candidate.id === templateId); storeTemplates(removeTemplate(templates, templateId)); notify(`Template «${old?.name ?? ""}» eliminato.`); },
    saveAsTemplate: (i) => {
      const made = templateFromArea(historyRef.current.present, spreadId, i, "");
      if (!made) { notify("Serve un layout con delle foto."); return; }
      try { storeTemplates(upsertTemplate(templates, { ...made, name: `${made.kind === "free" ? "Libero" : "Divisioni"} ${made.count} foto` })); notify("Layout salvato nei tuoi template: lo trovi nell'elenco dei layout."); } catch (error) { notify(error instanceof Error ? error.message : "Template non salvato."); }
    },
    commitFrame: (itemId, frame) => commit((p) => setFrame(p, itemId, frame), `frame:${itemId}`),
    orderFrame: (itemId, where) => commit((p) => reorderFrame(p, itemId, where)),
    rotateFrame: (itemId, delta) => commit((p) => { const f = findItem(p, itemId); const current = f?.area.free?.[itemId]; return current ? setFrame(p, itemId, { rotation: current.rotation + delta }) : p; }, `rotate:${itemId}`),
    applyFavorite: (i, favoriteId) => commit((p) => applyFavoriteLayout(p, spreadId, i, favoriteId)),
    removeFavorite: (favoriteId) => commit((p) => removeFavoriteLayout(p, favoriteId)),
    applyStyle: (i, scope) => { commit((p) => (scope === "spread" ? applyStyleToSpread(p, spreadId, i) : applyStyleToAlbum(p, spreadId, i))); notify(scope === "spread" ? "Stile copiato sull'intero spread." : "Stile copiato su tutto l'album."); },
    deleteSpread: () => { commit((p) => removeSpread(p, spreadId)); setSelectedItemId(null); notify(`Spread ${index + 1} eliminato.`, true); },
    duplicateSpread: () => { commit((p) => duplicateSpread(p, spreadId)); setSpreadIndex(index + 1); },
    clearSpread: () => { commit((p) => clearSpread(p, spreadId)); setSelectedItemId(null); notify("Spread svuotato.", true); },
    mirror: (i) => commit((p) => mirrorArea(p, spreadId, i, "horizontal")),
    editItem: (itemId) => { const found = findItem(project, itemId); if (found) void edit(found.item.assetId); },
    removeItem: (itemId) => { commit((p) => removeItem(p, itemId)); setSelectedItemId(null); setCropMode(false); },
    lockItem: (itemId) => commit((p) => toggleItemLock(p, itemId)),
    viewItem,
    revealItem: (itemId) => { const found = findItem(project, itemId); if (found) void reveal(found.item.assetId); },
    copyItemName: (itemId) => { const found = findItem(project, itemId); if (found) void copyName([found.item.assetId]); },
    locateInLibrary: (itemId) => {
      const found = findItem(project, itemId);
      if (!found) return;
      setLibTab("all");
      setLibSelection([found.item.assetId]);
      setDockCollapsed((collapsed) => { if (collapsed) writeNumber("filex.albumFlow.dockCollapsed", 0); return false; });
      setRevealAsset((previous) => ({ id: found.item.assetId, n: (previous?.n ?? 0) + 1 }));
    },
    resetItemView: (itemId) => commit((p) => resetItemView(p, itemId)),
    replaceWithSelection: (itemId) => {
      const chosen = keys.current.libSelection;
      if (chosen.length !== 1) { notify("Scegli prima UNA foto nella libreria in basso, poi usa questa voce."); return; }
      commit((p) => replaceItemAsset(p, itemId, chosen[0]));
    },
    rate,
    goTo,
    setZoom,
    toggleGuides: () => setGuides((on) => !on),
    toggleSizes: () => setSizes((on) => { writeNumber("filex.albumFlow.sizes", on ? 0 : 1); return !on; }),
    alignPhotos: (scope) => {
      const before = historyRef.current.present;
      commit((p) => alignFitAreas(p, scope === "spread" ? spreadId : undefined));
      notify(historyRef.current.present === before ? "Le foto sono già allineate (l'allineamento vale per le aree in «foto intera»)." : scope === "spread" ? "Foto dello spread allineate." : "Foto di tutto l'album allineate.", historyRef.current.present !== before);
    },
    addSpreadAfter: () => { commit((p) => addSpread(p, index + 1)); setSpreadIndex(index + 1); setSelectedItemId(null); setActiveArea(0); },
  }), [commit, edit, goTo, index, notify, project, rate, selectedItemId, spread, spreadId, storeTemplates, templates, viewItem]);

  // ------------------------------------------------------------- sfondi, testi e grafiche
  const designActions: DesignActions = useMemo(() => ({
    addText: (options) => {
      if (!spreadId) return;
      let created: string | null = null;
      commit((p) => { const made = addTextStack(p, spreadId, options); created = made.overlayId; return made.project; });
      if (!created) { notify("Su questo spread ci sono già troppi elementi."); return; }
      setSelectedOverlayId(created); setSelectedItemId(null); setCropMode(false); setDesignTab("text"); setFocusSignal((value) => value + 1);
    },
    addGraphic: (options) => {
      if (!spreadId) return;
      let created: string | null = null;
      commit((p) => { const made = addGraphicOverlay(p, spreadId, options); created = made.overlayId; return made.project; });
      if (!created) { notify("Su questo spread ci sono già troppi elementi."); return; }
      setSelectedOverlayId(created); setSelectedItemId(null); setCropMode(false); setDesignTab("text");
    },
    update: (overlayId, patch) => commit((p) => updateOverlay(p, spreadId, overlayId, patch), `ov:${overlayId}`),
    remove: (overlayId) => { commit((p) => removeOverlay(p, spreadId, overlayId)); setSelectedOverlayId(null); },
    duplicate: (overlayId) => {
      let created: string | null = null;
      commit((p) => { const made = duplicateOverlay(p, spreadId, overlayId); created = made.overlayId; return made.project; });
      if (created) setSelectedOverlayId(created);
    },
    group: (overlayIds) => { commit((p) => groupOverlays(p, spreadId, overlayIds)); setExtraOverlayIds([]); notify("Elementi agganciati: ora si spostano insieme."); },
    ungroup: (overlayId) => { commit((p) => ungroupOverlay(p, spreadId, overlayId)); notify("Elemento sganciato: ora si sposta da solo."); },
    order: (overlayId, where) => commit((p) => orderOverlay(p, spreadId, overlayId, where)),
    select: (overlayId) => { setSelectedOverlayId(overlayId); if (overlayId) { setSelectedItemId(null); setCropMode(false); } },
    setBackground: (scope, choice, wholeAlbum) => {
      if (wholeAlbum) { commit((p) => setAlbumBackground(p, scope, choice)); notify("Sfondo applicato a tutti gli spread (quelli finiti sono rimasti com'erano).", true); }
      else commit((p) => setSpreadBackground(p, spreadId, scope, choice));
    },
    updateBackground: (scope, patch) => commit((p) => updateSpreadBackground(p, spreadId, scope, patch), `bg:${spreadId}:${scope}`),
    notify,
  }), [commit, notify, spreadId]);
  const designHandlers = useMemo(() => ({
    selectedId: selectedOverlayId,
    extraIds: extraOverlayIds,
    onSelect: (overlayId: string | null, additive?: boolean) => {
      if (additive && overlayId && selectedOverlayId && overlayId !== selectedOverlayId) { setExtraOverlayIds((current) => (current.includes(overlayId) ? current.filter((id) => id !== overlayId) : [...current, overlayId])); return; }
      if (additive && overlayId && !selectedOverlayId) { setSelectedOverlayId(overlayId); setSelectedItemId(null); setCropMode(false); setDesignOpen(true); setDesignTab("text"); return; }
      setExtraOverlayIds([]);
      setSelectedOverlayId(overlayId); if (overlayId) { setSelectedItemId(null); setCropMode(false); setDesignOpen(true); setDesignTab("text"); } },
    onCommit: (overlayId: string, patch: Parameters<typeof updateOverlay>[3]) => commit((p) => updateOverlay(p, spreadId, overlayId, patch), `ov:${overlayId}`),
    onMoveBy: (overlayId: string, dx: number, dy: number) => commit((p) => moveOverlayGroup(p, spreadId, overlayId, dx, dy), `ov:${overlayId}`),
    onEdit: (overlayId: string) => { setSelectedOverlayId(overlayId); setDesignOpen(true); setDesignTab("text"); setFocusSignal((value) => value + 1); },
  }), [commit, extraOverlayIds, selectedOverlayId, spreadId]);
  useEffect(() => { if (designOpen) { setLayoutsOpen(false); setSelectedItemId(null); setCropMode(false); } }, [designOpen]);

  // --------------------------------------------------------------------- scorciatoie
  const keys = useRef({ spread, areaIndex, selectedItemId, selectedOverlayId, cropMode, count, index, zone, libSelection, layoutsOpen });
  keys.current = { spread, areaIndex, selectedItemId, selectedOverlayId, cropMode, count, index, zone, libSelection, layoutsOpen };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || dialog || presenting || viewer || importSource) return;
      const state = keys.current;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && key === "y") { event.preventDefault(); doRedo(); return; }
      if (mod && key === "d") { event.preventDefault(); if (state.spread) actions.duplicateSpread(); return; }
      if (mod && key === "b") { event.preventDefault(); setDialog("autobuild"); return; }
      if (mod && key === "e") { event.preventDefault(); setDialog("export"); return; }
      if (mod && key === "l") { event.preventDefault(); if (state.spread && state.spread.areas.length > 1) actions.link(); return; }
      if (mod && key === "j") { event.preventDefault(); toggleDock(); return; }
      if (!mod && !event.altKey && (key === "f" || key === "d" || key === "n" || key === "u") && state.spread) {
        event.preventDefault();
        if (key === "f") actions.fillSpread();
        else if (key === "d") actions.toggleDone();
        else if (key === "n") { const next = nextEmptySpread(historyRef.current.present, state.index); if (next >= 0) goTo(next); else notify("Nessuno spread ha pagine vuote."); }
        else {
          const [asset] = nextUnusedAssets(historyRef.current.present, 1, state.spread.areas.flatMap((area) => area.items.map((item) => item.assetId)));
          if (asset) placeAssets([asset.id]); else notify("Non ci sono più foto da usare.");
        }
        return;
      }
      if (mod || event.altKey) return;
      switch (event.key) {
        case "ArrowLeft": event.preventDefault(); goTo(state.index - 1); return;
        case "ArrowRight": event.preventDefault(); goTo(state.index + 1); return;
        case "ArrowUp": event.preventDefault(); if (state.spread) actions.shuffleArea(state.areaIndex); return;
        case "ArrowDown": event.preventDefault(); if (state.spread) commit((p) => shuffleArea(p, state.spread!.id, state.areaIndex, -1, templates)); return;
        case "Home": event.preventDefault(); goTo(0); return;
        case "End": event.preventDefault(); goTo(state.count - 1); return;
        case "Delete": case "Backspace":
          if (state.selectedOverlayId && state.spread) { event.preventDefault(); const target = state.selectedOverlayId; commit((p) => removeOverlay(p, state.spread!.id, target)); setSelectedOverlayId(null); return; }
          if (state.selectedItemId) { event.preventDefault(); actions.removeItem(state.selectedItemId); } return;
        case "Enter": if (state.selectedItemId) { event.preventDefault(); actions.toggleCrop(state.selectedItemId); } return;
        case "Escape":
          if (state.cropMode) setCropMode(false);
          else if (state.selectedOverlayId) setSelectedOverlayId(null);
          else if (state.selectedItemId) setSelectedItemId(null);
          else if (state.libSelection.length) setLibSelection([]);
          else if (state.layoutsOpen) setLayoutsOpen(false);
          return;
        case " ":
          event.preventDefault();
          if (state.zone === "library" && state.libSelection.length) openViewer(state.libSelection[state.libSelection.length - 1], state.libSelection);
          else if (state.selectedItemId) viewItem(state.selectedItemId);
          return;
        case "F5": event.preventDefault(); if (state.count > 0) setPresenting(true); return;
        case "+": case "=": setZoom((value) => Math.min(3, Number((value + 0.15).toFixed(2)))); return;
        case "-": setZoom((value) => Math.max(0.4, Number((value - 0.15).toFixed(2)))); return;
        case "?": setDialog("shortcuts"); return;
        default:
      }
      if (/^[1-9]$/.test(event.key) && state.spread && state.spread.areas[state.areaIndex].items.length > 0) { commit((p) => applyCandidateByNumber(p, state.spread!.id, state.areaIndex, Number(event.key), templates)); return; }
      if (key === "0") { if (state.selectedItemId) commit((p) => resetItemView(p, state.selectedItemId!)); else setZoom(1); }
      else if ((key === "," || key === ".") && state.cropMode && state.selectedItemId) {
        const current = findItem(historyRef.current.present, state.selectedItemId)?.item.angle ?? 0;
        commit((p) => setItemView(p, state.selectedItemId!, { angle: current + (key === "." ? 0.5 : -0.5) }), `view:${state.selectedItemId}`);
      }
      else if (key === "g") setGuides((on) => !on);
      else if (key === "s") actions.toggleSizes();
      else if (key === "b" && state.spread) setLayoutsOpen((open) => !open);
      else if (key === "l" && state.selectedItemId) actions.lockItem(state.selectedItemId);
      else if ((key === "k" || key === "p" || key === "m")) {
        const tag: AlbumAssetTag = key === "k" ? "cover" : key === "p" ? "panorama" : "main";
        const ids = state.libSelection.length ? state.libSelection : state.selectedItemId ? [findItem(historyRef.current.present, state.selectedItemId)?.item.assetId ?? ""].filter(Boolean) : [];
        if (ids.length) tagMany(ids, tag);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, commit, dialog, doRedo, doUndo, goTo, importSource, notify, openViewer, placeAssets, presenting, tagMany, templates, toggleDock, viewItem, viewer]);

  // ------------------------------------------------------------------ dock ridimensionabile
  const startDockResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const dock = event.currentTarget.nextElementSibling as HTMLElement | null;
    const start = dockCollapsed ? 180 : dock?.offsetHeight ?? 260;
    const move = (e: PointerEvent) => {
      setDockCollapsed(false);
      setDockHeight(Math.round(Math.min(window.innerHeight * 0.6, Math.max(120, start + (startY - e.clientY)))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDockHeight((value) => { if (value !== null) writeNumber("filex.albumFlow.dockHeight", value); return value; });
      writeNumber("filex.albumFlow.dockCollapsed", 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const runAutoBuild = (options: AutoBuildOptions, useTemplates = false) => {
    setDialog(null);
    try {
      const plain = autoBuildAlbum(project, options);
      if (plain === project) { notify("Tutte le foto sono già nell'album."); return; }
      const firstNew = options.scope === "unused" ? project.spreads.length : 0;
      // I template dell'utente si usano dove il numero di foto coincide e il ritaglio è paragonabile; gli spread finiti restano come sono.
      const fresh = new Set(plain.spreads.filter((candidate) => !project.spreads.some((old) => old.id === candidate.id)).map((candidate) => candidate.id));
      const withTemplates = useTemplates ? applyTemplatesToAlbum(plain, templates, 0.12, fresh) : { project: plain, applied: 0 };
      const built = withTemplates.project;
      commit(() => built);
      setSpreadIndex(firstNew); setSelectedItemId(null); setActiveArea(0);
      notify(`${built.spreads.length - (options.scope === "unused" ? project.spreads.length : 0)} spread pronti${withTemplates.applied ? `, ${withTemplates.applied} con i tuoi template` : ""}. Ognuno resta modificabile.`, true);
    } catch (error) { notify(error instanceof Error ? error.message : "Auto Build non riuscito."); }
  };

  const manage = {
    create: (title: string, color?: string) => commit((p) => createChapter(p, title, color)),
    rename: (id: string, title: string) => commit((p) => renameChapter(p, id, title)),
    recolor: (id: string, color: string) => commit((p) => recolorChapter(p, id, color)),
    move: (id: string, direction: -1 | 1) => commit((p) => moveChapter(p, id, direction)),
    remove: (id: string) => commit((p) => removeChapter(p, id)),
    preset: (preset: ChapterPreset) => commit((p) => applyChapterPreset(p, preset)),
  };

  const { missingIds } = useMissingPhotos(project.assets);
  const newDrive = useNewFeature("drive");
  const rename = (name: string) => commit((p) => ({ ...p, projectName: name, updatedAt: nowIso() }));
  const setStage = (stage: AlbumStage) => commit((p) => (p.stage === stage ? p : touch({ ...p, stage })));
  const hasPhotos = project.assets.length > 0;
  const subtitle = `${project.settings.sheet.widthCm.toLocaleString("it-IT")} × ${project.settings.sheet.heightCm.toLocaleString("it-IT")} cm · ${count} spread · ${project.assets.length} foto`;

  // Gestori con identità stabile: la libreria (centinaia di miniature) non si ridisegna quando cambia solo lo spread mostrato.
  const libraryHandlers = useStableCallbacks({
    onSelection: setLibSelection,
    onTab: setLibTab,
    onThumbSize: (size: number) => { setThumbSize(size); writeNumber("filex.albumFlow.thumbSize", size); },
    onToggleCollapse: toggleDock,
    onSetRatingPolicy: (policy: "selector" | "project") => { commit((p) => setRatingPolicy(p, policy)); notify(policy === "project" ? "Le stelle ora sono solo di questo album: i file XMP non vengono modificati." : "Stelle riallineate a quelle di Image Select Pro.", true); },
    onClearRatings: () => { commit((p) => clearRatings(p)); notify("Stelle azzerate in questo album.", true); },
    onFocusZone: () => setZone("library"),
    onPlace: placeAssets,
    onOpenViewer: openViewer,
    onRate: rate,
    onRateMany: rateMany,
    onAssign: assign,
    onImportFolder: () => void importFolder(),
    onImportFiles: () => fileInput.current?.click(),
    onReveal: (id: string) => void reveal(id),
    onEdit: (id: string) => void edit(id),
    onCopyName: (ids: string[]) => void copyName(ids),
    onRemove: (ids: string[]) => { commit((p) => removeAssets(p, ids)); setLibSelection([]); notify(`${ids.length === 1 ? "Foto rimossa" : `${ids.length} foto rimosse`} dall'album (i file restano sul disco).`, true); },
    onLocalize: localize,
    onSetSort: (key: AlbumSortKey) => commit((p) => setSortKey(p, key)),
    onReorder: (visibleIds: string[], moving: string[], before: string | null) => { commit((p) => reorderAssets(p, visibleIds, moving, before)); notify("Ordine manuale attivato."); },
    onTag: tagMany,
    onManageChapters: () => setDialog("chapters"),
    onRemoveItem: (itemId: string) => actions.removeItem(itemId),
  });

  return (
    <div className="ws" data-testid="workspace" style={{ ["--dock-h" as string]: dockCollapsed ? "46px" : dockHeight !== null ? `${dockHeight}px` : "clamp(176px, 26vh, 300px)" }}>
      <header className="topbar">
        <button type="button" className="btn btn--ghost" onClick={onExit} aria-label="Torna ai progetti"><Icon name="chevronLeft" size={16} /> Album</button>
        <div className="topbar__title-wrap">
          <input
            className="topbar__title"
            defaultValue={project.projectName}
            key={project.projectName}
            aria-label="Nome dell'album"
            onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== project.projectName) rename(value); else event.target.value = project.projectName; }}
            onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
          />
          <button type="button" className="topbar__meta topbar__meta--btn" onClick={() => setDialog("format")} title="Cambia il formato dell'album">{subtitle}</button>
        </div>
        <div className="btn-group">
          <IconButton icon="undo" label="Annulla (Ctrl/⌘+Z)" onClick={doUndo} disabled={!canUndo(history)} />
          <IconButton icon="redo" label="Ripeti (Ctrl/⌘+Maiusc+Z)" onClick={doRedo} disabled={!canRedo(history)} />
        </div>
        <span className="spacer" />
        <label className="stage-select" title="Fase del progetto: la decidi tu">
          <span className={`stage-dot stage-dot--${project.stage}`} />
          <select value={project.stage} onChange={(event) => setStage(event.target.value as AlbumStage)} aria-label="Fase del progetto">
            {STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>
        </label>
        {missingIds.size > 0 ? <button type="button" className="btn btn--warn" onClick={() => setDialog("relink")} title="Alcune foto non si trovano più sul disco: indica dove sono adesso">{missingIds.size} {missingIds.size === 1 ? "foto non trovata" : "foto non trovate"} · Ricollega</button> : null}
        {driveAvailable() ? <button type="button" className="btn" onClick={() => { newDrive.markSeen(); setDialog("cloud"); }} title="Backup del progetto su Google Drive (le foto non vengono caricate)"><Icon name="archive" size={16} /> Drive{newDrive.isNew ? <span className="new-pill">Nuovo</span> : null}</button> : null}
        <button type="button" className="btn" onClick={() => setDialog("autobuild")} disabled={!hasPhotos} title="Auto Build (Ctrl/⌘+B)"><Icon name="wand" size={16} /> Auto Build</button>
        <IconButton icon="play" label="Anteprima per il cliente (F5)" onClick={() => setPresenting(true)} disabled={count === 0} size={20} className="icon-btn--round" />
        <button type="button" className="btn btn--primary" onClick={() => setDialog("export")} disabled={count === 0} title="Esporta (Ctrl/⌘+E)"><Icon name="export" size={16} /> Esporta</button>
        <button type="button" className="btn btn--ghost" onClick={() => setDialog("shortcuts")} title="Guida con esempi e scorciatoie (?)"><Icon name="keyboard" size={16} /> Guida</button>
      </header>

      {spread ? (
        <Stage
          project={project}
          spread={spread}
          spreadIndex={index}
          assets={assets}
          activeArea={areaIndex}
          selectedItemId={selectedItemId}
          highlightItemId={highlightItemId}
          cropMode={cropMode}
          draft={draft}
          zoom={zoom}
          guides={guides}
          sizes={sizes}
          layoutsOpen={layoutsOpen}
          templates={templates}
          actions={actions}
          design={{ open: designOpen, tab: designTab, focusSignal, selectedOverlayId, extraOverlayIds, actions: designActions, handlers: designHandlers, onToggle: () => { setDesignOpen((on) => { if (on) setSelectedOverlayId(null); return !on; }); }, onTab: setDesignTab }}
        />
      ) : (
        <main className="stage stage--empty" aria-label="Area di lavoro">
          <div className="empty-card">
            <Icon name="book" size={34} />
            <h2>{hasPhotos ? "Pronto per impaginare" : "Cominciamo dalle foto"}</h2>
            <p className="muted">{hasPhotos
              ? `Hai ${project.assets.length} foto${project.chapters.length ? ` in ${project.chapters.length} capitoli` : ""}. Lascia fare all'impaginazione automatica, oppure parti da uno spread vuoto e trascina le foto dalla libreria.`
              : "Importa le foto: una cartella intera, singoli file, oppure trascinale su questa finestra. Puoi caricarne più di quante ne servono, poi scegli."}</p>
            <div className="btn-row btn-row--center">
              {hasPhotos ? <button type="button" className="btn btn--primary" onClick={() => setDialog("autobuild")}><Icon name="wand" size={16} /> Auto Build</button>
                : <button type="button" className="btn btn--primary" onClick={() => (desktop ? void importFolder() : fileInput.current?.click())}><Icon name="import" size={16} /> Importa foto</button>}
              <button type="button" className="btn" onClick={() => { commit((p) => addSpread(p)); setSpreadIndex(0); }}>Impagina a mano</button>
            </div>
          </div>
        </main>
      )}

      <div className="ws__film">
        <Filmstrip
          project={project}
          assets={assets}
          current={index}
          onSelect={goTo}
          onAdd={() => { commit((p) => addSpread(p)); setSpreadIndex(count); setSelectedItemId(null); setActiveArea(0); }}
          onDuplicate={(i) => { commit((p) => duplicateSpread(p, p.spreads[i].id)); setSpreadIndex(i + 1); }}
          onRemove={(i) => { commit((p) => removeSpread(p, p.spreads[i].id)); notify(`Spread ${i + 1} eliminato.`, true); }}
          onDropOn={(at, payload) => { const before = historyRef.current.present; commit((p) => moveToSpread(p, p.spreads[at].id, payload)); if (historyRef.current.present === before) return; setSpreadIndex(at); setSelectedItemId(null); setActiveArea(0); notify(`Foto aggiunta allo spread ${at + 1}.${payload.kind === "assets" ? usedNote(payload.assetIds, at) : ""}`, true); }}
          onDropNew={(at, payload) => { let created = false; commit((p) => { const made = moveToNewSpread(p, at, payload); created = made.spreadId !== null; return made.project; }); if (!created) return; setSpreadIndex(at); setSelectedItemId(null); setActiveArea(0); notify(`Nuovo spread ${at + 1} con la foto.${payload.kind === "assets" ? usedNote(payload.assetIds, at) : ""}`, true); }}
          onMove={(from, to) => { commit((p) => moveSpread(p, from, to)); setSpreadIndex(to); }}
        />
      </div>

      <div className="ws__resizer" role="separator" aria-orientation="horizontal" aria-label="Ridimensiona la libreria" onPointerDown={startDockResize} onDoubleClick={toggleDock} title="Trascina per ridimensionare, doppio clic per nascondere o mostrare la libreria (Ctrl/⌘+J)" />

      <LibraryDock
        project={project}
        usage={usage}
        selection={libSelection}
        tab={libTab}
        thumbSize={thumbSize}
        collapsed={dockCollapsed}
        revealAsset={revealAsset}
        {...libraryHandlers}
      />

      <input ref={fileInput} type="file" accept="image/*,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2,.dng,.heic,.tif,.tiff" multiple hidden data-testid="import-input" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; importFromFiles(files); }} />

      {dropOverlay ? <div className="drop-overlay" aria-hidden="true"><Icon name="import" size={44} /><strong>Rilascia per importare</strong><span>Foto o cartelle intere: potrai scegliere il capitolo</span></div> : null}
      {toast ? <div className={`toast${viewer ? " toast--high" : ""}`} role="status">{toast.message}{toast.undo ? <button type="button" className="toast__action" onClick={() => { doUndo(); setToast(null); }}>Annulla</button> : null}</div> : null}

      {dialog === "autobuild" ? <AutoBuildDialog project={project} templateCount={templates.length} onClose={() => setDialog(null)} onRun={runAutoBuild} /> : null}
      {dialog === "export" ? <ExportDialog project={project} currentIndex={index} onClose={() => setDialog(null)} onStatus={notify} onGoTo={goTo} /> : null}
      {dialog === "format" ? <FormatDialog sheet={project.settings.sheet} onClose={() => setDialog(null)} onApply={(sheet) => { commit((p) => touch({ ...p, settings: { ...p.settings, sheet } })); setDialog(null); notify("Formato cambiato: i layout si sono adattati al nuovo foglio.", true); }} /> : null}
      {dialog === "template" && templateEdit ? <TemplateEditor sheet={project.settings.sheet} style={project.settings.defaultStyle} initial={templateEdit.initial} seed={templateEdit.seed} onClose={() => { setDialog(null); setTemplateEdit(null); }} onSave={(template) => { try { storeTemplates(upsertTemplate(templates, template)); notify(`Template «${template.name}» salvato.`); setDialog(null); setTemplateEdit(null); } catch (error) { notify(error instanceof Error ? error.message : "Template non salvato."); } }} /> : null}
      {dialog === "cloud" ? <CloudDialog project={project} onClose={() => setDialog(null)} onOpenCopy={(copy) => { setDialog(null); onOpenCopy?.(copy); }} /> : null}
      {dialog === "relink" ? <RelinkDialog project={project} missingIds={missingIds} onClose={() => setDialog(null)} onApply={(result) => { commit((p) => applyRelink(p, result)); notify(`${result.found.size} ${result.found.size === 1 ? "foto ricollegata" : "foto ricollegate"}.`, true); }} /> : null}
      {dialog === "shortcuts" ? <ShortcutsDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "chapters" ? (
        <ChapterManager project={project} onClose={() => setDialog(null)} onCreate={manage.create} onRename={manage.rename} onRecolor={manage.recolor} onMove={manage.move} onRemove={manage.remove} onApplyPreset={manage.preset} onError={notify} />
      ) : null}
      {importSource ? <ImportDialog project={project} source={importSource} defaultChapterId={libTab !== "all" && libTab !== "none" ? libTab : null} onClose={() => setImportSource(null)} onConfirm={confirmImport} /> : null}
      {viewer ? (
        <PhotoViewer
          project={project}
          ids={viewer.ids}
          startIndex={viewer.index}
          usage={usage}
          onClose={() => setViewer(null)}
          onRate={rate}
          onPlace={(id) => placeAssets([id])}
          onReveal={(id) => void reveal(id)}
          onEdit={(id) => void edit(id)}
          onAssign={(id, chapterId) => assign([id], chapterId)}
          onTag={(id, tag) => tagMany([id], tag)}
        />
      ) : null}
      {presenting ? <ClientPreview project={project} assets={assets} startIndex={index} onClose={() => setPresenting(false)} /> : null}
    </div>
  );
}

