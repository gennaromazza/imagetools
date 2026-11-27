import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import {
  albumFingerprint, closeSaveTargets, decideOpen, decideSave, fileStatus, loadFileLinks, removeFileLink, setFileLink, type FileLink, type FileStatus,
} from "../model/fileLink";
import { restoreEmbeddedMedia } from "../model/mediaStore";
import { readEmbeddedMedia } from "../model/portability";
import { canLinkFiles, joinFilePath, pathOfPickedFile, readProjectFile, statProjectFile, writeProjectFile } from "../desktop/projectFile";
import { chooseDesktopWriter, existingNamesIn, safeFileName } from "../render/export";

/** Le domande della finestra di sincronizzazione e le risposte possibili. */
export type FileSyncAsk = "exit" | "overwrite" | "replace" | "load" | "load-losing";
export type FileSyncChoice = "save" | "discard" | "overwrite" | "load" | "keep" | "cancel";

export interface FileSyncQuestion { kind: FileSyncAsk; name: string; answer: (choice: FileSyncChoice) => void }

interface Deps {
  projectsRef: MutableRefObject<AlbumProjectV2[]>;
  active: AlbumProjectV2 | null;
  upsert: (project: AlbumProjectV2, external: boolean) => void;
  open: (projectId: string) => void;
  setBanner: (text: string) => void;
}

const UNREACHABLE_KEEP = "File non raggiungibile: l'album resta salvato su questo PC.";
const SAVED = "Salvato sul file.";

/**
 * Album collegati a un file su disco (per lavorare da due PC): stato, «Salva sul file», domande all'apertura e all'uscita,
 * salvataggio alla chiusura del programma. Senza app desktop non fa nulla.
 */
export function useFileSync({ projectsRef, active, upsert, open, setBanner }: Deps) {
  const enabled = useMemo(() => canLinkFiles(), []);
  const [links, setLinks] = useState<Record<string, FileLink>>(() => (enabled ? loadFileLinks() : {}));
  const linksRef = useRef(links);
  linksRef.current = links;
  const [stamps, setStamps] = useState<Record<string, string | null>>({});
  const [question, setQuestion] = useState<FileSyncQuestion | null>(null);
  const [fingerprint, setFingerprint] = useState<{ id: string; hash: string } | null>(null);

  // Una domanda alla volta: se ne arriva un'altra (per esempio Ctrl/⌘+S con la domanda di uscita aperta), la prima vale «Annulla».
  const pendingAnswer = useRef<((choice: FileSyncChoice) => void) | null>(null);
  const ask = useCallback((kind: FileSyncAsk, name: string) => new Promise<FileSyncChoice>((resolve) => {
    pendingAnswer.current?.("cancel");
    const answer = (choice: FileSyncChoice) => {
      if (pendingAnswer.current !== answer) return;
      pendingAnswer.current = null;
      setQuestion(null);
      resolve(choice);
    };
    pendingAnswer.current = answer;
    setQuestion({ kind, name, answer });
  }), []);

  const remember = useCallback((projectId: string, link: FileLink) => {
    setFileLink(projectId, link);
    setLinks((current) => ({ ...current, [projectId]: link }));
    setStamps((current) => ({ ...current, [projectId]: link.stamp }));
  }, []);

  const forget = useCallback((projectId: string) => {
    removeFileLink(projectId);
    setLinks((current) => { const next = { ...current }; delete next[projectId]; return next; });
  }, []);

  const refreshStamp = useCallback(async (projectId: string): Promise<string | null> => {
    const link = linksRef.current[projectId];
    if (!link) return null;
    const stamp = await statProjectFile(link.path);
    setStamps((current) => ({ ...current, [projectId]: stamp }));
    return stamp;
  }, []);

  // Impronta dell'album aperto: subito quando si apre, poi con un breve ritardo dopo le modifiche (mai a ogni gesto).
  const activeId = active?.projectId ?? null;
  const linked = activeId !== null && Boolean(links[activeId]);
  useEffect(() => {
    if (!enabled || !active || !linked) return;
    const compute = () => setFingerprint({ id: active.projectId, hash: albumFingerprint(active) });
    if (fingerprint?.id !== active.projectId) { compute(); return; }
    const timer = setTimeout(compute, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fingerprint` serve solo a capire se l'album è cambiato.
  }, [enabled, active, linked]);
  useEffect(() => { if (enabled && activeId && linked) void refreshStamp(activeId); }, [enabled, activeId, linked, refreshStamp]);

  let status: FileStatus | "unlinked" | undefined;
  if (enabled && active) {
    const link = links[active.projectId];
    if (!link) status = "unlinked";
    else {
      const hash = fingerprint?.id === active.projectId ? fingerprint.hash : link.savedHash;
      status = fileStatus(link, active.projectId in stamps ? stamps[active.projectId] : link.stamp, hash);
    }
  }

  /** Carica l'album dal file (sostituisce quello di questo PC) e aggiorna il collegamento. */
  const loadFrom = useCallback(async (path: string, read?: Awaited<ReturnType<typeof readProjectFile>>) => {
    const file = read ?? await readProjectFile(path);
    await restoreEmbeddedMedia(readEmbeddedMedia(file.raw));
    upsert(file.project, true);
    remember(file.project.projectId, { path, stamp: file.stamp, savedHash: albumFingerprint(file.project) });
    setFingerprint({ id: file.project.projectId, hash: albumFingerprint(file.project) });
    return file.project;
  }, [remember, upsert]);

  /** «Tieni questa»: resta l'album di questo PC, il file resta collegato e risulta diverso (quindi da salvare). */
  const keepLocal = useCallback((projectId: string, path: string, read: Awaited<ReturnType<typeof readProjectFile>>) => {
    remember(projectId, { path, stamp: read.stamp, savedHash: albumFingerprint(read.project) });
  }, [remember]);

  /** «Apri progetto…» con l'app desktop. Restituisce false se il file non ha un percorso (si usa il percorso di prima). */
  const openPicked = useCallback(async (file: File): Promise<boolean> => {
    const path = enabled ? pathOfPickedFile(file) : null;
    if (!path) return false;
    try {
      const read = await readProjectFile(path);
      const id = read.project.projectId;
      const local = projectsRef.current.find((project) => project.projectId === id) ?? null;
      const link = linksRef.current[id];
      const sameFile = link && link.path.toLocaleLowerCase() === path.toLocaleLowerCase() ? link : undefined;
      const decision = decideOpen(local ? { fingerprint: albumFingerprint(local) } : null, sameFile, read.stamp, albumFingerprint(read.project));
      let choice: FileSyncChoice = decision === "keep" ? "keep" : "load";
      if (decision === "ask-load" || decision === "ask-load-losing") choice = await ask(decision === "ask-load" ? "load" : "load-losing", read.project.projectName);
      if (choice === "cancel") return true;
      if (choice === "load") await loadFrom(path, read);
      else keepLocal(id, path, read);
      open(id);
      setBanner(`Progetto «${read.project.projectName}» aperto e collegato al file.`);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Impossibile aprire il progetto.");
    }
    return true;
  }, [ask, enabled, keepLocal, loadFrom, open, projectsRef, setBanner]);

  /** Apertura dalla Home: se un altro PC ha salvato una versione più nuova, lo dice e chiede. */
  const openFromHome = useCallback(async (projectId: string) => {
    const link = enabled ? linksRef.current[projectId] : undefined;
    const local = projectsRef.current.find((project) => project.projectId === projectId);
    if (!link || !local) { open(projectId); return; }
    const stamp = await refreshStamp(projectId);
    if (stamp === null) { setBanner("File dell'album non raggiungibile: si apre la versione di questo PC."); open(projectId); return; }
    const decision = decideOpen({ fingerprint: albumFingerprint(local) }, link, stamp);
    if (decision === "keep" || decision === "load") { open(projectId); return; }
    const choice = await ask(decision === "ask-load" ? "load" : "load-losing", local.projectName);
    if (choice === "cancel") return;
    try {
      const read = await readProjectFile(link.path);
      if (read.project.projectId !== projectId) throw new Error("Il file collegato ora contiene un altro album: si apre la versione di questo PC.");
      if (choice === "load") await loadFrom(link.path, read);
      else keepLocal(projectId, link.path, read);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : UNREACHABLE_KEEP);
    }
    open(projectId);
  }, [ask, enabled, keepLocal, loadFrom, open, projectsRef, refreshStamp, setBanner]);

  /** «Salva sul file». Restituisce il messaggio da mostrare, o null se l'utente ha annullato. */
  const save = useCallback(async (projectId: string): Promise<string | null> => {
    const project = projectsRef.current.find((candidate) => candidate.projectId === projectId);
    if (!project || !enabled) return null;
    let path = linksRef.current[projectId]?.path;
    try {
      if (!path) {
        const writer = await chooseDesktopWriter();
        if (!writer) return null;
        const fileName = `${safeFileName(project.projectName)}.filex-album.json`;
        if ((await existingNamesIn(writer.directory, [fileName])).length > 0 && (await ask("replace", fileName)) !== "overwrite") return null;
        path = joinFilePath(writer.directory, fileName);
      } else {
        const link = linksRef.current[projectId]!;
        const stamp = await refreshStamp(projectId);
        const decision = decideSave(link, stamp);
        if (decision === "unreachable") return UNREACHABLE_KEEP;
        if (decision === "ask-overwrite") {
          const choice = await ask("overwrite", project.projectName);
          if (choice === "load") { await loadFrom(link.path); return "Caricata la versione salvata dall'altro PC."; }
          if (choice !== "overwrite") return null;
        }
      }
      const stamp = await writeProjectFile(project, path);
      const hash = albumFingerprint(project);
      remember(projectId, { path, stamp, savedHash: hash });
      setFingerprint({ id: projectId, hash });
      return SAVED;
    } catch (error) {
      return error instanceof Error ? error.message : UNREACHABLE_KEEP;
    }
  }, [ask, enabled, loadFrom, projectsRef, refreshStamp, remember]);

  /** Uscita dall'album: con modifiche non salvate sul file chiede. Restituisce false se si resta nell'album. */
  const confirmExit = useCallback(async (projectId: string): Promise<boolean> => {
    const link = enabled ? linksRef.current[projectId] : undefined;
    const project = projectsRef.current.find((candidate) => candidate.projectId === projectId);
    if (!link || !project || albumFingerprint(project) === link.savedHash) return true;
    const choice = await ask("exit", project.projectName);
    if (choice === "cancel") return false;
    if (choice === "discard") return true;
    const message = await save(projectId);
    if (message === null) return false;
    // Se non si è potuto salvare (file non raggiungibile) si esce lo stesso: l'album resta su questo PC e la Home lo dice.
    if (message !== SAVED) setBanner(message);
    return true;
  }, [ask, enabled, projectsRef, save, setBanner]);

  /** Album collegati con modifiche non salvate sul file (calcolo sincrono, per `beforeunload`). */
  const hasUnsavedLinked = useCallback(() => {
    if (!enabled) return false;
    return projectsRef.current.some((project) => { const link = linksRef.current[project.projectId]; return link !== undefined && albumFingerprint(project) !== link.savedHash; });
  }, [enabled, projectsRef]);

  /** Chiusura del programma (non si può chiedere): salva sul file solo se l'altro PC non l'ha cambiato. Non lancia mai. */
  const saveOnClose = useCallback(async (deadline: number): Promise<void> => {
    if (!enabled) return;
    const current = linksRef.current;
    const changed = projectsRef.current.filter((project) => { const link = current[project.projectId]; return link !== undefined && albumFingerprint(project) !== link.savedHash; });
    // Il controllo «cambiato altrove?» si fa subito prima di ogni scrittura, non tutto all'inizio: la finestra resta minima.
    for (const project of changed) {
      if (Date.now() > deadline - 1500) return;
      const link = current[project.projectId];
      const fresh = { [project.projectId]: await statProjectFile(link.path) };
      if (closeSaveTargets([project], current, fresh).length === 0) continue;
      const left = deadline - Date.now();
      if (left < 1500) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const stamp = await Promise.race([
          writeProjectFile(project, link.path),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("tempo scaduto")), left); }),
        ]);
        setFileLink(project.projectId, { path: link.path, stamp, savedHash: albumFingerprint(project) });
      } catch { /* resta su questo PC: alla riapertura lo stato lo segnala */ } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }, [enabled, projectsRef]);

  /** Dopo «Esporta → Salva progetto»: il file diventa il collegamento solo se l'album non ne ha già uno. */
  const linkExported = useCallback(async (project: AlbumProjectV2, path: string | null) => {
    if (!enabled || !path || linksRef.current[project.projectId]) return;
    const stamp = await statProjectFile(path);
    if (stamp) remember(project.projectId, { path, stamp, savedHash: albumFingerprint(project) });
  }, [enabled, remember]);

  return { enabled, status, question, openPicked, openFromHome, save, confirmExit, hasUnsavedLinked, saveOnClose, linkExported, forget };
}
