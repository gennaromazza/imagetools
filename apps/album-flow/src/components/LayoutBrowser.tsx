import { useMemo } from "react";
import type { AlbumAssetV2, AlbumProjectV2, AlbumSpread, AreaTemplate } from "@photo-tools/shared-types";
import { TEMPLATE_SEED_BASE, areaCandidates, favoritesFor, layoutChoices } from "../model/areas";
import { applyTemplate, matchTemplates, templateCells, targetInner, templateTarget, TARGET_LABELS } from "../model/templates";
import { applyShape } from "../engine/tree";
import { leafIds } from "../engine/tree";
import { AreaPreview } from "./AreaPreview";
import { Icon } from "./icons";
import { IconButton } from "./ui";

const sameTree = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Elenco di tutti i layout applicabili all'area attiva (binocolo): clic per applicare; i primi nove anche con i tasti 1-9. */
export function LayoutBrowser({ project, spread, areaIndex, assets, templates, onApply, onApplyFavorite, onRemoveFavorite, onNewTemplate, onEditTemplate, onDeleteTemplate, onSaveAsTemplate, onClose }: {
  project: AlbumProjectV2;
  spread: AlbumSpread;
  areaIndex: number;
  assets: ReadonlyMap<string, AlbumAssetV2>;
  onApply: (candidateIndex: number) => void;
  onApplyFavorite: (favoriteId: string) => void;
  onRemoveFavorite: (favoriteId: string) => void;
  templates: readonly AreaTemplate[];
  onNewTemplate: () => void;
  onEditTemplate: (templateId: string, asCopy?: boolean) => void;
  onDeleteTemplate: (templateId: string) => void;
  onSaveAsTemplate: () => void;
  onClose: () => void;
}) {
  const area = spread.areas[areaIndex];
  const candidates = useMemo(() => areaCandidates(project, spread, areaIndex, 24), [project, spread, areaIndex]);
  const favorites = favoritesFor(project, area);
  const target = templateTarget(spread, areaIndex);
  const matches = useMemo(() => matchTemplates(project, spread, areaIndex, templates), [project, spread, areaIndex, templates]);
  // Posizione di ogni layout nell'elenco unico (la stessa dei tasti 1-9 e di Mescola): il migliore calcolato, i template, gli altri.
  const position = useMemo(() => { const map = new Map<number, number>(); layoutChoices(project, spread, areaIndex, templates, 24).forEach((choice, index) => map.set(choice.seed, index)); return map; }, [project, spread, areaIndex, templates]);
  const previews = useMemo(() => matches.map((match) => {
    const after = applyTemplate(project, spread.id, areaIndex, match.template, match.order);
    return { match, area: after.spreads.find((candidate) => candidate.id === spread.id)?.areas[areaIndex] };
  }), [matches, project, spread, areaIndex]);
  // Tutti i template dell'utente restano visibili: quelli che non corrispondono all'area attuale non si possono applicare.
  const matchedIds = new Set(matches.map((match) => match.template.id));
  const unavailable = templates.filter((template) => !matchedIds.has(template.id));
  const reasonOf = (template: AreaTemplate) => {
    const parts: string[] = [];
    if (template.target !== target) parts.push(`è per «${TARGET_LABELS[template.target]}», qui c'è «${TARGET_LABELS[target]}»`);
    if (template.count !== area.items.length) parts.push(`ha ${template.count} ${template.count === 1 ? "foto" : "foto"}, nell'area ce ne sono ${area.items.length}`);
    return parts.length ? `Non applicabile: ${parts.join(" e ")}.` : "Non applicabile a questa area.";
  };
  const where = spread.areas.length === 1 ? "il foglio intero" : areaIndex === 0 ? "la pagina sinistra" : "la pagina destra";

  return (
    <aside className={`layouts${spread.areas.length > 1 && areaIndex === 1 ? " layouts--left" : ""}`} aria-label="Layout disponibili">
      <header className="layouts__head">
        <div>
          <h3>Layout per {where}</h3>
          <p className="muted small">{area.items.length === 0 ? "Aggiungi delle foto per vedere i layout." : `${candidates.length} ${candidates.length === 1 ? "disposizione" : "disposizioni"} per ${area.items.length} foto, in ordine di resa.`}</p>
        </div>
        <IconButton icon="close" label="Chiudi" onClick={onClose} />
      </header>
      <div className="layouts__body">
        <section>
          <div className="layouts__section-head">
            <h4><Icon name="pencil" size={13} /> I tuoi template</h4>
            <div className="btn-row">
              <button type="button" className="btn btn--sm" onClick={onNewTemplate}><Icon name="plus" size={13} /> Disegna</button>
              <button type="button" className="btn btn--sm" disabled={area.items.length === 0} onClick={onSaveAsTemplate} title="Salva la disposizione attuale come template">Salva questa</button>
            </div>
          </div>
          {previews.length > 0 ? (
            <div className="layouts__grid">
              {previews.map(({ match, area: preview }, tIndex) => preview ? (
                <div key={match.template.id} className="layouts__card">
                  <button type="button" className={`layouts__thumb${area.seed === TEMPLATE_SEED_BASE + tIndex ? " is-current" : ""}`} onClick={() => onApply(position.get(TEMPLATE_SEED_BASE + tIndex) ?? 0)} aria-label={`Applica il template ${match.template.name}`}>
                    <AreaPreview sheet={project.settings.sheet} spread={spread} areaIndex={areaIndex} area={preview} assets={assets} />
                  </button>
                  <div className="layouts__tpl-actions">
                    <button type="button" onClick={() => onEditTemplate(match.template.id)} title="Modifica il template" aria-label="Modifica il template"><Icon name="pencil" size={11} /></button>
                    <button type="button" onClick={() => onDeleteTemplate(match.template.id)} title="Elimina il template" aria-label="Elimina il template"><Icon name="close" size={11} /></button>
                  </div>
                  <kbd className="layouts__key">{(position.get(TEMPLATE_SEED_BASE + tIndex) ?? 0) + 1 <= 9 ? (position.get(TEMPLATE_SEED_BASE + tIndex) ?? 0) + 1 : ""}</kbd>
                  <span className="layouts__tpl-name" title={match.template.name}>{match.template.kind === "free" ? "◩ " : ""}{match.template.name}</span>
                </div>
              ) : null)}
            </div>
          ) : unavailable.length > 0 ? null : (
            <p className="muted small">{area.items.length === 0 ? "Aggiungi delle foto per vedere i tuoi template." : `Nessun tuo template per ${area.items.length} ${area.items.length === 1 ? "foto" : "foto"} su «${TARGET_LABELS[target]}». Disegnane uno o salva questo layout.`}</p>
          )}
          {unavailable.length > 0 ? (
            <>
              <p className="muted small layouts__unavailable-note">{previews.length > 0 ? "Altri tuoi template, non applicabili a questa area:" : "I tuoi template non sono applicabili a questa area (tipo di area o numero di foto diversi):"} puoi modificarli o crearne una copia da ampliare.</p>
              <div className="layouts__grid">
                {unavailable.map((template) => {
                  const inner = targetInner(project.settings.sheet, template.target, project.settings.defaultStyle.paddingCm);
                  const cells = templateCells(template, inner, project.settings.defaultStyle.gapCm * 10);
                  const reason = reasonOf(template);
                  return (
                    <div key={template.id} className="layouts__card layouts__card--off" title={reason}>
                      <div className="layouts__thumb layouts__thumb--off">
                        <svg viewBox={`${inner.x} ${inner.y} ${inner.w} ${inner.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Anteprima di ${template.name}`}>
                          {[...cells].sort((a, b) => a.z - b.z).map((cell, index) => (
                            <rect key={index} x={cell.rect.x} y={cell.rect.y} width={cell.rect.w} height={cell.rect.h} rx={1.5} transform={cell.rotation ? `rotate(${cell.rotation} ${cell.rect.x + cell.rect.w / 2} ${cell.rect.y + cell.rect.h / 2})` : undefined} />
                          ))}
                        </svg>
                        <span className="layouts__off-badge">{TARGET_LABELS[template.target]} · {template.count} {template.count === 1 ? "foto" : "foto"}</span>
                      </div>
                      <div className="layouts__tpl-actions">
                        <button type="button" onClick={() => onEditTemplate(template.id)} title="Modifica il template" aria-label="Modifica il template"><Icon name="pencil" size={11} /></button>
                        <button type="button" onClick={() => onEditTemplate(template.id, true)} title="Crea un nuovo template da questo (copia da ampliare)" aria-label="Crea una copia del template"><Icon name="plus" size={11} /></button>
                        <button type="button" onClick={() => onDeleteTemplate(template.id)} title="Elimina il template" aria-label="Elimina il template"><Icon name="close" size={11} /></button>
                      </div>
                      <span className="layouts__tpl-name" title={reason}>{template.kind === "free" ? "◩ " : ""}{template.name}</span>
                      <span className="layouts__tpl-warn">{reason}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>
        {favorites.length > 0 ? (
          <section>
            <h4><Icon name="heart" size={13} /> Preferiti</h4>
            <div className="layouts__grid">
              {favorites.map((favorite) => {
                const tree = applyShape(favorite.layout, leafIds(area.layout));
                if (!tree) return null;
                return (
                  <div key={favorite.id} className="layouts__card">
                    <button type="button" className={`layouts__thumb${sameTree(tree, area.layout) ? " is-current" : ""}`} onClick={() => onApplyFavorite(favorite.id)} aria-label="Applica questo layout preferito">
                      <AreaPreview sheet={project.settings.sheet} spread={spread} areaIndex={areaIndex} tree={tree} assets={assets} />
                    </button>
                    <button type="button" className="layouts__remove" onClick={() => onRemoveFavorite(favorite.id)} title="Togli dai preferiti" aria-label="Togli dai preferiti"><Icon name="close" size={12} /></button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        <section>
          {favorites.length > 0 ? <h4>Tutti i layout</h4> : null}
          <div className="layouts__grid">
            {candidates.map((candidate, index) => (
              <div key={index} className="layouts__card">
                <button type="button" className={`layouts__thumb${sameTree(candidate.tree, area.layout) ? " is-current" : ""}`} onClick={() => onApply(position.get(index) ?? index)} aria-label={`Applica il layout ${(position.get(index) ?? index) + 1}`}>
                  <AreaPreview sheet={project.settings.sheet} spread={spread} areaIndex={areaIndex} tree={candidate.tree} assets={assets} />
                </button>
                {(position.get(index) ?? index) < 9 ? <kbd className="layouts__key">{(position.get(index) ?? index) + 1}</kbd> : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
