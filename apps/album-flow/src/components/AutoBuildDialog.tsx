import { useMemo, useState } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { DEFAULT_AUTO_BUILD, MAX_AUTO_PER_AREA, onePerGroupPool, orderedGroups, type AutoBuildOptions } from "../model/autobuild";
import { unusedAssets } from "../model/library";
import type { LibraryAnalysis } from "../model/similar";
import { Icon } from "./icons";
import { Field, Modal, Segmented, Switch } from "./ui";

/** Impaginazione automatica: l'utente sceglie quante foto per pagina, come trattare capitoli e panorami, cosa fare dell'album esistente. */
export function AutoBuildDialog({ project, analysis, templateCount, onClose, onRun }: { project: AlbumProjectV2; analysis?: LibraryAnalysis; templateCount: number; onClose: () => void; onRun: (options: AutoBuildOptions, useTemplates: boolean) => void }) {
  const [useTemplates, setUseTemplates] = useState(templateCount > 0);
  const hasSpreads = project.spreads.length > 0;
  const [options, setOptions] = useState<AutoBuildOptions>({ ...DEFAULT_AUTO_BUILD, scope: hasSpreads ? "unused" : "all" });
  const set = <K extends keyof AutoBuildOptions>(key: K, value: AutoBuildOptions[K]) => setOptions((current) => ({ ...current, [key]: value }));
  const byTime = project.settings.sortKey === "capture-time";

  const basePool = options.scope === "unused" ? unusedAssets(project) : project.assets;
  // Con «una per gruppo» il conteggio è quello che Auto Build userà davvero.
  const used = useMemo(() => new Set(options.scope === "unused" ? project.spreads.flatMap((spread) => spread.areas.flatMap((area) => area.items.map((item) => item.assetId))) : []), [options.scope, project.spreads]);
  const pool = analysis && options.onePerGroup ? onePerGroupPool(basePool, analysis, used) : basePool;
  const alternatives = basePool.length - pool.length;
  const groups = useMemo(() => orderedGroups(project, pool, options.respectChapters), [project, pool, options.respectChapters]);
  const perSpread = options.splitMode === "full" ? options.photosPerArea : options.photosPerArea * 2;
  const estimate = groups.reduce((sum, group) => sum + Math.max(1, Math.ceil(group.assets.length / perSpread)), 0);

  return (
    <Modal
      title="Auto Build"
      subtitle="Impagina in automatico: poi ogni spread resta modificabile a mano."
      onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Annulla</button>
        <button type="button" className="btn btn--primary" onClick={() => onRun(options, useTemplates && templateCount > 0)} disabled={pool.length === 0}><Icon name="wand" size={15} /> {options.scope === "all" && hasSpreads ? "Ricostruisci l'album" : "Impagina"}</button>
      </>}
    >
      <p className="build-summary"><strong>{pool.length}</strong> foto{groups.length > 1 || options.respectChapters ? ` in ${groups.length} ${groups.length === 1 ? "gruppo" : "gruppi"}` : ""} → circa <strong>{estimate}</strong> spread{alternatives > 0 ? <span className="muted"> · {alternatives} {alternatives === 1 ? "foto simile resta" : "foto simili restano"} come alternativa</span> : null}</p>

      <Field label="Foto per pagina" hint="È un obiettivo: il motore può scostarsi di una foto quando migliora l'impaginazione.">
        <div className="stepper">
          <button type="button" className="icon-btn" onClick={() => set("photosPerArea", Math.max(1, options.photosPerArea - 1))} aria-label="Meno foto"><Icon name="minus" /></button>
          <output aria-label="Foto per pagina">{options.photosPerArea}</output>
          <button type="button" className="icon-btn" onClick={() => set("photosPerArea", Math.min(MAX_AUTO_PER_AREA, options.photosPerArea + 1))} aria-label="Più foto"><Icon name="plus" /></button>
        </div>
      </Field>

      <Field label="Struttura degli spread">
        <Segmented label="Struttura" value={options.splitMode} onChange={(value) => set("splitMode", value)} options={[
          { value: "mixed", label: "Pagine + panorami a foglio intero" },
          { value: "half", label: "Sempre due pagine" },
          { value: "full", label: "Sempre foglio intero" },
        ]} />
      </Field>
      <Field label="Inquadratura iniziale">
        <Segmented label="Inquadratura" value={options.fitMode} onChange={(value) => set("fitMode", value)} options={[{ value: "fill", label: "Riempi lo spazio" }, { value: "fit", label: "Foto intera" }]} />
      </Field>

      <div className="switches">
        <Switch checked={options.respectChapters} onChange={(value) => set("respectChapters", value)} label={project.chapters.length ? `Ogni capitolo inizia su un nuovo spread (${project.chapters.length} ${project.chapters.length === 1 ? "capitolo" : "capitoli"})` : "Ogni capitolo inizia su un nuovo spread (nessun capitolo creato)"} />
        {templateCount > 0 ? <Switch checked={useTemplates} onChange={setUseTemplates} label={`Usa i miei template dove si adattano (${templateCount})`} /> : null}
        <Switch checked={options.varyLayouts} onChange={(value) => set("varyLayouts", value)} label="Alterna i layout per un ritmo più vario" />
        {analysis && analysis.groups.length > 0 ? <Switch checked={options.onePerGroup} onChange={(value) => set("onePerGroup", value)} label={`Una sola foto per gruppo di simili (${analysis.groups.length} ${analysis.groups.length === 1 ? "gruppo" : "gruppi"}: le altre restano alternative, tasto A)`} /> : null}
        {analysis && analysis.moments.length > 1 ? <Switch checked={options.followMoments && byTime} onChange={(value) => set("followMoments", value)} label={byTime ? `Una pagina non mescola due momenti (${analysis.moments.length} momenti dalle pause tra gli scatti)` : "Una pagina non mescola due momenti (solo con l'ordine per ora di scatto)"} /> : null}
        <Switch checked={options.heroLargest} onChange={(value) => set("heroLargest", value)} label="La foto con più stelle della pagina prende lo spazio più grande" />
      </div>

      {hasSpreads ? (
        <Field label="Cosa fare dell'album che hai già">
          <Segmented label="Ambito" value={options.scope} onChange={(value) => set("scope", value)} options={[{ value: "unused", label: "Aggiungi solo foto non usate" }, { value: "all", label: "Ricostruisci tutto" }]} />
        </Field>
      ) : null}
      {hasSpreads && options.scope === "all" ? <p className="notice notice--warn">Ricostruire sostituisce tutti gli spread attuali (potrai annullare con Ctrl/⌘+Z).</p> : null}
      <p className="muted small">Le foto con tag <kbd>K</kbd> copertina o <kbd>M</kbd> principale ottengono un'area tutta per loro; <kbd>P</kbd> panorama (e le foto molto larghe) un foglio intero.</p>
    </Modal>
  );
}
