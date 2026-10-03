import { useState } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { chooseFolderAndScan } from "../desktop/importer";
import { commonRoot, relativePathOfCandidate, relinkAssets, type RelinkResult } from "../model/relinkAssets";
import { Modal } from "./ui";

/**
 * «Ricollega le foto»: scegli la cartella dove stanno ora le foto (altro disco, altro computer). Ogni foto mancante si
 * cerca per percorso relativo, poi per nome e dimensione; i nomi doppi non si indovinano.
 */
export function RelinkDialog({ project, missingIds, onApply, onClose }: {
  project: AlbumProjectV2;
  missingIds: ReadonlySet<string>;
  onApply: (result: RelinkResult) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<RelinkResult | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = project.assets.filter((asset) => missingIds.has(asset.id));
  const nameOf = (id: string) => project.assets.find((asset) => asset.id === id)?.fileName ?? id;

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const scan = await chooseFolderAndScan();
      if (!scan) return;
      const files = scan.candidates.filter((candidate) => candidate.absolutePath).map((candidate) => ({
        absolutePath: candidate.absolutePath!,
        fileName: candidate.fileName,
        size: candidate.size,
        relativePath: relativePathOfCandidate(candidate.folder, candidate.fileName),
      }));
      const oldRoot = project.sourceFolderPath || commonRoot(missing.map((asset) => asset.absolutePath ?? ""));
      setFolder(scan.sourceName ?? null);
      setResult(relinkAssets(project.assets, missingIds, files, oldRoot));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Impossibile leggere la cartella.");
    } finally {
      setBusy(false);
    }
  };

  const byPath = result ? [...result.found.values()].filter((hit) => hit.how === "percorso").length : 0;
  const unresolved = result ? [...result.ambiguous, ...result.missing] : [];

  return (
    <Modal
      title="Ricollega le foto"
      subtitle={`${missing.length} ${missing.length === 1 ? "foto non trovata" : "foto non trovate"} su questo computer`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Chiudi</button>
          {result && result.found.size > 0 ? <button type="button" className="btn btn--primary" onClick={() => { onApply(result); setResult(null); }}>Ricollega {result.found.size} {result.found.size === 1 ? "foto" : "foto"}</button> : null}
        </>
      )}
    >
      <div className="relink">
        <p>Le foto dell'album stanno sul disco, non nel progetto: se hai aperto l'album su un altro computer o le hai spostate, indica la cartella dove si trovano adesso. Non viene copiato né modificato nessun file.</p>
        <div className="btn-row">
          <button type="button" className="btn btn--primary" onClick={() => void choose()} disabled={busy}>{busy ? "Leggo la cartella…" : result ? "Scegli un'altra cartella…" : "Scegli la cartella delle foto…"}</button>
        </div>
        {error ? <p className="relink__error" role="alert">{error}</p> : null}
        {result ? (
          <div className="relink__result" role="status">
            <p><strong>{result.found.size}</strong> {result.found.size === 1 ? "foto ritrovata" : "foto ritrovate"} in «{folder ?? "cartella"}»{result.found.size ? ` (${byPath} dallo stesso percorso, ${result.found.size - byPath} da nome e dimensione)` : ""}.</p>
            {result.ambiguous.length ? <p className="muted">{result.ambiguous.length} con più file uguali nella cartella: non scelgo io al posto tuo.</p> : null}
            {result.missing.length ? <p className="muted">{result.missing.length} non presenti in questa cartella{result.found.size ? ": puoi sceglierne un'altra dopo aver ricollegato queste." : "."}</p> : null}
            {unresolved.length ? (
              <details>
                <summary>Foto ancora da trovare ({unresolved.length})</summary>
                <ul className="relink__list">{unresolved.slice(0, 40).map((id) => <li key={id}>{nameOf(id)}{result.ambiguous.includes(id) ? " (più file uguali)" : ""}</li>)}{unresolved.length > 40 ? <li>…e altre {unresolved.length - 40}</li> : null}</ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
