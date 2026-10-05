import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AlbumAssetV2, AlbumProjectV2, AlbumSpread, AlbumSplitMode, AreaAlign, AreaStyle, AreaTemplate } from "@photo-tools/shared-types";
import type { DropTarget } from "../engine/drop";
import { spreadSizeMm } from "../engine/geometry";
import { hasDesktop } from "../desktop/api";
import { isFavoriteLayout } from "../model/areas";
import { BACKGROUND_SWATCHES } from "../model/defaults";
import { placeItem, type ItemView } from "../model/placement";
import { itemAspect } from "../model/project";
import { SHAPE_PRESETS, presetForShape } from "../model/shapes";
import { areaGeometryFor, hasFreeLayout } from "../model/project";
import { AreaStrip } from "./AreaStrip";
import { DesignPanel, type DesignActions, type DesignTab } from "./DesignPanel";
import type { DesignHandlers } from "./DesignLayers";
import { Icon } from "./icons";
import { useNewFeature } from "../hooks/useNewFeature";
import { LayoutBrowser } from "./LayoutBrowser";
import { SpreadView, type Draft } from "./SpreadView";
import { ColorDots, ContextMenu, IconButton, Popover, Stars, type MenuItem } from "./ui";

export interface StageActions {
  activateArea: (areaIndex: number) => void;
  selectItem: (itemId: string | null, areaIndex: number) => void;
  toggleCrop: (itemId: string) => void;
  dropAssets: (target: DropTarget, assetIds: string[]) => void;
  dropItem: (target: DropTarget, itemId: string) => void;
  setDraft: (draft: Draft | null) => void;
  commitRatio: (areaIndex: number, path: string, ratio: number) => void;
  resetRatio: (areaIndex: number, path: string) => void;
  commitView: (itemId: string, view: Partial<ItemView>) => void;
  style: (areaIndex: number, changes: Partial<AreaStyle>, coalesceKey?: string, relayout?: boolean) => void;
  align: (areaIndex: number, align: AreaAlign) => void;
  split: (mode: AlbumSplitMode) => void;
  link: () => void;
  swapAreas: () => void;
  shuffleArea: (areaIndex: number) => void;
  shuffleSpread: () => void;
  toggleFavorite: (areaIndex: number) => void;
  openLayouts: (open: boolean) => void;
  applyLayout: (areaIndex: number, candidateIndex: number) => void;
  applyFavorite: (areaIndex: number, favoriteId: string) => void;
  removeFavorite: (favoriteId: string) => void;
  applyStyle: (areaIndex: number, scope: "spread" | "album") => void;
  deleteSpread: () => void;
  duplicateSpread: () => void;
  clearSpread: () => void;
  mirror: (areaIndex: number) => void;
  editItem: (itemId: string) => void;
  removeItem: (itemId: string) => void;
  lockItem: (itemId: string) => void;
  viewItem: (itemId: string) => void;
  revealItem: (itemId: string) => void;
  copyItemName: (itemId: string) => void;
  locateInLibrary: (itemId: string) => void;
  resetItemView: (itemId: string) => void;
  replaceWithSelection: (itemId: string) => void;
  rate: (assetId: string, rating: number) => void;
  goTo: (index: number) => void;
  setZoom: (zoom: number) => void;
  toggleGuides: () => void;
  toggleSizes: () => void;
  addSpreadAfter: () => void;
  alignPhotos: (scope: "spread" | "album") => void;
  newTemplate: (areaIndex: number) => void;
  editTemplate: (templateId: string, asCopy?: boolean) => void;
  deleteTemplate: (templateId: string) => void;
  saveAsTemplate: (areaIndex: number) => void;
  commitFrame: (itemId: string, frame: { x: number; y: number; w: number; h: number }) => void;
  orderFrame: (itemId: string, where: "front" | "back") => void;
  rotateFrame: (itemId: string, deltaDeg: number) => void;
  fillSpread: () => void;
  toggleDone: () => void;
}

export interface StageProps {
  project: AlbumProjectV2;
  spread: AlbumSpread;
  spreadIndex: number;
  assets: ReadonlyMap<string, AlbumAssetV2>;
  activeArea: number;
  selectedItemId: string | null;
  highlightItemId: string | null;
  cropMode: boolean;
  draft: Draft | null;
  zoom: number;
  guides: boolean;
  sizes: boolean;
  layoutsOpen: boolean;
  templates: readonly AreaTemplate[];
  actions: StageActions;
  design: {
    open: boolean;
    tab: DesignTab;
    focusSignal: number;
    selectedOverlayId: string | null;
    extraOverlayIds: readonly string[];
    actions: DesignActions;
    handlers: DesignHandlers;
    onToggle: () => void;
    onTab: (tab: DesignTab) => void;
  };
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function formatTime(ms: number | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
}

/** Zona di lavoro: spread grande al centro, una striscia di controlli per ogni pagina, barra inferiore con sfondo, navigazione e vista. */
export function Stage({ project, spread, spreadIndex, assets, activeArea, selectedItemId, highlightItemId, cropMode, draft, zoom, guides, sizes, layoutsOpen, templates, actions, design }: StageProps) {
  const [centerRef, centerSize] = useElementSize<HTMLDivElement>();
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const desktop = hasDesktop();
  const [photoMenu, setPhotoMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);

  const sheet = project.settings.sheet;
  const size = spreadSizeMm(sheet);
  const ratio = size.width / size.height;
  const fit = Math.max(0, Math.min(centerSize.width - 24, (centerSize.height - 20) * ratio));
  const width = fit * zoom;
  const area = spread.areas[Math.min(activeArea, spread.areas.length - 1)];
  const areaIndex = Math.min(activeArea, spread.areas.length - 1);
  const favorite = isFavoriteLayout(project, area);
  const count = project.spreads.length;
  const two = spread.areas.length > 1;

  // Chiude i pannelli quando si cambia spread.
  useEffect(() => { setInfoFor(null); setApplyOpen(false); setSettingsOpen(false); setPhotoMenu(null); }, [spread.id]);

  const newShape = useNewFeature("forma-foto");
  const toolbar = useCallback((itemId: string): ReactNode => {
    const found = spread.areas.flatMap((candidate, index) => candidate.items.map((item) => ({ item, area: candidate, index }))).find((entry) => entry.item.id === itemId);
    if (!found) return null;
    const asset = assets.get(found.item.assetId);
    const geometry = areaGeometryFor(sheet, spread, found.index);
    const cell = geometry.cells.find((candidate) => candidate.itemId === itemId);
    const placement = cell ? placeItem(cell.rect, found.item, asset, found.area.style, null, cell.anchor) : null;
    const canCrop = !found.item.locked;
    const captured = formatTime(asset?.captureTimeMs);
    return (
      <>
        <IconButton icon="crop" label={canCrop ? "Ritaglia e sposta nello slot (Invio)" : found.item.locked ? "Foto bloccata" : "Per ritagliare passa a «Riempi lo spazio»"} active={cropMode} disabled={!canCrop} onClick={() => actions.toggleCrop(itemId)} size={16} />
        {canCrop ? (
          <label className="straighten" title="Forma della foto: la foto prende questa proporzione dentro la sua cella (ritaglio)">
            <span>Forma{newShape.isNew ? <span className="new-pill">Nuovo</span> : null}</span>
            <select aria-label="Forma della foto" onFocus={newShape.markSeen} value={found.item.shape ? (presetForShape(found.item.shape)?.id ?? (Math.abs(found.item.shape / itemAspect(asset) - 1) < 0.01 ? "original" : "custom")) : "cell"} onChange={(event) => {
              const value = event.target.value;
              if (value === "cell") actions.commitView(itemId, { shape: null });
              else if (value === "original") actions.commitView(itemId, { shape: Number(itemAspect(asset).toFixed(4)) });
              else { const preset = SHAPE_PRESETS.find((candidate) => candidate.id === value); if (preset) actions.commitView(itemId, { shape: preset.ratio }); }
            }}>
              <option value="cell">Come la cella</option>
              <option value="original">Originale della foto</option>
              {SHAPE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              {found.item.shape && !presetForShape(found.item.shape) && Math.abs(found.item.shape / itemAspect(asset) - 1) >= 0.01 ? <option value="custom">Personalizzata</option> : null}
            </select>
          </label>
        ) : null}
        {cropMode && canCrop ? (
          <label className="straighten" title="Raddrizza la foto: Alt + rotella (con Maiusc a passi più fini), oppure , e . da tastiera">
            <span>Raddrizza</span>
            <input type="range" min={-45} max={45} step={0.1} value={found.item.angle ?? 0} aria-label="Raddrizza la foto" onChange={(event) => actions.commitView(itemId, { angle: Number(event.target.value) })} onDoubleClick={() => actions.commitView(itemId, { angle: 0 })} />
            <output>{(found.item.angle ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°</output>
            <button type="button" className="icon-btn" title="Azzera il raddrizzamento" aria-label="Azzera il raddrizzamento" disabled={!found.item.angle} onClick={() => actions.commitView(itemId, { angle: 0 })}>0°</button>
          </label>
        ) : null}
        {hasFreeLayout(found.area) ? (
          <>
            <button type="button" className="icon-btn" title="Ruota a sinistra di 5°" aria-label="Ruota a sinistra" onClick={() => actions.rotateFrame(itemId, -5)}>↺</button>
            <button type="button" className="icon-btn" title="Ruota a destra di 5°" aria-label="Ruota a destra" onClick={() => actions.rotateFrame(itemId, 5)}>↻</button>
            <IconButton icon="chevronUp" label="Porta davanti alle altre" onClick={() => actions.orderFrame(itemId, "front")} size={16} />
            <IconButton icon="chevronDown" label="Porta dietro le altre" onClick={() => actions.orderFrame(itemId, "back")} size={16} />
          </>
        ) : null}
        <IconButton icon="eye" label="Guarda in grande (Spazio)" onClick={() => actions.viewItem(itemId)} size={16} />
        {desktop && asset?.absolutePath ? <IconButton icon="pencil" label="Modifica nell'editor" onClick={() => actions.editItem(itemId)} size={16} /> : null}
        <div className="anchor">
          <IconButton icon="info" label="Informazioni sulla foto" active={infoFor === itemId} onClick={() => setInfoFor(infoFor === itemId ? null : itemId)} size={16} />
          <Popover open={infoFor === itemId} onClose={() => setInfoFor(null)} side="top" className="popover--info">
            <dl className="info">
              <div><dt>File</dt><dd>{asset?.fileName ?? "—"}</dd></div>
              <div><dt>Misure</dt><dd>{asset ? `${asset.width} × ${asset.height} px` : "—"}</dd></div>
              <div><dt>Risoluzione</dt><dd>{placement && Number.isFinite(placement.dpi) ? `${Math.round(placement.dpi)} dpi effettivi${placement.dpi < 150 ? " (bassa)" : ""}` : "—"}</dd></div>
              {captured ? <div><dt>Scatto</dt><dd>{captured}</dd></div> : null}
              {asset?.absolutePath ? <div><dt>Percorso</dt><dd className="info__path">{asset.absolutePath}</dd></div> : null}
              <div><dt>Stelle</dt><dd>{asset ? <Stars value={asset.rating} size={14} onChange={(rating) => actions.rate(asset.id, rating)} /> : "—"}</dd></div>
            </dl>
          </Popover>
        </div>
        <IconButton icon={found.item.locked ? "lock" : "unlock"} label={found.item.locked ? "Sblocca la foto (L)" : "Blocca la foto (L)"} active={found.item.locked} onClick={() => actions.lockItem(itemId)} size={16} />
        <IconButton icon="trash" label="Togli dallo spread (Canc)" danger onClick={() => actions.removeItem(itemId)} size={16} />
      </>
    );
  }, [actions, assets, cropMode, desktop, infoFor, newShape.isNew, newShape.markSeen, sheet, spread]);

  /** Voci del tasto destro su una foto dello spread. */
  const photoMenuItems = (itemId: string): MenuItem[] => {
    const found = spread.areas.flatMap((candidate, index) => candidate.items.map((item) => ({ item, area: candidate, index }))).find((entry) => entry.item.id === itemId);
    if (!found) return [];
    const asset = assets.get(found.item.assetId);
    const hasFile = desktop && Boolean(asset?.absolutePath);
    const canCrop = !found.item.locked;
    const free = hasFreeLayout(found.area);
    return [
      { label: "Guarda in grande", icon: "eye", hint: "Spazio", onClick: () => actions.viewItem(itemId) },
      { label: "Trova nella libreria", icon: "search", onClick: () => actions.locateInLibrary(itemId) },
      { separator: true, label: "-" },
      { label: cropMode && selectedItemId === itemId ? "Chiudi il ritaglio" : "Ritaglia e sposta nello slot", icon: "crop", hint: "Invio", disabled: !canCrop, onClick: () => actions.toggleCrop(itemId) },
      { label: "Ripristina ritaglio, zoom e forma", icon: "undo", hint: "0", disabled: found.item.locked, onClick: () => actions.resetItemView(itemId) },
      { label: "Sostituisci con la foto scelta in libreria", icon: "image", disabled: found.item.locked, onClick: () => actions.replaceWithSelection(itemId) },
      ...(free ? [
        { label: "Porta davanti alle altre", icon: "chevronUp" as const, onClick: () => actions.orderFrame(itemId, "front") },
        { label: "Porta dietro le altre", icon: "chevronDown" as const, onClick: () => actions.orderFrame(itemId, "back") },
      ] : []),
      { separator: true, label: "-" },
      { label: "Modifica nell'editor", icon: "pencil", disabled: !hasFile, onClick: () => actions.editItem(itemId) },
      { label: "Apri la cartella del file", icon: "folder", disabled: !hasFile, onClick: () => actions.revealItem(itemId) },
      { label: "Copia il nome del file", icon: "copy", onClick: () => actions.copyItemName(itemId) },
      { label: "Valuta", icon: "star", disabled: !asset, children: [0, 1, 2, 3, 4, 5].map((rating) => ({ label: rating === 0 ? "Nessuna stella" : "★".repeat(rating), onClick: () => asset && actions.rate(asset.id, rating) })) },
      { separator: true, label: "-" },
      { label: found.item.locked ? "Sblocca la foto" : "Blocca la foto", icon: found.item.locked ? "unlock" : "lock", hint: "L", onClick: () => actions.lockItem(itemId) },
      { label: "Togli dallo spread", icon: "trash", danger: true, hint: "Canc", onClick: () => actions.removeItem(itemId) },
    ];
  };

  const spreadActions = (
    <div className="stage__tools" role="toolbar" aria-label="Azioni sullo spread">
      <button type="button" className="bar-btn" title="Riempi le pagine vuote con le prossime foto non usate (F)" aria-label="Riempi lo spread con le prossime foto" onClick={actions.fillSpread} disabled={!spread.areas.some((candidate) => candidate.items.length === 0)}><Icon name="wand" size={18} /></button>
      <button type="button" className="bar-btn bar-btn--gold" title="Cambia disposizione a tutto lo spread" aria-label="Cambia disposizione a tutto lo spread" onClick={actions.shuffleSpread} disabled={spread.areas.every((candidate) => candidate.items.length === 0)}><Icon name="shuffle" size={18} /></button>
      <button type="button" className={`bar-btn${layoutsOpen ? " is-active" : ""}`} title="Tutti i layout possibili per questa pagina (B)" aria-label="Mostra tutti i layout" aria-pressed={layoutsOpen} onClick={() => actions.openLayouts(!layoutsOpen)}><Icon name="layouts" size={18} /></button>
      <button type="button" className={`bar-btn${favorite ? " is-active" : ""}`} title={favorite ? "Questo layout è nei preferiti" : "Salva questo layout nei preferiti"} aria-label="Salva il layout nei preferiti" aria-pressed={favorite} disabled={area.items.length === 0} onClick={() => actions.toggleFavorite(areaIndex)}><Icon name="heart" size={18} style={{ fill: favorite ? "currentColor" : "none" }} /></button>
      <div className="anchor">
        <button type="button" className={`bar-btn${applyOpen ? " is-active" : ""}`} title="Applica questo stile a più pagine" aria-label="Applica lo stile a più pagine" onClick={() => setApplyOpen(!applyOpen)}><Icon name="applyAll" size={18} /></button>
        <Popover open={applyOpen} onClose={() => setApplyOpen(false)} side="top" className="popover--wide">
          <p className="popover__title">Copia lo stile di questa pagina</p>
          <button type="button" className="popover__row" onClick={() => { actions.applyStyle(areaIndex, "spread"); setApplyOpen(false); }}>Sull'intero spread</button>
          <button type="button" className="popover__row" onClick={() => { actions.applyStyle(areaIndex, "album"); setApplyOpen(false); }}>Su tutto l'album ({count} spread)</button>
          <p className="popover__hint">Spazio, margine, bordo, sfondo, modo e allineamento.</p>
        </Popover>
      </div>
      <div className="anchor">
        <button type="button" className={`bar-btn${settingsOpen ? " is-active" : ""}`} title="Altre azioni sullo spread" aria-label="Altre azioni sullo spread" onClick={() => setSettingsOpen(!settingsOpen)}><Icon name="sliders" size={18} /></button>
        <Popover open={settingsOpen} onClose={() => setSettingsOpen(false)} side="top" className="popover--wide">
          <button type="button" className="popover__row" onClick={() => { actions.alignPhotos("spread"); setSettingsOpen(false); }}><Icon name="alignCenter" size={15} /> Allinea le foto di questo spread</button>
          <button type="button" className="popover__row" onClick={() => { actions.alignPhotos("album"); setSettingsOpen(false); }}><Icon name="alignCenter" size={15} /> Allinea le foto di tutto l'album</button>
          <button type="button" className="popover__row" onClick={() => { actions.toggleDone(); setSettingsOpen(false); }}><Icon name="check" size={15} /> {spread.done ? "Riapri lo spread" : "Segna come finito"} <kbd>D</kbd></button>
          <button type="button" className="popover__row" onClick={() => { actions.duplicateSpread(); setSettingsOpen(false); }}><Icon name="copy" size={15} /> Duplica lo spread <kbd>Ctrl/⌘ D</kbd></button>
          <button type="button" className="popover__row" disabled={area.items.length < 2} onClick={() => { actions.mirror(areaIndex); setSettingsOpen(false); }}><Icon name="mirror" size={15} /> Specchia il layout</button>
          <button type="button" className="popover__row" onClick={() => { actions.clearSpread(); setSettingsOpen(false); }}><Icon name="close" size={15} /> Svuota lo spread</button>
        </Popover>
      </div>
      <button type="button" className="bar-btn bar-btn--danger" title="Elimina lo spread" aria-label="Elimina lo spread" onClick={actions.deleteSpread}><Icon name="trash" size={18} /></button>
    </div>
  );

  const strip = (side: "left" | "right") => {
    const index = Math.min(side === "left" ? 0 : 1, spread.areas.length - 1);
    return (
      <AreaStrip
        side={side}
        area={spread.areas[index]}
        split={spread.split}
        linked={spread.linked}
        active={activeArea === index}
        twoAreas={two}
        onActivate={() => actions.activateArea(index)}
        onShuffle={() => actions.shuffleArea(index)}
        onStyle={(changes, key, relayout) => actions.style(index, changes, key, relayout)}
        onAlign={(align) => actions.align(index, align)}
        onSplit={actions.split}
        onLink={actions.link}
        onSwapAreas={actions.swapAreas}
      />
    );
  };

  const newDesign = useNewFeature("personalizza");
  const bg = useMemo(() => BACKGROUND_SWATCHES, []);
  const where = !two ? "foglio intero" : areaIndex === 0 ? "pagina sinistra" : "pagina destra";

  return (
    <main className="stage" aria-label="Area di lavoro">
      <div className="stage__row">
        {strip("left")}
        <div className="stage__center" ref={centerRef} data-testid="stage-center">
          <div className="stage__spread" style={{ width: width || undefined }}>
            <SpreadView
              sheet={sheet}
              spread={spread}
              assets={assets}
              variant="stage"
              showGuides={guides}
              showSizes={sizes}
              activeArea={areaIndex}
              selectedItemId={selectedItemId}
              highlightItemId={highlightItemId}
              cropMode={cropMode}
              draft={draft}
              onActivateArea={actions.activateArea}
              onSelectItem={actions.selectItem}
              onContextItem={(itemId, _area, x, y) => setPhotoMenu({ x, y, itemId })}
              onToggleCrop={actions.toggleCrop}
              onDropAssets={actions.dropAssets}
              onDropItem={actions.dropItem}
              onDraft={actions.setDraft}
              onCommitRatio={actions.commitRatio}
              onResetRatio={actions.resetRatio}
              onCommitView={actions.commitView}
              onCommitFrame={actions.commitFrame}
              renderToolbar={toolbar}
              design={design.handlers}
              photosLocked={design.open}
            />
          </div>
        </div>
        {strip("right")}
        {design.open ? (
          <DesignPanel
            spread={spread}
            two={two}
            areaIndex={areaIndex}
            tab={design.tab}
            onTab={design.onTab}
            selectedOverlayId={design.selectedOverlayId}
            extraOverlayIds={design.extraOverlayIds}
            focusSignal={design.focusSignal}
            actions={design.actions}
            onClose={design.onToggle}
          />
        ) : null}
        {layoutsOpen ? (
          <LayoutBrowser
            project={project}
            spread={spread}
            areaIndex={areaIndex}
            assets={assets}
            onApply={(candidate) => actions.applyLayout(areaIndex, candidate)}
            onApplyFavorite={(id) => actions.applyFavorite(areaIndex, id)}
            onRemoveFavorite={actions.removeFavorite}
            templates={templates}
            onNewTemplate={() => actions.newTemplate(areaIndex)}
            onEditTemplate={actions.editTemplate}
            onDeleteTemplate={actions.deleteTemplate}
            onSaveAsTemplate={() => actions.saveAsTemplate(areaIndex)}
            onClose={() => actions.openLayouts(false)}
          />
        ) : null}
      </div>

      <footer className="stage__bar">
        <div className="stage__bar-group" aria-label={`Sfondo della ${where}`}>
          <span className="stage__bar-label">Sfondo · {where}</span>
          <ColorDots value={area.style.background} swatches={bg} onChange={(color) => actions.style(areaIndex, { background: color })} label="Colore di sfondo" />
          <button type="button" className={`chip${area.style.mono ? " is-active" : ""}`} onClick={() => actions.style(areaIndex, { mono: !area.style.mono })} aria-pressed={area.style.mono} title="Mostra in bianco e nero le foto di questa pagina">B/N</button>
        </div>
        <div className="stage__bar-group stage__bar-group--center">
          <IconButton icon="chevronLeft" label="Spread precedente (←)" onClick={() => actions.goTo(spreadIndex - 1)} disabled={spreadIndex === 0} />
          <span className="stage__count">Spread <strong>{spreadIndex + 1}</strong> di {count}{spread.done ? <em className="stage__done" title="Finito: Auto Build e Mescola non lo toccano"> · finito</em> : null}</span>
          <IconButton icon="chevronRight" label="Spread successivo (→)" onClick={() => actions.goTo(spreadIndex + 1)} disabled={spreadIndex >= count - 1} />
          <button type="button" className="bar-btn" title="Aggiungi uno spread vuoto dopo questo" aria-label="Aggiungi uno spread dopo questo" onClick={actions.addSpreadAfter}><Icon name="plus" size={18} /></button>
          <span className="stage__sep" aria-hidden="true" />
          {spreadActions}
        </div>
        <div className="stage__bar-group stage__bar-group--end">
          <IconButton icon="minus" label="Riduci (−)" onClick={() => actions.setZoom(Math.max(0.4, Number((zoom - 0.15).toFixed(2))))} size={15} />
          <button type="button" className="btn btn--sm" onClick={() => actions.setZoom(1)} title="Adatta alla finestra (0)">{Math.round(zoom * 100)}%</button>
          <IconButton icon="plus" label="Ingrandisci (+)" onClick={() => actions.setZoom(Math.min(3, Number((zoom + 0.15).toFixed(2))))} size={15} />
          <button type="button" className={`chip${design.open ? " is-active" : ""}`} onClick={design.onToggle} aria-pressed={design.open} title="Sfondi a immagine, testi in stile rivista, frasi e grafiche" onClickCapture={newDesign.markSeen}>Personalizza{newDesign.isNew ? <span className="new-pill">Nuovo</span> : null}</button>
          <button type="button" className={`chip${sizes ? " is-active" : ""}`} onClick={actions.toggleSizes} aria-pressed={sizes} title="Mostra su ogni foto la misura stampata e la risoluzione (S)">Misure</button>
          <button type="button" className={`chip${guides ? " is-active" : ""}`} onClick={actions.toggleGuides} aria-pressed={guides} title="Mostra zona sicura e piega (G)">Guide</button>
        </div>
      </footer>
      {photoMenu ? <ContextMenu x={photoMenu.x} y={photoMenu.y} items={photoMenuItems(photoMenu.itemId)} onClose={() => setPhotoMenu(null)} /> : null}
    </main>
  );
}
