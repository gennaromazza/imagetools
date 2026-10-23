import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ImageAsset, PickStatus } from "@photo-tools/shared-types";
import {
  createOnDemandPreviewAsync,
  getCachedOnDemandPreviewUrl,
  warmOnDemandPreviewCache,
} from "../services/folder-access";
import {
  getAssetPickStatus,
  getAssetRating,
  PICK_STATUS_LABELS,
  resolvePhotoClassificationShortcut,
} from "../services/photo-classification";
import { getAssetRotation, type RotationDirection } from "../services/photo-rotation";
import type { CustomLabelShortcut, CustomLabelTone, ThumbnailProfile } from "../services/photo-selector-preferences";
import {
  CLIP_HIGH_WARN_PCT,
  CLIP_LOW_WARN_PCT,
  planCloseGroup,
  planDiscardSoft,
  type PhotoInsight,
} from "../services/similar-insights";
import {
  bestGridLayout,
  filterSimilarGroups,
  isGroupDecided,
  nextUndecidedGroupId,
  resolveActiveGroupId,
  SIMILAR_KIND_LABELS,
  type SimilarGroupView,
} from "../services/similar-photos";
import { getThumbnailView } from "../services/thumbnail-view-store";
import { useThumbnailView } from "../services/use-thumbnail-view";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";

type PhotoChanges = Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel" | "customLabels" | "rotationDegrees">>;

/** Lato lungo dell'anteprima nelle schede: nitida a schermo intero, molto più leggera dell'originale. */
const CELL_PREVIEW_DIMENSION = 1280;
/** Con la lente si carica più grande: serve vedere occhi e dettagli a ingrandimento alto. */
const LENS_PREVIEW_DIMENSION = 2800;
const LENS_SCALE_DEFAULT = 3;
const LENS_SCALE_MIN = 1.5;
const LENS_SCALE_MAX = 6;
/** Fino a tante varianti stanno tutte nello spazio libero; oltre, la zona foto scorre. */
const FIT_SCREEN_MAX = 6;
/** Sotto questa larghezza la foto è troppo piccola per giudicarla: si passa a schede più alte che scorrono. */
const MIN_FIT_PHOTO_WIDTH = 200;
/** Spazio sotto la foto di ogni scheda (nome, segnali, stelle, pulsanti, bordi) e distanza tra le schede, in px. */
const CELL_CHROME_PX = 150;
const CELL_GAP_PX = 12;
/** Mentre si lavora su un gruppo si preparano le anteprime dei prossimi da decidere. */
const PREFETCH_GROUPS = 2;
const PREFETCH_PHOTOS = 10;
const PREFETCH_DELAY_MS = 700;
const NOTICE_MS = 9_000;

interface SimilarPhotosWorkspaceProps {
  /** Nell'ordine della griglia. */
  groups: SimilarGroupView[];
  assetById: ReadonlyMap<string, ImageAsset>;
  initialGroupId: string | null;
  analyzedCount: number;
  totalCount: number;
  isAnalyzing: boolean;
  selectedCount: number;
  hasOverrides: boolean;
  editable: boolean;
  canUndo: boolean;
  /** Vero mentre il confronto è aperto sopra questa schermata: i tasti sono suoi. */
  keysSuspended: boolean;
  thumbnailProfile: ThumbnailProfile;
  customLabelsCatalog: string[];
  customLabelColors: Record<string, CustomLabelTone>;
  customLabelShortcuts: Record<string, CustomLabelShortcut | null>;
  autoAdvanceOnAction: boolean;
  onAutoAdvanceOnActionChange: (enabled: boolean) => void;
  onClose: () => void;
  onUndo: () => void;
  onUpdatePhoto: (photoId: string, changes: PhotoChanges) => void;
  onRotatePhoto: (photoId: string, direction: RotationDirection) => void;
  /** Le scelte diventano Pick e le altre varianti Scartate. Restituiscono il testo dell'esito, null se nulla è cambiato. */
  onKeep: (group: SimilarGroupView, keepIds: string[]) => string | null;
  /** Tiene i Pick già dati e scarta le varianti ancora neutre. */
  onCloseGroup: (group: SimilarGroupView) => string | null;
  /** Scarta solo le varianti nettamente più morbide, senza decidere il gruppo. */
  onDiscardSoft: (group: SimilarGroupView) => string | null;
  onCompare: (photoIds: string[]) => void;
  onSeparate: (group: SimilarGroupView) => void;
  onDetach: (group: SimilarGroupView, photoId: string) => void;
  onShowInGrid: (photoIds: string[], focusId: string) => void;
  onJoinSelection: () => void;
  onResetOverrides: () => void;
}

function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver !== "function") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
}

/** `mounted`: cambia quando l'elemento compare o sparisce dalla pagina, così la misura riparte. */
function useElementSize(ref: RefObject<HTMLElement | null>, mounted = true): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const sync = () => setSize((current) => (
      current.width === element.clientWidth && current.height === element.clientHeight
        ? current
        : { width: element.clientWidth, height: element.clientHeight }
    ));
    sync();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted, ref]);
  return size;
}

/** Anteprima grande della scheda, caricata solo quando la scheda è (quasi) in vista; resta quella vecchia finché la nuova non arriva. */
function useCellPreviewUrl(photo: ImageAsset, enabled: boolean, maxDimension: number): string | null {
  const [url, setUrl] = useState<string | null>(() => getCachedOnDemandPreviewUrl(photo.id, { maxDimension }));
  useEffect(() => {
    if (!enabled) return;
    const cached = getCachedOnDemandPreviewUrl(photo.id, { maxDimension });
    if (cached) {
      setUrl(cached);
      return;
    }
    const controller = new AbortController();
    createOnDemandPreviewAsync(photo.id, 1, { maxDimension, signal: controller.signal })
      .then((next) => {
        if (next && !controller.signal.aborted) setUrl(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, maxDimension, photo.id, photo.sourceFileKey]);
  return url;
}

function withThumbnailView(photo: ImageAsset): ImageAsset {
  const view = getThumbnailView(photo.id);
  return view ? { ...photo, ...view } : photo;
}

/** Proporzioni (larghezza / altezza) come appaiono: la rotazione di un quarto di giro le scambia. */
function displayedAspect(photo: Pick<ImageAsset, "width" | "height" | "aspectRatio" | "rotationDegrees">): number {
  const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : photo.aspectRatio > 0 ? photo.aspectRatio : 1;
  return Math.abs(Math.round(getAssetRotation(photo) / 90)) % 2 === 1 ? 1 / ratio : ratio;
}

const formatPercent = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1)).replace(".", ",");

interface SimilarCellProps {
  photo: ImageAsset;
  position: number;
  total: number;
  active: boolean;
  recommended: boolean;
  editable: boolean;
  canDetach: boolean;
  insight: PhotoInsight | undefined;
  previewDimension: number;
  onActivate: (photoId: string) => void;
  onEnlarge: (photoId: string) => void;
  onUpdate: (photoId: string, changes: PhotoChanges) => void;
  onKeep: (photoId: string) => void;
  onShowInGrid: (photoId: string) => void;
  onDetach: (photoId: string) => void;
}

function SimilarCell({
  photo,
  position,
  total,
  active,
  recommended,
  editable,
  canDetach,
  insight,
  previewDimension,
  onActivate,
  onEnlarge,
  onUpdate,
  onKeep,
  onShowInGrid,
  onDetach,
}: SimilarCellProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const near = useNearViewport(stageRef);
  const stageSize = useElementSize(stageRef);
  const view = useThumbnailView(photo.id);
  const largeUrl = useCellPreviewUrl(photo, near, previewDimension);
  const url = largeUrl ?? view?.thumbnailUrl ?? photo.thumbnailUrl ?? photo.previewUrl ?? null;
  const rotation = getAssetRotation(photo);
  const aspect = displayedAspect({ ...photo, width: view?.width ?? photo.width, height: view?.height ?? photo.height });
  // La «cornice» della foto ha le sue proporzioni: la lente la ingrandisce e il ritaglio resta dentro la scheda.
  const fit = stageSize.width > 0 && stageSize.height > 0 ? Math.min(stageSize.width, stageSize.height * aspect) : 0;
  const pictureStyle: CSSProperties = fit > 0 ? { width: fit, height: fit / aspect } : { width: "100%", height: "100%" };
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const imageStyle: CSSProperties | undefined = rotation === 0
    ? undefined
    : quarterTurn
      ? { inset: "auto", left: "50%", top: "50%", width: `${100 / aspect}%`, height: `${100 * aspect}%`, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }
      : { transform: `rotate(${rotation}deg)` };
  const pickStatus = getAssetPickStatus(photo);
  const rating = getAssetRating(photo);

  return (
    <li
      className={[
        "similar-workspace__cell",
        active ? "similar-workspace__cell--active" : "",
        recommended ? "similar-workspace__cell--recommended" : "",
        `similar-workspace__cell--${pickStatus}`,
      ].filter(Boolean).join(" ")}
      data-photo-id={photo.id}
      // Qualsiasi clic nella scheda la rende la foto attiva per i tasti (non cambia nulla della foto).
      onClick={() => onActivate(photo.id)}
    >
      <div
        ref={stageRef}
        className="similar-workspace__stage"
        onDoubleClick={() => onEnlarge(photo.id)}
        title="Un clic sceglie la foto da classificare (non cambia nulla) · doppio clic o Spazio: ingrandisci"
      >
        <div className="similar-workspace__picture" style={pictureStyle}>
          {url ? (
            <img src={url} alt={photo.fileName} draggable={false} decoding="async" style={imageStyle} />
          ) : (
            <span className="similar-workspace__placeholder" aria-hidden="true">…</span>
          )}
        </div>
        <span className="similar-workspace__badges">
          {recommended ? <span className="similar-workspace__tag">Consigliata</span> : null}
          {insight?.soft ? <span className="similar-workspace__tag similar-workspace__tag--soft" title="Nettamente meno nitida della migliore del gruppo: mossa o fuori fuoco">Più morbida</span> : null}
          <span className={`asset-pick-badge asset-pick-badge--${pickStatus}`}>{PICK_STATUS_LABELS[pickStatus]}</span>
        </span>
        <button
          type="button"
          className="similar-workspace__zoom"
          onClick={(event) => {
            event.stopPropagation();
            onEnlarge(photo.id);
          }}
          title="Ingrandisci (Spazio): anteprima a schermo intero con stelle e stato"
          aria-label={`Ingrandisci ${photo.fileName}`}
        >
          ⤢
        </button>
      </div>

      <div className="similar-workspace__meta">
        <span className="similar-workspace__name" title={photo.fileName}>{photo.fileName}</span>
        <span className="similar-workspace__position">{position}/{total}</span>
      </div>
      {insight && (insight.sharpnessPct !== null || (insight.clipHighPct ?? 0) >= CLIP_HIGH_WARN_PCT || (insight.clipLowPct ?? 0) >= CLIP_LOW_WARN_PCT) ? (
        <div className="similar-workspace__signals">
          {insight.sharpnessPct !== null ? (
            <span
              className={`similar-workspace__sharp${insight.soft ? " similar-workspace__sharp--soft" : ""}`}
              title="Nitidezza rispetto alla più nitida del gruppo: indicativa, da una miniatura a 200 px. Non dice nulla su occhi e espressioni."
            >
              <span className="similar-workspace__sharp-bar"><i style={{ width: `${insight.sharpnessPct}%` }} /></span>
              Nitidezza {insight.sharpnessPct}%
            </span>
          ) : null}
          {(insight.clipHighPct ?? 0) >= CLIP_HIGH_WARN_PCT ? (
            <span className="similar-workspace__clip" title="Quota dell'immagine con luci bruciate (senza dettaglio)">Luci {formatPercent(insight.clipHighPct!)}%</span>
          ) : null}
          {(insight.clipLowPct ?? 0) >= CLIP_LOW_WARN_PCT ? (
            <span className="similar-workspace__clip" title="Quota dell'immagine con ombre chiuse (senza dettaglio)">Ombre {formatPercent(insight.clipLowPct!)}%</span>
          ) : null}
        </div>
      ) : null}

      <div className="similar-workspace__rate" role="group" aria-label={`Valutazione e stato di ${photo.fileName}`}>
        <span className="similar-workspace__stars">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={`photo-card__star${value <= rating ? " photo-card__star--active" : ""}`}
              onClick={() => onUpdate(photo.id, { rating: value })}
              disabled={!editable}
              title={`${value} stella${value > 1 ? "e" : ""} | tasto ${value}`}
            >
              ★
            </button>
          ))}
        </span>
        <span className="similar-workspace__pills">
          {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`photo-card__pill${pickStatus === value ? " photo-card__pill--active" : ""}`}
              onClick={() => onUpdate(photo.id, { pickStatus: value })}
              disabled={!editable}
              title={value === "picked" ? "Pick, senza toccare le altre varianti | tasto P" : value === "rejected" ? "Scartata | tasto X" : "Neutra | tasto U"}
            >
              {PICK_STATUS_LABELS[value]}
            </button>
          ))}
        </span>
      </div>

      <div className="similar-workspace__cell-actions">
        <button
          type="button"
          className="ghost-button ghost-button--small similar-workspace__keep"
          onClick={() => onKeep(photo.id)}
          disabled={!editable}
          title="Solo questa: diventa Pick e le altre varianti Scartate, poi passi al gruppo successivo (Ctrl+Z per annullare)"
        >
          Tieni solo questa
        </button>
        <button
          type="button"
          className="ghost-button ghost-button--small"
          onClick={() => onShowInGrid(photo.id)}
          title="Chiude questa schermata e porta la foto nella griglia"
        >
          Nella griglia
        </button>
        {canDetach ? (
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={() => onDetach(photo.id)}
            title="Questa foto non è una variante delle altre (vale per questa sessione)"
          >
            Togli dal gruppo
          </button>
        ) : null}
      </div>
    </li>
  );
}

function SimilarGroupRow({
  group,
  index,
  active,
  decided,
  representative,
  onOpen,
}: {
  group: SimilarGroupView;
  index: number;
  active: boolean;
  decided: boolean;
  representative: ImageAsset | undefined;
  onOpen: (groupId: string) => void;
}) {
  const view = useThumbnailView(representative?.id);
  const url = view?.thumbnailUrl ?? representative?.thumbnailUrl ?? representative?.previewUrl ?? null;
  return (
    <li>
      <button
        type="button"
        className={`similar-workspace__row${active ? " similar-workspace__row--active" : ""}${decided ? " similar-workspace__row--decided" : ""}`}
        data-group-id={group.id}
        onClick={() => onOpen(group.id)}
        aria-current={active ? "true" : undefined}
      >
        <span className="similar-workspace__row-thumb">
          {url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} /> : null}
        </span>
        <span className="similar-workspace__row-text">
          <strong>{index + 1}. {SIMILAR_KIND_LABELS[group.kind]} · {group.photoIds.length} foto</strong>
          <span>
            {decided ? "✓ Tenuta" : "Da decidere"}
            {group.insights.verdict === "soft" ? " · con sfocate" : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Schermata «Simili»: raffiche e foto quasi uguali a schermo intero, gruppo per gruppo. Ogni variante è
 * grande, con stelle e stato a portata di clic; un clic sulla foto non cambia nulla (si sceglie «Tieni solo
 * questa» o il tasto P), Spazio ingrandisce, la lente confronta lo stesso dettaglio su tutte le varianti e
 * le frecce scorrono varianti e gruppi. Si può tenere più di una foto (P su ognuna, poi Invio chiude il
 * gruppo): nei matrimoni le raffiche sono spesso pose diverse, non copie.
 */
export function SimilarPhotosWorkspace({
  groups,
  assetById,
  initialGroupId,
  analyzedCount,
  totalCount,
  isAnalyzing,
  selectedCount,
  hasOverrides,
  editable,
  canUndo,
  keysSuspended,
  thumbnailProfile,
  customLabelsCatalog,
  customLabelColors,
  customLabelShortcuts,
  autoAdvanceOnAction,
  onAutoAdvanceOnActionChange,
  onClose,
  onUndo,
  onUpdatePhoto,
  onRotatePhoto,
  onKeep,
  onCloseGroup,
  onDiscardSoft,
  onCompare,
  onSeparate,
  onDetach,
  onShowInGrid,
  onJoinSelection,
  onResetOverrides,
}: SimilarPhotosWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pickStatusOf = useCallback((id: string) => assetById.get(id)?.pickStatus, [assetById]);
  const [onlyUndecided, setOnlyUndecided] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(
    () => initialGroupId ?? nextUndecidedGroupId(groups, null, pickStatusOf) ?? groups[0]?.id ?? null,
  );
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [lensOn, setLensOn] = useState(false);
  const [lensScale, setLensScale] = useState(LENS_SCALE_DEFAULT);
  const [notice, setNotice] = useState<{ token: number; text: string } | null>(null);
  const noticeTokenRef = useRef(0);
  const lastIndexRef = useRef(0);
  /** Ultimo gruppo deciso da qui, con lo stato delle sue foto subito dopo la decisione: se cambia, un Ctrl+Z l'ha toccato. */
  const trackedGroupRef = useRef<{ groupId: string; signature: string | null } | null>(null);

  const shownGroups = useMemo(
    () => filterSimilarGroups(groups, pickStatusOf, onlyUndecided, activeGroupId),
    [activeGroupId, groups, onlyUndecided, pickStatusOf],
  );
  const resolvedGroupId = resolveActiveGroupId(shownGroups, activeGroupId, lastIndexRef.current);
  const group = shownGroups.find((candidate) => candidate.id === resolvedGroupId) ?? null;
  const activeIndex = group ? shownGroups.indexOf(group) : -1;
  const undecidedCount = useMemo(
    () => groups.reduce((count, candidate) => count + (isGroupDecided(candidate.photoIds, pickStatusOf) ? 0 : 1), 0),
    [groups, pickStatusOf],
  );

  useEffect(() => {
    if (resolvedGroupId !== activeGroupId) setActiveGroupId(resolvedGroupId);
    if (activeIndex >= 0) lastIndexRef.current = activeIndex;
  });
  useEffect(() => {
    setActivePhotoId(null);
  }, [resolvedGroupId]);

  const photoIds = group?.photoIds ?? [];
  const currentPhotoId = activePhotoId && photoIds.includes(activePhotoId) ? activePhotoId : group?.recommendedId ?? null;
  const decided = group ? isGroupDecided(group.photoIds, pickStatusOf) : false;
  const mixedTone = group?.insights.verdict === "mixed-tone";
  const closePlan = group ? planCloseGroup(group.photoIds, pickStatusOf) : { keep: [], reject: [] };
  const softToDiscard = group ? planDiscardSoft(group.insights.softIds, pickStatusOf) : [];

  // Un Ctrl+Z (o «Annulla») che cambia l'ultimo gruppo deciso da qui riporta la schermata su quel gruppo,
  // così si vede cosa è stato annullato. Nessun altro modo cambia le sue foto mentre la schermata è aperta.
  useEffect(() => {
    const tracked = trackedGroupRef.current;
    if (!tracked) return;
    const target = groups.find((candidate) => candidate.id === tracked.groupId);
    if (!target) {
      trackedGroupRef.current = null;
      return;
    }
    const signature = target.photoIds.map((id) => pickStatusOf(id) ?? "unmarked").join(",");
    if (tracked.signature === null) {
      tracked.signature = signature;
    } else if (tracked.signature !== signature) {
      trackedGroupRef.current = null;
      setActiveGroupId(tracked.groupId);
    }
  }, [groups, pickStatusOf]);

  // Il fuoco resta sulla schermata (non su un pulsante): Spazio e Invio non rifanno l'ultimo clic.
  useEffect(() => {
    if (previewId === null) rootRef.current?.focus({ preventScroll: true });
  }, [previewId]);

  useEffect(() => {
    const row = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-group-id]") ?? [])
      .find((element) => element.dataset.groupId === resolvedGroupId);
    row?.scrollIntoView({ block: "nearest" });
  }, [resolvedGroupId]);
  useEffect(() => {
    const cell = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-photo-id]") ?? [])
      .find((element) => element.dataset.photoId === currentPhotoId);
    cell?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentPhotoId]);

  const showNotice = (text: string | null) => {
    if (!text) return;
    noticeTokenRef.current += 1;
    const token = noticeTokenRef.current;
    setNotice({ token, text });
    window.setTimeout(() => setNotice((current) => (current?.token === token ? null : current)), NOTICE_MS);
  };
  const moveGroup = (delta: number) => {
    const next = shownGroups[activeIndex + delta];
    if (next) setActiveGroupId(next.id);
  };
  const goToNextUndecided = () => {
    if (!group) return;
    const nextId = nextUndecidedGroupId(shownGroups, group.id, pickStatusOf);
    if (nextId) setActiveGroupId(nextId);
  };
  const movePhoto = (delta: number) => {
    if (!currentPhotoId) return;
    const next = photoIds[Math.min(photoIds.length - 1, Math.max(0, photoIds.indexOf(currentPhotoId) + delta))];
    if (next) setActivePhotoId(next);
  };
  const openLarge = (photoId: string) => {
    setActivePhotoId(photoId);
    setPreviewId(photoId);
  };
  // «Tieni»: Pick a queste e Scartate le altre, poi si passa al prossimo gruppo da decidere.
  const keepPhotos = (keepIds: string[]) => {
    if (!group || !editable) return;
    const nextId = nextUndecidedGroupId(shownGroups, group.id, pickStatusOf);
    trackedGroupRef.current = { groupId: group.id, signature: null };
    showNotice(onKeep(group, keepIds));
    if (nextId) setActiveGroupId(nextId);
  };
  // «Chiudi il gruppo»: restano i Pick già dati, le altre neutre vengono scartate.
  const closeGroup = () => {
    if (!group || !editable) return;
    const nextId = nextUndecidedGroupId(shownGroups, group.id, pickStatusOf);
    trackedGroupRef.current = { groupId: group.id, signature: null };
    showNotice(onCloseGroup(group));
    if (nextId) setActiveGroupId(nextId);
  };
  // Invio: su una foto già Pick chiude il gruppo (si tengono tutti i Pick); altrimenti tiene solo quella.
  const confirmCurrent = () => {
    if (!group || !currentPhotoId) return;
    if (closePlan.keep.includes(currentPhotoId)) closeGroup();
    else keepPhotos([currentPhotoId]);
  };
  const discardSoft = () => {
    if (!group || !editable) return;
    showNotice(onDiscardSoft(group));
  };
  const toggleLens = () => setLensOn((current) => !current);
  const undo = () => {
    onUndo();
    setNotice(null);
  };

  const liveRef = useRef({
    keysSuspended, previewId, editable, currentPhotoId, shownGroups, activeIndex, pickStatusOf,
    onClose, onUpdatePhoto, moveGroup, movePhoto, openLarge, confirmCurrent, toggleLens, goToNextUndecided,
  });
  liveRef.current = {
    keysSuspended, previewId, editable, currentPhotoId, shownGroups, activeIndex, pickStatusOf,
    onClose, onUpdatePhoto, moveGroup, movePhoto, openLarge, confirmCurrent, toggleLens, goToNextUndecided,
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const live = liveRef.current;
      // Anteprima e confronto aperti sopra questa schermata gestiscono i loro tasti.
      if (live.keysSuspended || live.previewId) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        live.onClose();
        return;
      }
      if (event.altKey) return;
      const onButton = target instanceof HTMLElement && target.closest("button, a") !== null;

      if (!event.ctrlKey && !event.metaKey) {
        switch (event.key) {
          case "ArrowLeft":
            event.preventDefault();
            live.movePhoto(-1);
            return;
          case "ArrowRight":
            event.preventDefault();
            live.movePhoto(1);
            return;
          case "ArrowUp":
          case "PageUp":
            event.preventDefault();
            live.moveGroup(-1);
            return;
          case "ArrowDown":
          case "PageDown":
            event.preventDefault();
            live.moveGroup(1);
            return;
          case " ":
            if (onButton) return;
            event.preventDefault();
            if (!event.repeat && live.currentPhotoId) live.openLarge(live.currentPhotoId);
            return;
          case "Enter":
            if (onButton) return;
            event.preventDefault();
            if (!event.repeat) live.confirmCurrent();
            return;
          case "l":
          case "L":
            event.preventDefault();
            if (!event.repeat) live.toggleLens();
            return;
          case "n":
          case "N":
            event.preventDefault();
            if (!event.repeat) live.goToNextUndecided();
            return;
          default:
            break;
        }
      }

      if (!live.editable || !live.currentPhotoId) return;
      const changes = resolvePhotoClassificationShortcut({
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
      if (changes) {
        event.preventDefault();
        if (!event.repeat) live.onUpdatePhoto(live.currentPhotoId, changes);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Prima che serva: mentre si lavora su un gruppo si preparano le anteprime dei prossimi da decidere.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { shownGroups: list, activeIndex: from, pickStatusOf: statusOf } = liveRef.current;
      const ids: string[] = [];
      let groupsTaken = 0;
      for (let index = from + 1; index < list.length && groupsTaken < PREFETCH_GROUPS && ids.length < PREFETCH_PHOTOS; index += 1) {
        const candidate = list[index]!;
        if (isGroupDecided(candidate.photoIds, statusOf)) continue;
        ids.push(...candidate.photoIds);
        groupsTaken += 1;
      }
      for (const id of ids.slice(0, PREFETCH_PHOTOS)) {
        if (cancelled) return;
        await warmOnDemandPreviewCache(id, 3, { maxDimension: CELL_PREVIEW_DIMENSION }).catch(() => false);
      }
    }, PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resolvedGroupId]);

  const previewThumbnail = useThumbnailView(previewId);
  const previewBase = previewId ? assetById.get(previewId) ?? null : null;
  const previewAsset = previewBase && previewThumbnail ? { ...previewBase, ...previewThumbnail } : previewBase;
  const previewAssets = useMemo(
    () => (previewId
      ? photoIds.map((id) => assetById.get(id)).filter((photo): photo is ImageAsset => Boolean(photo)).map(withThumbnailView)
      : []),
    // photoIds è derivato da group: basta seguire il gruppo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assetById, group, previewId],
  );

  // Fino a 6 varianti stanno tutte in vista, con le colonne che le fanno più grandi; oltre scorrono.
  const cellsRef = useRef<HTMLUListElement | null>(null);
  const cellsSize = useElementSize(cellsRef, group !== null);
  const meanAspect = useMemo(() => {
    const aspects = photoIds.map((id) => assetById.get(id)).filter((photo): photo is ImageAsset => Boolean(photo)).map(displayedAspect);
    return aspects.length > 0 ? aspects.reduce((sum, value) => sum + value, 0) / aspects.length : 1.5;
    // photoIds è derivato da group: basta seguire il gruppo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetById, group]);
  const layout = bestGridLayout(photoIds.length, meanAspect, cellsSize.width, cellsSize.height, CELL_CHROME_PX, CELL_GAP_PX);
  const columns = layout.columns;
  // In una finestra bassa le foto starebbero troppo piccole: meglio schede più alte che scorrono.
  const fitsScreen = photoIds.length <= FIT_SCREEN_MAX && (cellsSize.width <= 0 || layout.photoWidth >= MIN_FIT_PHOTO_WIDTH);
  const cellsStyle = {
    ...(fitsScreen ? { "--similar-cols": columns, "--similar-rows": Math.ceil(photoIds.length / columns) } : {}),
    "--lens-scale": lensScale,
  } as CSSProperties;

  // La lente: ingrandisce nello stesso punto tutte le varianti. Si sposta il puntatore su una foto e le altre seguono.
  // Il punto si legge sulla cornice a misura di layout (non cambia con lo zoom), così non c'è effetto rimbalzo.
  const handleLensMove = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (!lensOn) return;
    const list = event.currentTarget;
    const stage = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".similar-workspace__stage") : null;
    const picture = stage?.querySelector<HTMLElement>(".similar-workspace__picture");
    if (!stage || !picture || picture.offsetWidth <= 0 || picture.offsetHeight <= 0) {
      list.removeAttribute("data-lens-hover");
      return;
    }
    const bounds = stage.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left - picture.offsetLeft) / picture.offsetWidth));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top - picture.offsetTop) / picture.offsetHeight));
    list.style.setProperty("--lens-x", `${(x * 100).toFixed(2)}%`);
    list.style.setProperty("--lens-y", `${(y * 100).toFixed(2)}%`);
    list.setAttribute("data-lens-hover", "true");
  };
  useEffect(() => {
    const list = cellsRef.current;
    if (!lensOn || !list) return;
    // La rotella cambia l'ingrandimento (listener non passivo: deve fermare lo scorrimento).
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setLensScale((current) => Math.min(LENS_SCALE_MAX, Math.max(LENS_SCALE_MIN, current + (event.deltaY < 0 ? 0.5 : -0.5))));
    };
    list.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      list.removeEventListener("wheel", handleWheel);
      list.removeAttribute("data-lens-hover");
    };
  }, [lensOn, group !== null]);

  const keptNames = group
    ? group.photoIds.filter((id) => pickStatusOf(id) === "picked").map((id) => assetById.get(id)?.fileName ?? id)
    : [];
  const recommendedName = group ? assetById.get(group.recommendedId)?.fileName ?? "" : "";
  const decidedGroups = groups.length - undecidedCount;

  return (
    <div
      ref={rootRef}
      className="similar-workspace"
      role="dialog"
      aria-modal="true"
      aria-label="Foto simili"
      tabIndex={-1}
      onMouseDown={(event) => {
        // Un clic su un pulsante non gli lascia il fuoco: i tasti restano alla schermata.
        // L'anteprima grande (portale nel body) gestisce i suoi pulsanti da sé.
        const button = event.target instanceof HTMLElement ? event.target.closest("button") : null;
        if (button && !button.closest(".quick-preview")) event.preventDefault();
      }}
    >
      <header className="similar-workspace__header">
        <div className="similar-workspace__title">
          <strong>Foto simili</strong>
          <span>
            {groups.length} gruppi · {undecidedCount > 0 ? `${undecidedCount} da decidere` : "tutti decisi"}
          </span>
          {isAnalyzing || analyzedCount < totalCount ? (
            <span className="similar-workspace__progress" role="status" aria-live="polite">
              {isAnalyzing
                ? `Analisi delle miniature: ${analyzedCount} di ${totalCount}…`
                : `Analizzate ${analyzedCount} di ${totalCount} miniature: le altre si raggruppano solo per ora di scatto.`}
            </span>
          ) : null}
        </div>
        <div className="similar-workspace__tools">
          <button
            type="button"
            className={`ghost-button ghost-button--small similar-workspace__lens-toggle${lensOn ? " similar-workspace__lens-toggle--on" : ""}`}
            onClick={toggleLens}
            aria-pressed={lensOn}
            title="Lente (L): passa il puntatore su una foto e tutte le varianti si ingrandiscono nello stesso punto, per confrontare occhi e dettagli. La rotella cambia l'ingrandimento."
          >
            {lensOn ? `Lente ${Math.round(lensScale * 100)}%` : "Lente"}
          </button>
          <label className="similar-workspace__toggle">
            <input
              type="checkbox"
              checked={onlyUndecided}
              onChange={(event) => {
                setOnlyUndecided(event.target.checked);
                rootRef.current?.focus({ preventScroll: true });
              }}
            />
            Solo da decidere
          </label>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={onJoinSelection}
            disabled={selectedCount < 2}
            title="Le foto selezionate nella griglia diventano un gruppo di varianti (vale per questa sessione)"
          >
            Unisci la selezione come simili
          </button>
          {hasOverrides ? (
            <button
              type="button"
              className="ghost-button ghost-button--small"
              onClick={onResetOverrides}
              title="Dimentica separazioni e unioni fatte a mano"
            >
              Ripristina gruppi automatici
            </button>
          ) : null}
          <button type="button" className="ghost-button ghost-button--small" onClick={onClose} title="Torna alla griglia (Esc)">
            Chiudi
          </button>
        </div>
        <div
          className="similar-workspace__progressbar"
          role="progressbar"
          aria-label="Gruppi decisi"
          aria-valuemin={0}
          aria-valuemax={groups.length}
          aria-valuenow={decidedGroups}
        >
          <i style={{ width: groups.length > 0 ? `${(decidedGroups / groups.length) * 100}%` : "0%" }} />
        </div>
      </header>

      <div className="similar-workspace__noticebar">
        {notice ? (
          <div className="similar-workspace__notice" role="status" aria-live="polite">
            <span>{notice.text}</span>
            <button type="button" className="ghost-button ghost-button--small" onClick={undo} disabled={!canUndo} title="Annulla l'ultima modifica (Ctrl+Z)">
              Annulla
            </button>
          </div>
        ) : null}
      </div>

      <div className="similar-workspace__body">
        <aside className="similar-workspace__groups" aria-label="Gruppi di foto simili">
          {shownGroups.length === 0 ? (
            <p className="similar-workspace__empty">
              {groups.length === 0 ? "Nessuna raffica o foto quasi uguale trovata." : "Tutti i gruppi hanno già una foto tenuta."}
            </p>
          ) : (
            <ul>
              {shownGroups.map((candidate, index) => {
                const candidateDecided = isGroupDecided(candidate.photoIds, pickStatusOf);
                const representativeId = candidateDecided
                  ? candidate.photoIds.find((id) => pickStatusOf(id) === "picked") ?? candidate.recommendedId
                  : candidate.recommendedId;
                return (
                  <SimilarGroupRow
                    key={candidate.id}
                    group={candidate}
                    index={index}
                    active={candidate.id === resolvedGroupId}
                    decided={candidateDecided}
                    representative={assetById.get(representativeId)}
                    onOpen={setActiveGroupId}
                  />
                );
              })}
            </ul>
          )}
        </aside>

        <section className="similar-workspace__main" aria-label="Gruppo aperto">
          {group ? (
            <>
              <div className="similar-workspace__group-head">
                <div className="similar-workspace__nav">
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => moveGroup(-1)}
                    disabled={activeIndex <= 0}
                    title="Gruppo precedente (↑)"
                    aria-label="Gruppo precedente"
                  >
                    ‹
                  </button>
                  <span>Gruppo {activeIndex + 1} di {shownGroups.length}</span>
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => moveGroup(1)}
                    disabled={activeIndex >= shownGroups.length - 1}
                    title="Gruppo successivo (↓)"
                    aria-label="Gruppo successivo"
                  >
                    ›
                  </button>
                </div>
                <div className="similar-workspace__info">
                  <strong>{SIMILAR_KIND_LABELS[group.kind]} · {group.photoIds.length} foto</strong>
                  <span>
                    {decided
                      ? `${keptNames.length === 1 ? "Tenuta" : "Tenute"}: ${keptNames.join(", ")}`
                      : mixedTone
                        ? "Nessuna consigliata automatica"
                        : `Consigliata${group.reason ? ` (${group.reason})` : ""}: ${recommendedName}`}
                  </span>
                  {group.insights.note ? (
                    <span className={`similar-workspace__note similar-workspace__note--${group.insights.verdict}`}>{group.insights.note}</span>
                  ) : null}
                </div>
                <div className="similar-workspace__actions">
                  {closePlan.keep.length > 0 && closePlan.reject.length > 0 ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--small similar-workspace__keep"
                      onClick={closeGroup}
                      disabled={!editable}
                      title={`Tiene le ${closePlan.keep.length} foto con Pick e scarta le altre ${closePlan.reject.length}, poi passi al gruppo successivo (Invio su una foto Pick · Ctrl+Z per annullare)`}
                    >
                      Scarta le altre ({closePlan.reject.length})
                    </button>
                  ) : null}
                  {softToDiscard.length > 0 ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--small"
                      onClick={discardSoft}
                      disabled={!editable}
                      title="Scarta solo le varianti nettamente meno nitide (mosse o fuori fuoco), senza decidere il resto del gruppo"
                    >
                      Scarta le più morbide ({softToDiscard.length})
                    </button>
                  ) : null}
                  {!mixedTone ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--small similar-workspace__keep"
                      onClick={() => keepPhotos([group.recommendedId])}
                      disabled={!editable}
                      title="Solo la consigliata diventa Pick e le altre Scartate, poi passi al gruppo successivo (Ctrl+Z per annullare)"
                    >
                      Tieni la consigliata
                    </button>
                  ) : null}
                  {group.photoIds.length <= 4 ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--small"
                      onClick={() => onCompare(group.photoIds)}
                      title="Confronta le varianti affiancate"
                    >
                      Confronta
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => onShowInGrid(group.photoIds, currentPhotoId ?? group.recommendedId)}
                    title="Chiude questa schermata, seleziona tutte le varianti nella griglia e ti porta alla prima"
                  >
                    Seleziona nella griglia
                  </button>
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => onSeparate(group)}
                    title="Non sono varianti dello stesso scatto: separa il gruppo (vale per questa sessione)"
                  >
                    Separa
                  </button>
                </div>
              </div>

              <ul
                ref={cellsRef}
                className={`similar-workspace__cells ${fitsScreen ? "similar-workspace__cells--fit" : "similar-workspace__cells--scroll"}`}
                style={cellsStyle}
                data-lens={lensOn ? "on" : "off"}
                onPointerMove={handleLensMove}
                onPointerLeave={(event) => event.currentTarget.removeAttribute("data-lens-hover")}
              >
                {photoIds.map((id, index) => {
                  const photo = assetById.get(id);
                  if (!photo) return null;
                  return (
                    <SimilarCell
                      key={id}
                      photo={photo}
                      position={index + 1}
                      total={photoIds.length}
                      active={id === currentPhotoId}
                      recommended={id === group.recommendedId && !mixedTone}
                      editable={editable}
                      canDetach={photoIds.length > 2}
                      insight={group.insights.byPhoto.get(id)}
                      previewDimension={lensOn ? LENS_PREVIEW_DIMENSION : CELL_PREVIEW_DIMENSION}
                      onActivate={setActivePhotoId}
                      onEnlarge={openLarge}
                      onUpdate={onUpdatePhoto}
                      onKeep={(photoId) => keepPhotos([photoId])}
                      onShowInGrid={(photoId) => onShowInGrid([photoId], photoId)}
                      onDetach={(photoId) => onDetach(group, photoId)}
                    />
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="similar-workspace__empty similar-workspace__empty--main">
              {groups.length === 0 ? "Nessuna raffica o foto quasi uguale trovata." : "Nessun gruppo da mostrare."}
            </p>
          )}
        </section>
      </div>

      <footer className="similar-workspace__hints" aria-label="Scorciatoie">
        <span><kbd>←</kbd> <kbd>→</kbd> foto del gruppo</span>
        <span><kbd>↑</kbd> <kbd>↓</kbd> gruppo · <kbd>N</kbd> prossimo da decidere</span>
        <span><kbd>Spazio</kbd> ingrandisci · <kbd>L</kbd> lente</span>
        <span><kbd>1</kbd>–<kbd>5</kbd> stelle</span>
        <span><kbd>P</kbd> Pick (anche su più foto) · <kbd>X</kbd> Scartata · <kbd>U</kbd> Neutra</span>
        <span><kbd>Invio</kbd> tieni solo questa, o chiudi il gruppo se è già Pick</span>
        <span><kbd>Esc</kbd> chiudi</span>
      </footer>

      <PhotoQuickPreviewModal
        asset={previewAsset}
        assets={previewAssets}
        thumbnailProfile={thumbnailProfile}
        customLabelsCatalog={customLabelsCatalog}
        customLabelColors={customLabelColors}
        customLabelShortcuts={customLabelShortcuts}
        autoAdvanceOnAction={autoAdvanceOnAction}
        onAutoAdvanceOnActionChange={onAutoAdvanceOnActionChange}
        onClose={() => setPreviewId(null)}
        onSelectAsset={openLarge}
        onRotateAsset={onRotatePhoto}
        onUpdateAsset={onUpdatePhoto}
      />
    </div>
  );
}
