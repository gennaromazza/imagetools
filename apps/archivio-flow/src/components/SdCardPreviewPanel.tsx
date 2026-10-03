import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterPreviewData, ImportResult, SafeToFormatResult, Job, SdCard } from "../types";
import { checkArchivioSafeToFormat, getArchivioFilterPreview, getArchivioPreflight, listPhotoToolInstallStates, openFileXSuite, sendArchivioPhotoSelectionToTool } from "../archivioDesktopApi";
import { DateFilterPicker } from "./DateFilterPicker";
import { FilterRangePickerModal } from "./FilterRangePickerModal";
import { localTimestamp, selectImportRange, type ImportSelection } from "../importSelection";
import { SdLightbox } from "./SdLightbox";
import { localIsoDate } from "../previewPolicy";
import { describeArchivedNote, describeCardStatus, shouldShowShiftTip, summarizeArchived } from "../wizardModel";
import { PHOTO_TOOL_TARGETS, isPhotoToolCompatible, validatePhotoToolSelection, type PhotoToolTargetId } from "../photoToolRouting";
import { groupSdFiles, mediaCount, mediaOnly, orderSdFiles, quickSelections, sameSdFileList, type QuickSelection, type SdFile } from "../sdBrowserModel";
import { SdVirtualGrid } from "./SdVirtualGrid";
import { ImportStepper } from "./ImportStepper";
import { ResumeBanner } from "./ResumeBanner";
import { CardChooser } from "./CardChooser";
import { RecentImports } from "./RecentImports";

interface Props { sdPath: string | null; sourceIdentity?: string; jobs: Job[]; onStartImport: (selection: ImportSelection, jobId?: string | null) => void; onResumed?: (result: ImportResult) => void; cards?: SdCard[]; onChooseCard?: (path: string) => void; }

export function SdCardPreviewPanel({ sdPath, sourceIdentity, jobs, onStartImport, onResumed, cards, onChooseCard }: Props) {
  const [revision, setRevision] = useState(0);
  const session = useMemo(() => crypto.randomUUID(), [sdPath, revision, sourceIdentity]);
  const [files, setFiles] = useState<SdFile[]>([]);
  const [inventory, setInventory] = useState<FilterPreviewData | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [date, setDate] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [groupLimit, setGroupLimit] = useState(40);
  const [showRangePicker, setShowRangePicker] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [splitBefore, setSplitBefore] = useState<Set<string>>(() => new Set());
  const [joinedBefore, setJoinedBefore] = useState<Set<string>>(() => new Set());
  const [gapHours, setGapHours] = useState(() => { const value = Number(localStorage.getItem("filex.archivio-flow.import-gap-hours")); return value >= .01 && value <= 168 ? value : 6; });
  const [safeCheck, setSafeCheck] = useState<SafeToFormatResult | null>(null);
  const [checkingSafe, setCheckingSafe] = useState(false);
  const [sending, setSending] = useState<PhotoToolTargetId | null>(null);
  const [toolStates, setToolStates] = useState<Record<string, boolean>>({});
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [archived, setArchived] = useState<Map<string, { jobName: string | null; size: number }>>(() => new Map());
  const [archivedChecking, setArchivedChecking] = useState(false);
  const [shiftUsed, setShiftUsed] = useState(() => { try { return window.localStorage.getItem("filex.archivio-flow.shift-tip-used") === "1"; } catch { return false; } });
  const anchor = useRef<string | null>(null);
  const generation = useRef(0);
  const filterKey = JSON.stringify([date, range, groupFilter, revision, sdPath]);
  useEffect(() => { localStorage.setItem("filex.archivio-flow.import-gap-hours", String(gapHours)); }, [gapHours]);
  useEffect(() => { anchor.current = null; }, [filterKey]);
  useEffect(() => {
    let active = true;
    void listPhotoToolInstallStates().then(states => { if (active) setToolStates(Object.fromEntries(states.map(state => [state.toolId, state.installed]))); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inventorySession = session;
    setFiles([]); setInventory(null); setSelected(new Set()); setError(null); setFeedback(null);
    setDate(""); setRange({ from: "", to: "" }); setGroupFilter(null);
    setSplitBefore(new Set()); setJoinedBefore(new Set()); setSafeCheck(null);
    setLightboxPath(null); setShowRangePicker(false); setSending(null); setCheckingSafe(false); anchor.current = null;
    setReading(Boolean(sdPath));
    if (!sdPath) return () => { active = false; };
    let completeFiles: SdFile[] = [];
    let offset = 0;
    let stableRevision: string | undefined;
    async function read() {
      try {
        const data = await getArchivioFilterPreview({ sdPath: sdPath!, inventorySession, maxSamples: 5000, sampleOffset: offset });
        if (!active || generation.current !== current) return;
        if (data.inventoryComplete === undefined || !data.inventoryRevision) throw new Error("Riavvia la versione aggiornata di Archivio Flow per usare il nuovo caricamento SD.");
        setInventory(data);
        if (!data.inventoryComplete) {
          // Provisional pages are replaced: discovery can change their sort order.
          // Stessa pagina di prima: niente nuovo array, niente ordinamenti e ridisegni inutili durante la lettura.
          const media = mediaOnly(data.sampleFiles);
          setFiles(previous => sameSdFileList(previous, media) ? previous : media);
          timer = setTimeout(() => { void read(); }, 250);
          return;
        }
        if (offset && data.inventoryRevision !== stableRevision) throw new Error("La scheda è cambiata durante la lettura. Premi «Rileggi la scheda» e riprova.");
        stableRevision = data.inventoryRevision;
        completeFiles = [...completeFiles, ...mediaOnly(data.sampleFiles)];
        setFiles(completeFiles);
        if (data.nextSampleOffset != null) { offset = data.nextSampleOffset; timer = setTimeout(() => { void read(); }, 0); }
        else setReading(false);
      } catch (reason) { if (active) { setError(String(reason)); setReading(false); } }
    }
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [sdPath, revision, session]);

  // A lettura finita si chiede all'archivio quali foto sono gia' state salvate (anche in un altro lavoro).
  // Le dimensioni sconosciute non richiedono nessuna lettura dalla scheda: su una scheda nuova e' istantaneo.
  useEffect(() => {
    setArchived(new Map());
    if (!sdPath || reading || !inventory?.inventoryComplete || error) { setArchivedChecking(false); return; }
    let active = true;
    const sizeByPath = new Map(files.map(file => [file.filePath, file.size]));
    const paths = files.map(file => file.filePath);
    setArchivedChecking(paths.length > 0);
    void (async () => {
      const found = new Map<string, { jobName: string | null; size: number }>();
      try {
        for (let offset = 0; offset < paths.length && active; offset += 400) {
          const result = await getArchivioPreflight({ sdPath, filePaths: paths.slice(offset, offset + 400) });
          for (const entry of result.archived) found.set(entry.filePath, { jobName: entry.jobName, size: sizeByPath.get(entry.filePath) ?? 0 });
          if (active && result.archived.length > 0) setArchived(new Map(found));
        }
      } catch { /* il controllo e' un aiuto: se non riesce, la griglia resta com'e' */ }
      if (active) setArchivedChecking(false);
    })();
    return () => { active = false; };
  }, [sdPath, reading, inventory?.inventoryComplete, error, session]);

  const fileMap = useMemo(() => new Map(files.map(file => [file.filePath, file])), [files]);
  const dates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files) { const key = localIsoDate(file.mtimeMs); counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts].sort(([a],[b]) => b.localeCompare(a));
  }, [files]);
  const groups = useMemo(() => groupSdFiles(files, gapHours, splitBefore, joinedBefore), [files, gapHours, splitBefore, joinedBefore]);
  const activeGroup = groups.find(group => group.files[0]?.filePath === groupFilter);
  const validRange = (!range.from || Number.isFinite(Date.parse(range.from))) && (!range.to || Number.isFinite(Date.parse(range.to))) && (!range.from || !range.to || Date.parse(range.from) <= Date.parse(range.to));
  const visible = useMemo(() => validRange ? (activeGroup?.files ?? files).filter(file => (!date || localIsoDate(file.mtimeMs) === date) && (!range.from || file.mtimeMs >= Date.parse(range.from)) && (!range.to || file.mtimeMs <= Date.parse(range.to))) : [], [files, activeGroup, date, range, validRange]);
  const visibleSet = useMemo(() => new Set(visible.map(file => file.filePath)), [visible]);
  const selectedFiles = useMemo(() => [...selected].flatMap(path => fileMap.get(path) ?? []), [selected, fileMap]);
  const outside = useMemo(() => [...selected].filter(path => !visibleSet.has(path)).length, [selected, visibleSet]);
  const incompatible = selectedFiles.some(file => !isPhotoToolCompatible(file));
  const displayFiles = useMemo(() => orderSdFiles(visible), [visible]);
  const lightboxPhotos = useMemo(() => displayFiles.filter(file => file.mediaType === "photo"), [displayFiles]);
  const lightboxIndex = lightboxPhotos.findIndex(file => file.filePath === lightboxPath);
  const complete = !reading && Boolean(inventory?.inventoryComplete) && !error;
  const archivedPaths = useMemo(() => new Set(archived.keys()), [archived]);
  const quick = useMemo(() => complete ? quickSelections(files, new Date(), 100, archivedPaths) : [], [complete, files, archivedPaths]);
  const cardStatus = useMemo(
    () => complete && !archivedChecking ? describeCardStatus(files.length, summarizeArchived([...archived].map(([filePath, value]) => ({ filePath, ...value })), null)) : null,
    [complete, archivedChecking, files.length, archived],
  );
  const archivedLabels = useMemo(() => new Map([...archived].map(([path, info]) => [path, info.jobName ? `Già in «${info.jobName}»` : "Già in archivio"])), [archived]);
  function applyQuick(choice: QuickSelection) {
    if (sending) return;
    if (choice.paths.length > 50_000) { setFeedback("Puoi importare fino a 50.000 file alla volta. Scegli un giorno o un gruppo."); return; }
    setSelected(new Set(choice.paths)); setFeedback(null); anchor.current = null;
    if (choice.day) { setDate(choice.day); setRange({ from: "", to: "" }); setGroupFilter(null); } else chooseDate("");
  }
  function selectFiles(paths: string[]) {
    const next = new Set([...selected, ...paths]);
    if (next.size > 50_000) { setFeedback("Puoi importare fino a 50.000 file alla volta. Restringi la selezione per data o gruppo."); return; }
    setSelected(next); setFeedback(null);
  }
  function selectOne(path: string, shift: boolean, ordered: string[]) {
    if (sending) return;
    if (shift && complete && !shiftUsed) { setShiftUsed(true); try { window.localStorage.setItem("filex.archivio-flow.shift-tip-used", "1"); } catch { /* il suggerimento tornera' */ } }
    const next = selectImportRange(selected, ordered, anchor.current, path, shift && complete);
    if (next.size > 50_000) { setFeedback("Limite di 50.000 file per importazione."); return; }
    setSelected(next); setFeedback(null);
    if (!shift || !anchor.current || !ordered.includes(anchor.current)) anchor.current = path;
  }
  function chooseDate(value: string) { setDate(value); setRange({ from: "", to: "" }); setGroupFilter(null); }
  function applyRange(start: number, end: number) { setRange({ from: localTimestamp(Math.floor(start)), to: localTimestamp(Math.ceil(end)) }); setDate(""); setGroupFilter(null); setShowRangePicker(false); }
  function archivedFor(paths: readonly string[]) {
    return paths.flatMap(path => { const info = archived.get(path); return info ? [{ filePath: path, jobName: info.jobName, size: info.size }] : []; });
  }
  function importAll() {
    onStartImport({ sourceIdentity: sourceIdentity || session, selectedBytes: files.reduce((total, file) => total + file.size, 0), archived: archivedFor(files.map(file => file.filePath)) });
  }
  function importFiles(paths: string[]) {
    if (!paths.length || !complete) return;
    if (paths.length > 50_000) { setFeedback("Seleziona al massimo 50.000 file per importazione."); return; }
    const first = paths.reduce((min, path) => Math.min(min, fileMap.get(path)?.mtimeMs ?? Infinity), Infinity);
    onStartImport({ sourceIdentity: sourceIdentity || session, selectedFilePaths: paths, suggestedJobDate: Number.isFinite(first) ? localIsoDate(first) : undefined, suggestedFiles: paths.flatMap(path => fileMap.get(path) ?? []), selectedBytes: paths.reduce((total, path) => total + (fileMap.get(path)?.size ?? 0), 0), archived: archivedFor(paths), sourceSummary: inventory ? { totalFiles: inventory.matchedFiles, rawFiles: inventory.matchedRawFiles, jpgFiles: inventory.matchedJpgFiles, videoFiles: inventory.matchedVideoFiles, otherFiles: inventory.matchedOtherFiles } : undefined });
  }
  async function verifySd() {
    if (!sdPath) return;
    const current = generation.current;
    setCheckingSafe(true);
    try { const result = await checkArchivioSafeToFormat(sdPath); if (generation.current === current) setSafeCheck(result); }
    catch (reason) { if (generation.current === current) setFeedback(String(reason)); }
    finally { if (generation.current === current) setCheckingSafe(false); }
  }
  async function sendToTool(target: PhotoToolTargetId) {
    if (!sdPath || !complete || sending || incompatible || !validatePhotoToolSelection(target, selected.size).valid) return;
    const current = generation.current;
    setSending(target);
    try {
      if (toolStates[target] === false) {
        const result = await openFileXSuite();
        if (generation.current === current) setFeedback(result.ok ? "FileX Suite aperta: installa il tool per inviare le foto." : "Apri FileX Suite per installare il tool.");
      } else {
        const result = await sendArchivioPhotoSelectionToTool({ targetToolId: target, sourceRoot: sdPath, absolutePaths: [...selected] });
        if (generation.current === current) setFeedback(result.message || (result.ok ? "Foto inviate al tool." : "Invio non riuscito."));
      }
    } catch (reason) { if (generation.current === current) setFeedback(String(reason)); }
    finally { if (generation.current === current) setSending(null); }
  }
  return <div className="stack sd-browser">
    <ImportStepper current={1} />
    {sdPath && onResumed && <ResumeBanner sdPath={sdPath} jobs={jobs} onFinished={onResumed} />}
    {cards && onChooseCard && <CardChooser cards={cards} activePath={sdPath} onChoose={onChooseCard} />}
    <section className="panel-section">
      <header className="sd-browser-header">
        <div><strong>{sdPath ? `Scheda SD · ${sdPath}` : "Inserisci la scheda SD"}</strong><div role="status">{reading ? `Sto leggendo la scheda… ${files.length.toLocaleString("it-IT")} file trovati finora` : inventory ? `${mediaCount(inventory).toLocaleString("it-IT")} foto e video sulla scheda. Clicca quelli che vuoi importare.` : "Inserisci la scheda nel computer: la riconosco da sola."}</div></div>
        <div className="button-row"><button className="ghost-button" onClick={() => setRevision(value => value + 1)} disabled={!sdPath || Boolean(sending)}>Rileggi la scheda</button><button className="ghost-button" onClick={() => { void verifySd(); }} disabled={!sdPath || checkingSafe || reading} title="Facoltativo: controlla che ogni foto della scheda sia già salvata in archivio">{checkingSafe ? "Controllo…" : "Controlla che sia tutto salvato"}</button></div>
      </header>
      {sdPath && <>
        <div className="sd-browser-layout">
          <nav className="sd-browser-dates" aria-label="Date sulla scheda"><strong>Giorni {reading ? "(in aggiornamento)" : ""}</strong><button className={!date && !groupFilter && !range.from && !range.to ? "primary-button" : "ghost-button"} onClick={() => chooseDate("")}>Tutti i giorni · {files.length.toLocaleString("it-IT")}</button>{dates.map(([day,count]) => <button key={day} className={date === day ? "primary-button" : "ghost-button"} onClick={() => chooseDate(day)}>{new Date(`${day}T12:00`).toLocaleDateString("it-IT")} · {count.toLocaleString("it-IT")}</button>)}</nav>
          <div className="sd-browser-main">
            <div className="sd-browser-controls"><span>{visible.length.toLocaleString("it-IT")} foto {activeGroup ? "in questo gruppo" : date ? "in questo giorno" : "da guardare"}</span><button className="ghost-button" disabled={!complete || !visible.length || Boolean(sending)} onClick={() => selectFiles(visible.map(file => file.filePath))}>{activeGroup ? "Scegli tutto il gruppo" : date ? "Scegli tutto il giorno" : "Scegli tutte"}</button><details onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>Altri modi per scegliere (orari, gruppi)</summary>
              {advancedOpen && <div className="sd-browser-options">
                <div className="inline-grid inline-grid--2"><DateFilterPicker label="Da" value={range.from} boundary="start" onChange={from => { setRange(value => ({ ...value, from })); setDate(""); setGroupFilter(null); }} /><DateFilterPicker label="A" value={range.to} boundary="end" onChange={to => { setRange(value => ({ ...value, to })); setDate(""); setGroupFilter(null); }} /></div>
                {!validRange && <p role="alert">L’inizio deve precedere la fine dell’intervallo.</p>}
                <button className="secondary-button" disabled={!complete || !visible.length} onClick={() => setShowRangePicker(true)}>Scegli inizio e fine dalle foto</button>
                <label className="field"><span>Nuovo gruppo dopo una pausa di almeno (ore)</span><input type="number" min="0.01" max="168" step="0.5" value={gapHours} onChange={event => { const value = event.target.valueAsNumber; if (value >= .01 && value <= 168) { setGapHours(value); setGroupFilter(null); } }} /></label>
                <small>Gli orari di modifica suggeriscono i gruppi, anche oltre mezzanotte. Conferma tu gli eventi.</small>
                <div className="sd-browser-groups">{groups.slice(0, groupLimit).map((group,index) => <div key={group.files[0]!.filePath}><span>Gruppo {index + 1} · {group.files.length} file · {new Date(group.startMs).toLocaleString("it-IT")} → {new Date(group.endMs).toLocaleString("it-IT")}</span><div className="button-row"><button className="secondary-button" onClick={() => { setGroupFilter(group.files[0]!.filePath); setDate(""); setRange({ from: "", to: "" }); }}>Mostra</button><button className="ghost-button" disabled={!complete || Boolean(sending)} onClick={() => selectFiles(group.files.map(file => file.filePath))}>Seleziona gruppo</button>{index > 0 && <button className="ghost-button" disabled={!complete} onClick={() => { const path = group.files[0]!.filePath; setJoinedBefore(value => new Set([...value, path])); setSplitBefore(value => { const next = new Set(value); next.delete(path); return next; }); setGroupFilter(null); }}>Unisci al precedente</button>}</div></div>)}</div>{groups.length > groupLimit && <button className="ghost-button" onClick={() => setGroupLimit(value => value + 40)}>Mostra altri gruppi ({groupLimit}/{groups.length})</button>}
                <div className="button-row"><button className="secondary-button" disabled={!complete || selected.size !== 1} onClick={() => { setSplitBefore(value => new Set([...value, [...selected][0]!])); setGroupFilter(null); }}>Dividi prima della foto selezionata</button><button className="ghost-button" onClick={() => { setSplitBefore(new Set()); setJoinedBefore(new Set()); setGroupFilter(null); }}>Ripristina gruppi automatici</button></div>
              </div>}
            </details></div>
            {cardStatus && <div className={`card-status card-status--${cardStatus.level}`} role="status"><span>{cardStatus.text}</span>{cardStatus.level !== "all" && quick.some(choice => choice.id === "new") && <button type="button" className="secondary-button" onClick={() => applyQuick(quick.find(choice => choice.id === "new")!)}>Scegli solo le nuove</button>}</div>}
            {(quick.length > 1 || archivedChecking || archived.size > 0) && <div className="sd-quick" role="group" aria-label="Scelte rapide"><span>Scegli in fretta:</span>{quick.map(choice => <button key={choice.id} type="button" className={`wizard-chip${selected.size === choice.paths.length && choice.paths.every(path => selected.has(path)) ? " is-active" : ""}`} onClick={() => applyQuick(choice)} disabled={Boolean(sending)}>{choice.label}</button>)}{archivedChecking && <span className="sd-quick__note">Controllo quali foto hai già salvato…</span>}{!archivedChecking && archived.size > 0 && <span className="sd-quick__note">{(() => { const info = summarizeArchived([...archived].map(([filePath, value]) => ({ filePath, ...value })), null); return info ? describeArchivedNote(info) : ""; })()}</span>}</div>}
            {shouldShowShiftTip(selected.size, shiftUsed) && <p className="sd-browser-tip" role="note">💡 Per sceglierne molte di fila: tieni premuto <kbd>Maiusc</kbd> e clicca l’ultima foto dell’intervallo.</p>}
            <p className="sd-browser-hint">{reading ? "Puoi già scegliere qualche foto; per sceglierne molte di fila aspetta la fine della lettura." : "Clicca una foto per sceglierla. Tieni premuto Maiusc e clicca un’altra foto per sceglierne molte di fila. La scelta resta anche cambiando giorno."}{incompatible ? " Per gli altri programmi servono foto JPG: i RAW e i video non sono compatibili." : ""}</p>
            <SdVirtualGrid files={displayFiles} archivedLabels={archivedLabels} selected={selected} session={sourceIdentity || session} sdPath={sdPath} filterKey={filterKey} onSelect={selectOne} onOpen={file => setLightboxPath(file.filePath)} />
          </div>
        </div>
        <footer className="sd-browser-actions"><div className="sd-browser-actions__row"><strong aria-live="polite">{selected.size === 0 ? "Nessuna foto scelta" : selected.size === 1 ? "1 foto scelta" : `${selected.size.toLocaleString("it-IT")} foto scelte`}{outside > 0 ? ` (${outside} in altri giorni)` : ""}</strong><div className="button-row"><button className="ghost-button" disabled={Boolean(sending) || !selected.size} onClick={() => { setSelected(new Set()); anchor.current = null; }}>Svuota la scelta</button><button className="primary-button" disabled={!complete || !selected.size || Boolean(sending)} onClick={() => importFiles([...selected])}>Continua →</button></div></div>{feedback && <p role="status">{feedback}</p>}{error && <p role="alert">{error}</p>}</footer>
      </>}
    </section>
    {!sdPath && <RecentImports jobs={jobs} />}
    {sdPath && <RecentImports jobs={jobs} collapsed />}
    {sdPath && <details className="import-advanced-panel"><summary>Altre opzioni</summary><div className="stack" style={{ padding: "1rem 0" }}><div><strong>Usare le foto in un altro programma</strong><p>Serve una selezione di foto JPG: i RAW e i video non sono compatibili.</p><div className="button-row">          {PHOTO_TOOL_TARGETS.map(target => { const validation = validatePhotoToolSelection(target.id, selected.size); return <button key={target.id} className="secondary-button" disabled={!complete || Boolean(sending) || incompatible || !validation.valid} title={incompatible ? "La selezione contiene RAW, video o file non compatibili con i tool." : !validation.valid ? validation.message : toolStates[target.id] === false ? "Apri FileX Suite per installare il tool" : `Apri ${target.label}`} onClick={() => { void sendToTool(target.id); }}>{sending === target.id ? "Apertura…" : target.label}{toolStates[target.id] === false ? " · Da installare" : ""}</button>; })}</div></div><div><strong>Tutto salvato in archivio?</strong><p>{checkingSafe ? "Verifica in corso…" : safeCheck?.status === "SAFE" ? `Tutti i ${safeCheck.totalFiles} file risultano verificati nell’archivio.` : safeCheck ? `${safeCheck.verifiedFiles}/${safeCheck.totalFiles} file verificati. ${safeCheck.reason ?? "Non formattare la SD."}` : "Premi «Controlla che sia tutto salvato» per verificare che ogni foto della scheda sia già in archivio. È facoltativo."}</p></div><button className="secondary-button" disabled={!complete || Boolean(sending)} onClick={importAll}>Importa tutta la scheda</button><div><strong>Apertura di Esplora risorse</strong><p>In AutoPlay di Windows puoi scegliere “Nessuna azione”.</p><a className="secondary-button" href="ms-settings:autoplay" target="_blank" rel="noreferrer">Apri impostazioni AutoPlay</a></div><div><strong>Avvio con Windows</strong><p>Puoi attivarlo o disattivarlo nella schermata Impostazioni.</p></div></div></details>}
    <FilterRangePickerModal sourceIdentity={sourceIdentity || session} open={showRangePicker} sdPath={sdPath ?? ""} samples={visible} importedRanges={[]} truncated={reading} onClose={() => setShowRangePicker(false)} onApplyRange={applyRange} />
    {lightboxIndex >= 0 && <SdLightbox sdPath={sdPath ?? undefined} sourceIdentity={sourceIdentity || session} files={lightboxPhotos} index={lightboxIndex} onIndexChange={index => setLightboxPath(lightboxPhotos[index]!.filePath)} onClose={() => setLightboxPath(null)} />}
  </div>;
}
