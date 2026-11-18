import { useEffect, useState } from "react";
import type { AlbumAssetV2, PhotoColorAdjust } from "@photo-tools/shared-types";
import { ADJUST_KEYS, ADJUST_LABELS, ADJUST_LIMIT, isNeutralAdjust, withAdjustValue } from "../model/colorAdjust";
import { Icon } from "./icons";

export interface ColorEditorActions {
  /** Cambia la correzione della foto (i cursori si fondono in un solo passo annullabile). */
  adjust: (assetId: string, adjust: PhotoColorAdjust | undefined) => void;
  /** Avvicina i colori: la foto alle altre dello spread, oppure tutto lo spread. Restituisce la frase da mostrare. */
  match: (assetId: string, scope: "others" | "spread") => Promise<string>;
  /** Scrive la correzione sul file originale (solo dopo la conferma). Restituisce l'esito. */
  save: (assetId: string) => Promise<{ ok: boolean; message: string }>;
  restore: (assetId: string) => Promise<{ ok: boolean; message: string }>;
  hasBackup: (assetId: string) => Promise<boolean>;
}

interface ColorEditorProps {
  asset: AlbumAssetV2;
  /** Quante foto diverse ci sono nello spread: con una sola non c'è nulla con cui abbinare. */
  photosInSpread: number;
  /** L'app desktop può scrivere sul file (percorso noto e JPG). */
  canWriteFile: boolean;
  actions: ColorEditorActions;
}

/**
 * «Ritocco colore»: luminosità, contrasto, saturazione, temperatura e tinta di una foto, con l'abbinamento ai colori delle altre foto
 * dello spread. Le correzioni non toccano il file: si vedono nell'album e nell'esportazione. Solo con una conferma esplicita si
 * scrivono sul JPG originale (di cui resta una copia di sicurezza, ripristinabile da qui).
 */
export function ColorEditor({ asset, photosInSpread, canWriteFile, actions }: ColorEditorProps) {
  const adjust = asset.colorAdjust;
  const neutral = isNeutralAdjust(adjust);
  const [busy, setBusy] = useState<null | "others" | "spread" | "save" | "restore">(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [backup, setBackup] = useState(false);

  // Un'altra foto: si riparte da capo. Il segno di copia di sicurezza si rilegge anche dopo un salvataggio.
  useEffect(() => { setConfirming(false); setNote(""); }, [asset.id]);
  useEffect(() => {
    let alive = true;
    if (canWriteFile) void actions.hasBackup(asset.id).then((value) => { if (alive) setBackup(value); });
    else setBackup(false);
    return () => { alive = false; };
  }, [actions, asset.id, canWriteFile, busy]);

  const run = async (kind: "others" | "spread", job: () => Promise<string>) => {
    setBusy(kind);
    setNote("");
    try { setNote(await job()); } finally { setBusy(null); }
  };

  const save = async () => {
    setBusy("save");
    const result = await actions.save(asset.id);
    setBusy(null);
    setConfirming(false);
    setNote(result.message);
  };

  const restore = async () => {
    setBusy("restore");
    const result = await actions.restore(asset.id);
    setBusy(null);
    setNote(result.message);
  };

  return (
    <div className="coloredit" role="group" aria-label="Ritocco colore">
      <div className="coloredit__head">
        <strong>Ritocco colore</strong>
        <button type="button" className="btn btn--sm" disabled={neutral || busy !== null} onClick={() => actions.adjust(asset.id, undefined)} title="Toglie la correzione: la foto torna com'è nel file">Reimposta</button>
      </div>
      {ADJUST_KEYS.map((key) => {
        const value = adjust?.[key] ?? 0;
        const label = ADJUST_LABELS[key];
        return (
          <label key={key} className="design__field" title={`${label.label}: a sinistra ${label.low}, a destra ${label.high}. Doppio clic per azzerare.`}>
            <span>{label.label}</span>
            <input type="range" min={-ADJUST_LIMIT} max={ADJUST_LIMIT} step={0.5} value={value} aria-label={label.label}
              onChange={(event) => actions.adjust(asset.id, withAdjustValue(adjust, key, Number(event.target.value)))}
              onDoubleClick={() => actions.adjust(asset.id, withAdjustValue(adjust, key, 0))} />
            <output>{value > 0 ? `+${value}` : value}</output>
          </label>
        );
      })}

      <div className="coloredit__group">
        <span className="coloredit__title">Abbina ai colori dello spread</span>
        <div className="coloredit__row">
          <button type="button" className="btn btn--sm" disabled={photosInSpread < 2 || busy !== null} onClick={() => void run("others", () => actions.match(asset.id, "others"))}
            title="Cerca i cursori che avvicinano questa foto all'aspetto delle altre foto dello spread (luminosità, contrasto, dominante e colori). Resta una correzione normale: puoi ritoccarla.">
            <Icon name="wand" size={14} /> {busy === "others" ? "Calcolo…" : "Adatta questa foto"}
          </button>
          <button type="button" className="btn btn--sm" disabled={photosInSpread < 2 || busy !== null} onClick={() => void run("spread", () => actions.match(asset.id, "spread"))}
            title="Avvicina tutte le foto dello spread al loro aspetto medio. Sostituisce le correzioni già fatte su queste foto.">
            <Icon name="wand" size={14} /> {busy === "spread" ? "Calcolo…" : "Uniforma lo spread"}
          </button>
        </div>
        {photosInSpread < 2 ? <p className="small muted">Servono almeno due foto nello spread.</p> : null}
      </div>

      <div className="coloredit__group">
        <span className="coloredit__title">File originale</span>
        {!canWriteFile ? (
          <p className="small muted">Le correzioni si vedono nell'album e nell'esportazione. Per scriverle sul file serve l'app desktop e una foto JPG.</p>
        ) : confirming ? (
          <div className="coloredit__confirm" role="alertdialog" aria-label="Conferma: sovrascrivi la foto">
            <p className="small"><strong>Sovrascrivere {asset.fileName}?</strong> Le correzioni vengono scritte nel file sul disco e valgono anche fuori da Album Flow (gallerie online, stampa). Una copia dell'originale resta al sicuro nel programma e si può ripristinare da qui.</p>
            <div className="coloredit__row">
              <button type="button" className="btn btn--sm btn--primary" disabled={busy !== null} onClick={() => void save()}>{busy === "save" ? "Scrivo…" : "Sì, sovrascrivi il file"}</button>
              <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => setConfirming(false)}>Annulla</button>
            </div>
          </div>
        ) : (
          <div className="coloredit__row">
            <button type="button" className="btn btn--sm" disabled={neutral || busy !== null} onClick={() => setConfirming(true)} title={neutral ? "Prima fai una correzione" : "Scrive le correzioni nel file JPG, dopo la tua conferma"}>
              <Icon name="check" size={14} /> Salva sul file…
            </button>
            {backup ? <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => void restore()} title="Rimette il file com'era prima della prima correzione scritta da Album Flow">{busy === "restore" ? "Ripristino…" : "Ripristina l'originale"}</button> : null}
          </div>
        )}
        <p className="small muted">Per ritocchi più profondi resta «Modifica nell'editor» (Photoshop): al ritorno la foto si aggiorna da sola.</p>
      </div>
      {note ? <p className="small coloredit__note" role="status">{note}</p> : null}
    </div>
  );
}
