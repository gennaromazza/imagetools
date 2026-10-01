import { useCallback, useEffect, useRef, useState } from "react";
import type { AlbumProjectV2, AlbumStage } from "@photo-tools/shared-types";
import { hasDesktop } from "./desktop/api";
import { Home } from "./components/Home";
import type { NewAlbumResult } from "./components/NewAlbumDialog";
import { Workspace } from "./components/Workspace";
import { pushRecentFormat } from "./model/formats";
import { parseAlbumProject } from "./model/portability";
import { createEmptyProject, nowIso, touch } from "./model/project";
import { newId } from "./model/ids";
import { useLicenseNotice } from "./hooks/useLicense";
import {
  createDemoProject, loadActiveProjectId, loadProjects, mergeIncomingProject, projectFromHandoff, saveActiveProjectId, saveProjects,
} from "./model/store";
import { browserWriter, chooseDesktopWriter, exportProjectFile } from "./render/export";

const WAITING = "In attesa di una selezione da Image Select Pro.";

export function App() {
  const [initial] = useState(() => loadProjects());
  const [projects, setProjects] = useState<AlbumProjectV2[]>(initial.projects);
  /** All'avvio si può riaprire l'ultimo album oppure partire sempre dalla Home (predefinito). */
  const [reopenLast, setReopenLast] = useState(() => { try { return localStorage.getItem("filex.albumFlow.reopenLast") === "1"; } catch { return false; } });
  const changeReopenLast = (on: boolean) => { setReopenLast(on); try { localStorage.setItem("filex.albumFlow.reopenLast", on ? "1" : "0"); } catch { /* preferenza non salvata */ } };
  const [activeId, setActiveId] = useState<string | null>(() => {
    const stored = reopenLast ? loadActiveProjectId() : null;
    return stored && initial.projects.some((project) => project.projectId === stored) ? stored : null;
  });
  /** Cambia quando un progetto viene sostituito dall'esterno (nuovo invio dal Selector): rimonta l'editor. */
  const [revision, setRevision] = useState(0);
  const [banner, setBanner] = useState(WAITING);
  const [saveFailed, setSaveFailed] = useState(false);
  const projectInput = useRef<HTMLInputElement>(null);
  const license = useLicenseNotice();

  useEffect(() => { setSaveFailed(!saveProjects(projects)); }, [projects]);
  useEffect(() => { saveActiveProjectId(activeId); }, [activeId]);

  const active = projects.find((project) => project.projectId === activeId) ?? null;

  const upsert = useCallback((project: AlbumProjectV2, external: boolean) => {
    setProjects((current) => {
      const exists = current.some((item) => item.projectId === project.projectId);
      return exists ? current.map((item) => (item.projectId === project.projectId ? project : item)) : [project, ...current];
    });
    if (external) setRevision((value) => value + 1);
  }, []);

  const onWorkspaceChange = useCallback((project: AlbumProjectV2) => upsert(project, false), [upsert]);

  // Passaggio da Image Select Pro / Archivio Flow tramite l'app desktop.
  useEffect(() => {
    const api = window.filexDesktop;
    if (!api?.consumePendingOpenProjectPath || !api.consumePhotoSelectionHandoff || !api.markOpenProjectRequestReady || !api.onOpenProjectRequest) return;
    let alive = true;

    const consume = async (path: string) => {
      try {
        const handoff = await api.consumePhotoSelectionHandoff!(path);
        if (alive && handoff) {
          const incoming = projectFromHandoff(handoff);
          setProjects((current) => {
            const previous = current.find((item) => item.projectId === incoming.projectId);
            const merged = mergeIncomingProject(previous, incoming);
            return previous ? current.map((item) => (item.projectId === merged.projectId ? merged : item)) : [merged, ...current];
          });
          setRevision((value) => value + 1);
          setActiveId(incoming.projectId);
          setBanner(`${incoming.assets.length} foto ricevute da ${handoff.albumFlow?.sourceToolId === "archivio-flow" ? "Archivio Flow" : "Image Select Pro"}.`);
        }
      } catch (error) {
        if (alive) setBanner(error instanceof Error ? error.message : "Importazione dal Selector non riuscita.");
      } finally {
        await api.acknowledgeOpenProjectRequest?.(path).catch(() => undefined);
      }
    };
    const drain = async () => { const path = await api.consumePendingOpenProjectPath!(); if (path) await consume(path); };
    const remove = api.onOpenProjectRequest(() => { void drain(); });
    void api.markOpenProjectRequestReady().then(drain);
    return () => { alive = false; remove(); };
  }, []);

  const create = (result: NewAlbumResult) => {
    const project = createEmptyProject(result.name, result.sheet, result.style);
    pushRecentFormat({ widthCm: result.sheet.widthCm, heightCm: result.sheet.heightCm });
    upsert(project, true);
    setActiveId(project.projectId);
  };

  const demo = () => {
    const project = createDemoProject();
    upsert(project, true);
    setActiveId(project.projectId);
  };

  const duplicate = (projectId: string) => {
    const source = projects.find((project) => project.projectId === projectId);
    if (!source) return;
    const copy: AlbumProjectV2 = { ...structuredClone(source), projectId: newId("album"), projectName: `${source.projectName} (copia)`, createdAt: nowIso(), updatedAt: nowIso() };
    setProjects((current) => [copy, ...current]);
  };

  const remove = (projectId: string) => {
    setProjects((current) => current.filter((project) => project.projectId !== projectId));
    if (activeId === projectId) setActiveId(null);
  };

  const setStage = (projectId: string, stage: AlbumStage) => {
    setProjects((current) => current.map((project) => (project.projectId === projectId && project.stage !== stage ? touch({ ...project, stage }) : project)));
  };

  const exportProject = async (projectId: string) => {
    const project = projects.find((candidate) => candidate.projectId === projectId);
    if (!project) return;
    try {
      const writer = hasDesktop() ? await chooseDesktopWriter() : browserWriter();
      if (!writer) return;
      await exportProjectFile(project, writer);
      setBanner(`Progetto «${project.projectName}» salvato (${writer.where()}).`);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Impossibile salvare il progetto.");
    }
  };

  const importProjectFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const project = parseAlbumProject(await file.text());
      upsert(project, true);
      setActiveId(project.projectId);
      setBanner(`Progetto «${project.projectName}» aperto.`);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Impossibile aprire il progetto.");
    }
  };

  return (
    <div className="album-app">
      {license ? <div className={`license-notice license-notice--${license.level}`} role={license.level === "error" ? "alert" : "status"}>{license.text}</div> : null}
      {active ? (
        <Workspace key={`${active.projectId}:${revision}`} initial={active} onChange={onWorkspaceChange} onExit={() => setActiveId(null)} />
      ) : (
        <Home
          projects={projects}
          banner={saveFailed ? "Spazio di salvataggio locale esaurito: salva i progetti importanti in un file." : banner}
          legacy={initial.legacy}
          skipped={initial.skipped}
          onOpen={setActiveId}
          reopenLast={reopenLast}
          onReopenLast={changeReopenLast}
          onCreate={create}
          onDelete={remove}
          onDuplicate={duplicate}
          onStage={setStage}
          onExportProject={(id) => void exportProject(id)}
          onImportProject={() => projectInput.current?.click()}
          onDemo={demo}
        />
      )}
      <input ref={projectInput} type="file" accept=".json,application/json" hidden data-testid="project-input" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void importProjectFile(file); }} />
    </div>
  );
}
