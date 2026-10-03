import { useCallback, useEffect, useState } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import type { DesktopAlbumBackupVersion, DesktopGoogleDriveStatus } from "@photo-tools/desktop-contracts";
import { backupToDrive, downloadBackup, driveConnect, driveStatus, listBackups } from "../desktop/cloud";
import { Modal } from "./ui";

const when = (iso: string) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const megabytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Backup su Google Drive del solo progetto (impaginazione, testi, sfondi): mai le foto, che restano sui tuoi dischi.
 * Ripristinare apre sempre una COPIA dell'album: l'album di questo computer non viene mai sovrascritto.
 */
export function CloudDialog({ project, onOpenCopy, onClose }: {
  project: AlbumProjectV2;
  onOpenCopy: (copy: AlbumProjectV2) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<DesktopGoogleDriveStatus | null | "loading">("loading");
  const [versions, setVersions] = useState<DesktopAlbumBackupVersion[] | null>(null);
  const [allAlbums, setAllAlbums] = useState(false);
  const [busy, setBusy] = useState<null | "connect" | "save" | "list" | string>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const refresh = useCallback(async (everything: boolean) => {
    setBusy("list");
    try { setVersions(await listBackups(everything ? undefined : project.projectName)); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Impossibile leggere i backup.", error: true }); }
    finally { setBusy(null); }
  }, [project.projectName]);

  useEffect(() => {
    let alive = true;
    void driveStatus().then((value) => { if (alive) setStatus(value); }).catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (status && status !== "loading" && status.connected) void refresh(allAlbums); }, [status, allAlbums, refresh]);

  const connect = async () => {
    setBusy("connect");
    setMessage(null);
    try { setStatus(await driveConnect()); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Collegamento non riuscito.", error: true }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      const version = await backupToDrive(project);
      setMessage({ text: `Backup salvato su Drive (${megabytes(version.size)}): ${version.spreads ?? project.spreads.length} spread, ${version.photos ?? project.assets.length} foto citate. Le foto non sono state caricate.` });
      await refresh(allAlbums);
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Backup non riuscito.", error: true }); }
    finally { setBusy(null); }
  };

  const restore = async (version: DesktopAlbumBackupVersion) => {
    setBusy(version.id);
    setMessage(null);
    try {
      const downloaded = await downloadBackup(version.id);
      onOpenCopy(downloaded);
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Ripristino non riuscito.", error: true }); setBusy(null); }
  };

  const connected = status !== "loading" && status !== null && status.connected;

  return (
    <Modal title="Backup su Google Drive" subtitle="Solo il progetto: impaginazione, testi e sfondi. Le foto restano sui tuoi dischi." onClose={onClose} wide>
      <div className="cloud">
        {status === "loading" ? <p className="muted">Controllo il collegamento…</p> : null}
        {status === null ? <p className="cloud__note">Google Drive è disponibile solo nell'app desktop FileX.</p> : null}
        {status && status !== "loading" && !status.connected ? (
          <div className="cloud__connect">
            <p>{status.configured ? "Collega il tuo account Google: FileX vede solo i file che crea lui, non il resto del tuo Drive." : "Il collegamento a Google Drive non è configurato in questa versione."}</p>
            <button type="button" className="btn btn--primary" onClick={() => void connect()} disabled={busy === "connect" || !status.configured}>{busy === "connect" ? "Attendo il browser…" : status.requiresReconnect ? "Ricollega Google Drive" : "Collega Google Drive"}</button>
          </div>
        ) : null}

        {connected ? (
          <>
            <div className="cloud__bar">
              <span className="muted small">Account: {(status as DesktopGoogleDriveStatus).accountEmail ?? "collegato"}</span>
              <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy !== null}>{busy === "save" ? "Salvo…" : `Salva «${project.projectName}» su Drive`}</button>
            </div>
            <div className="cloud__head">
              <h3>{allAlbums ? "Backup di tutti gli album" : `Backup di «${project.projectName}»`}</h3>
              <label className="cloud__check"><input type="checkbox" checked={allAlbums} onChange={(event) => setAllAlbums(event.target.checked)} /> Mostra tutti gli album</label>
            </div>
            {versions === null ? <p className="muted">Leggo l'elenco…</p> : versions.length === 0 ? (
              <p className="muted">{allAlbums ? "Nessun backup su Drive." : "Questo album non ha ancora backup su Drive. Premi «Salva» per crearne uno."}</p>
            ) : (
              <ul className="cloud__list">
                {versions.map((version) => (
                  <li key={version.id}>
                    <div>
                      <strong>{when(version.createdAt)}</strong>
                      {allAlbums ? <span> · {version.projectName}</span> : null}
                      <small className="muted"> {version.spreads !== undefined ? `${version.spreads} spread` : ""}{version.photos !== undefined ? ` · ${version.photos} foto citate` : ""} · {megabytes(version.size)}</small>
                    </div>
                    <button type="button" className="btn btn--sm" onClick={() => void restore(version)} disabled={busy !== null} title="Apre una copia dell'album: quello di questo computer non viene toccato">{busy === version.id ? "Scarico…" : "Apri come copia"}</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">Dopo aver aperto una copia su un altro computer, se le foto non si trovano compare «Ricollega foto»: scegli la cartella dove stanno adesso.</p>
          </>
        ) : null}
        {message ? <p className={message.error ? "cloud__error" : "cloud__ok"} role={message.error ? "alert" : "status"}>{message.text}</p> : null}
      </div>
    </Modal>
  );
}
