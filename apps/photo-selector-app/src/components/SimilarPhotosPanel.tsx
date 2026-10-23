import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageAsset } from "@photo-tools/shared-types";
import { formatAssetStars, getAssetPickStatus, getAssetRating, PICK_STATUS_LABELS } from "../services/photo-classification";
import { getAssetRotation, getRotatedContentFitScale } from "../services/photo-rotation";
import { isGroupDecided, SIMILAR_KIND_LABELS, type SimilarGroupView } from "../services/similar-photos";
import { useThumbnailView } from "../services/use-thumbnail-view";

const PAGE_SIZE = 30;

interface SimilarPhotosPanelProps {
  groups: SimilarGroupView[];
  assetById: ReadonlyMap<string, ImageAsset>;
  focusGroupId: string | null;
  analyzedCount: number;
  totalCount: number;
  isAnalyzing: boolean;
  selectedCount: number;
  hasOverrides: boolean;
  editable: boolean;
  onKeep: (group: SimilarGroupView, photoId: string) => void;
  onSelect: (photoIds: string[]) => void;
  onCompare: (photoIds: string[]) => void;
  onSeparate: (group: SimilarGroupView) => void;
  onDetach: (group: SimilarGroupView, photoId: string) => void;
  onJoinSelection: () => void;
  onResetOverrides: () => void;
}

function SimilarThumb({
  photo,
  recommended,
  editable,
  canDetach,
  onKeep,
  onDetach,
}: {
  photo: ImageAsset;
  recommended: boolean;
  editable: boolean;
  canDetach: boolean;
  onKeep: () => void;
  onDetach: () => void;
}) {
  const view = useThumbnailView(photo.id);
  const url = view?.thumbnailUrl ?? photo.thumbnailUrl ?? photo.previewUrl;
  const rotation = getAssetRotation(photo);
  const fitScale = getRotatedContentFitScale(4, 3, view?.width ?? photo.width, view?.height ?? photo.height, rotation);
  const pickStatus = getAssetPickStatus(photo);
  const rating = getAssetRating(photo);
  return (
    <li className={`photo-selector__similar-thumb${recommended ? " photo-selector__similar-thumb--recommended" : ""} photo-selector__similar-thumb--${pickStatus}`}>
      <button
        type="button"
        className="photo-selector__similar-keep"
        onClick={onKeep}
        disabled={!editable}
        title={`Tieni ${photo.fileName}: diventa Pick, le altre varianti Scartate (Ctrl+Z per annullare)`}
      >
        {url ? (
          <img src={url} alt="" loading="lazy" decoding="async" style={{ transform: `rotate(${rotation}deg) scale(${fitScale})` }} />
        ) : (
          <span className="photo-selector__similar-placeholder" aria-hidden="true">…</span>
        )}
        <span className="photo-selector__similar-keep-hint" aria-hidden="true">Tieni questa</span>
        {recommended ? <span className="photo-selector__similar-tag">Consigliata</span> : null}
        <span className={`asset-pick-badge asset-pick-badge--${pickStatus} photo-selector__similar-status`}>
          {PICK_STATUS_LABELS[pickStatus]}
        </span>
      </button>
      <span className="photo-selector__similar-caption" title={photo.fileName}>
        <span className="photo-selector__similar-name">{photo.fileName}</span>
        <span className="photo-selector__similar-stars">{rating > 0 ? formatAssetStars(photo) : "—"}</span>
      </span>
      {canDetach ? (
        <button
          type="button"
          className="photo-selector__similar-detach"
          onClick={onDetach}
          title="Togli dal gruppo: questa foto non è una variante delle altre (vale per questa sessione)"
          aria-label={`Togli ${photo.fileName} dal gruppo`}
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

/**
 * Pannello «Simili»: raffiche e foto quasi uguali, con la consigliata per prima. Un clic su una
 * foto la tiene e scarta le altre varianti; Separa / Togli / Unisci correggono i gruppi per la sessione.
 */
export function SimilarPhotosPanel({
  groups,
  assetById,
  focusGroupId,
  analyzedCount,
  totalCount,
  isAnalyzing,
  selectedCount,
  hasOverrides,
  editable,
  onKeep,
  onSelect,
  onCompare,
  onSeparate,
  onDetach,
  onJoinSelection,
  onResetOverrides,
}: SimilarPhotosPanelProps) {
  const [onlyUndecided, setOnlyUndecided] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const focusRef = useRef<HTMLLIElement | null>(null);
  const pickStatusOf = (id: string) => assetById.get(id)?.pickStatus;
  const undecidedCount = useMemo(
    () => groups.reduce((count, group) => count + (isGroupDecided(group.photoIds, (id) => assetById.get(id)?.pickStatus) ? 0 : 1), 0),
    [assetById, groups],
  );
  const shownGroups = useMemo(
    () => (onlyUndecided ? groups.filter((group) => !isGroupDecided(group.photoIds, (id) => assetById.get(id)?.pickStatus)) : groups),
    [assetById, groups, onlyUndecided],
  );
  const focusIndex = focusGroupId ? shownGroups.findIndex((group) => group.id === focusGroupId) : -1;

  useEffect(() => {
    if (focusGroupId && focusIndex < 0 && onlyUndecided) setOnlyUndecided(false);
  }, [focusGroupId, focusIndex, onlyUndecided]);
  useEffect(() => {
    if (focusIndex >= limit) setLimit(focusIndex + 1);
  }, [focusIndex, limit]);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusGroupId, focusIndex >= 0 && focusIndex < limit]);

  return (
    <section className="photo-selector__selection-bar photo-selector__similar-panel" aria-label="Foto simili">
      <header className="photo-selector__similar-header">
        <div className="photo-selector__similar-summary">
          <strong>{groups.length} gruppi di foto simili</strong>
          <span>{undecidedCount} da decidere · la consigliata segue stelle, poi nitidezza ed esposizione</span>
          {isAnalyzing || analyzedCount < totalCount ? (
            <span className="photo-selector__similar-progress" role="status" aria-live="polite">
              {isAnalyzing
                ? `Analisi delle miniature: ${analyzedCount} di ${totalCount}…`
                : `Analizzate ${analyzedCount} di ${totalCount} miniature: le altre si raggruppano solo per ora di scatto.`}
            </span>
          ) : null}
        </div>
        <div className="photo-selector__similar-tools">
          <label className="photo-selector__similar-toggle">
            <input type="checkbox" checked={onlyUndecided} onChange={(event) => setOnlyUndecided(event.target.checked)} />
            Solo da decidere
          </label>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={onJoinSelection}
            disabled={selectedCount < 2}
            title="Le foto selezionate diventano un gruppo di varianti (vale per questa sessione)"
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
        </div>
      </header>

      {shownGroups.length === 0 ? (
        <p className="photo-selector__similar-empty">
          {groups.length === 0 ? "Nessuna raffica o foto quasi uguale trovata." : "Tutti i gruppi hanno già una foto tenuta."}
        </p>
      ) : (
        <ul className="photo-selector__similar-list">
          {shownGroups.slice(0, limit).map((group, index) => {
            const decided = isGroupDecided(group.photoIds, pickStatusOf);
            const recommended = assetById.get(group.recommendedId);
            return (
              <li
                key={group.id}
                ref={index === focusIndex ? focusRef : undefined}
                className={`photo-selector__similar-group${index === focusIndex ? " photo-selector__similar-group--focus" : ""}`}
              >
                <div className="photo-selector__similar-group-head">
                  <strong>{SIMILAR_KIND_LABELS[group.kind]} · {group.photoIds.length} foto</strong>
                  <span>
                    {decided
                      ? `Tenuta: ${group.photoIds.filter((id) => pickStatusOf(id) === "picked").map((id) => assetById.get(id)?.fileName ?? id).join(", ")}`
                      : `Consigliata${group.reason ? ` (${group.reason})` : ""}: ${recommended?.fileName ?? ""}`}
                  </span>
                  <span className="photo-selector__similar-actions">
                    <button
                      type="button"
                      className="ghost-button ghost-button--small photo-selector__similar-primary"
                      onClick={() => onKeep(group, group.recommendedId)}
                      disabled={!editable}
                      title="La consigliata diventa Pick, le altre Scartate (Ctrl+Z per annullare)"
                    >
                      Tieni la consigliata
                    </button>
                    <button type="button" className="ghost-button ghost-button--small" onClick={() => onSelect(group.photoIds)} title="Seleziona tutte le varianti nella griglia">
                      Seleziona
                    </button>
                    {group.photoIds.length <= 4 ? (
                      <button type="button" className="ghost-button ghost-button--small" onClick={() => onCompare(group.photoIds)} title="Confronta le varianti affiancate">
                        Confronta
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost-button ghost-button--small"
                      onClick={() => onSeparate(group)}
                      title="Non sono varianti dello stesso scatto: separa il gruppo (vale per questa sessione)"
                    >
                      Separa
                    </button>
                  </span>
                </div>
                <ul className="photo-selector__similar-strip">
                  {group.ranked.map((id) => {
                    const photo = assetById.get(id);
                    if (!photo) return null;
                    return (
                      <SimilarThumb
                        key={id}
                        photo={photo}
                        recommended={id === group.recommendedId}
                        editable={editable}
                        canDetach={group.photoIds.length > 2}
                        onKeep={() => onKeep(group, id)}
                        onDetach={() => onDetach(group, id)}
                      />
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {shownGroups.length > limit ? (
        <button type="button" className="ghost-button ghost-button--small photo-selector__similar-more" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
          Mostra altri {Math.min(PAGE_SIZE, shownGroups.length - limit)} gruppi
        </button>
      ) : null}
    </section>
  );
}
