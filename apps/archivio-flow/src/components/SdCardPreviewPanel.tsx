import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterPreviewData, SafeToFormatResult, Job } from "../types";
import { checkArchivioSafeToFormat, getArchivioFilterPreview, listPhotoToolInstallStates, openFileXSuite, sendArchivioPhotoSelectionToTool } from "../archivioDesktopApi";
import { DateFilterPicker } from "./DateFilterPicker";
import { FilterRangePickerModal } from "./FilterRangePickerModal";
import { localTimestamp, selectImportRange, type ImportSelection } from "../importSelection";
import { SdLightbox } from "./SdLightbox";
import { localIsoDate } from "../previewPolicy";
import { PHOTO_TOOL_TARGETS, isPhotoToolCompatible, validatePhotoToolSelection, type PhotoToolTargetId } from "../photoToolRouting";
import { groupSdFiles, orderSdFiles, type SdFile } from "../sdBrowserModel";
import { SdVirtualGrid } from "./SdVirtualGrid";

interface Props { sdPath: string | null; sourceIdentity?: string; jobs: Job[]; onStartImport: (selection: ImportSelection, jobId?: string | null) => void; }

export function SdCardPreviewPanel({ sdPath, sourceIdentity, onStartImport }: Props) {
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
          setFiles(data.sampleFiles);
          timer = setTimeout(() => { void read(); }, 250);
          return;
        }
        if (offset && data.inventoryRevision !== stableRevision) throw new Error("La sessione di lettura è cambiata. Aggiorna la scheda prima di continuare.");
        stableRevision = data.inventoryRevision;
        completeFiles = [...completeFiles, ...data.sampleFiles];
        setFiles(completeFiles);
        if (data.nextSampleOffset != null) { offset = data.nextSampleOffset; timer = setTimeout(() => { void read(); }, 0); }
        else setReading(false);
      } catch (reason) { if (active) { setError(String(reason)); setReading(false); } }
    }
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [sdPath, revision, session]);

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
  function selectFiles(paths: string[]) {
    const next = new Set([...selected, ...paths]);
    if (next.size > 50_000) { setFeedback("Puoi importare fino a 50.000 file alla volta. Restringi la selezione per data o gruppo."); return; }
    setSelected(next); setFeedback(null);
  }
  function selectOne(path: string, shift: boolean, ordered: string[]) {
    if (sending) return;
    const next = selectImportRange(selected, ordered, anchor.current, path, shift && complete);
    if (next.size > 50_000) { setFeedback("Limite di 50.000 file per importazione."); return; }
    setSelected(next); setFeedback(null);
    if (!shift || !anchor.current || !ordered.includes(anchor.current)) anchor.current = path;
  }
  function chooseDate(value: string) { setDate(value); setRange({ from: "", to: "" }); setGroupFilter(null); }
  function applyRange(start: number, end: number) { setRange({ from: localTimestamp(Math.floor(start)), to: localTimestamp(Math.ceil(end)) }); setDate(""); setGroupFilter(null); setShowRangePicker(false); }
  function importFiles(paths: string[]) {
    if (!paths.length || !complete) return;
    if (paths.length > 50_000) { setFeedback("Seleziona al massimo 50.000 file per importazione."); return; }
    const first = paths.reduce((min, path) => Math.min(min, fileMap.get(path)?.mtimeMs ?? Infinity), Infinity);
    onStartImport({ sourceIdentity: sourceIdentity || session, selectedFilePaths: paths, suggestedJobDate: Number.isFinite(first) ? localIsoDate(first) : undefined, suggestedFiles: paths.flatMap(path => fileMap.get(path) ?? []), sourceSummary: inventory ? { totalFiles: inventory.matchedFiles, rawFiles: inventory.matchedRawFiles, jpgFiles: inventory.matchedJpgFiles, videoFiles: inventory.matchedVideoFiles, otherFiles: inventory.matchedOtherFiles } : undefined });
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
    <section className="panel-section">
      <header className="sd-browser-header">
        <div><strong>{sdPath ? `Scheda SD · ${sdPath}` : "In attesa di una scheda"}</strong><div role="status">{reading ? `Lettura in corso · ${files.length.toLocaleString("it-IT")} file disponibili · conteggi provvisori` : inventory ? `${inventory.matchedFiles.toLocaleString("it-IT")} file sulla scheda` : "Inserisci una SD per iniziare."}</div></div>
        <div className="button-row"><button className="ghost-button" onClick={() => setRevision(value => value + 1)} disabled={!sdPath || Boolean(sending)}>Aggiorna scheda</button><button className="secondary-button" onClick={() => { void verifySd(); }} disabled={!sdPath || checkingSafe || reading}>{checkingSafe ? "Verifica…" : "Verifica SD"}</button></div>
      </header>
      {sdPath && <>
        <div className="sd-browser-layout">
          <nav className="sd-browser-dates" aria-label="Date sulla scheda"><strong>Date {reading ? "· provvisorie" : ""}</strong><button className={!date && !groupFilter && !range.from && !range.to ? "primary-button" : "ghost-button"} onClick={() => chooseDate("")}>Tutte · {files.length.toLocaleString("it-IT")}</button>{dates.map(([day,count]) => <button key={day} className={date === day ? "primary-button" : "ghost-button"} onClick={() => chooseDate(day)}>{new Date(`${day}T12:00`).toLocaleDateString("it-IT")} · {count.toLocaleString("it-IT")}</button>)}</nav>
          <div className="sd-browser-main">
            <div className="sd-browser-controls"><span>{visible.length.toLocaleString("it-IT")} file {activeGroup ? "nel gruppo" : date ? "nella data" : "nella vista"}</span><button className="ghost-button" disabled={!complete || !visible.length || Boolean(sending)} onClick={() => selectFiles(visible.map(file => file.filePath))}>{activeGroup ? "Seleziona questo gruppo" : date ? "Seleziona tutta questa data" : "Seleziona tutta la vista"}</button><details onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>Intervallo e gruppi</summary>
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
            <SdVirtualGrid files={displayFiles} selected={selected} session={sourceIdentity || session} sdPath={sdPath} filterKey={filterKey} onSelect={selectOne} onOpen={file => setLightboxPath(file.filePath)} />
          </div>
        </div>
        <footer className="sd-browser-actions"><div className="button-row"><strong aria-live="polite">{selected.size.toLocaleString("it-IT")} selezionati{outside > 0 ? ` · ${outside} fuori vista` : ""}</strong><button className="ghost-button" disabled={Boolean(sending) || !selected.size} onClick={() => { setSelected(new Set()); anchor.current = null; }}>Deseleziona</button><button className="primary-button" disabled={!complete || !selected.size || Boolean(sending)} onClick={() => importFiles([...selected])}>Importa selezionati</button>
          {PHOTO_TOOL_TARGETS.map(target => { const validation = validatePhotoToolSelection(target.id, selected.size); return <button key={target.id} className="secondary-button" disabled={!complete || Boolean(sending) || incompatible || !validation.valid} title={incompatible ? "La selezione contiene RAW, video o file non compatibili con i tool." : !validation.valid ? validation.message : toolStates[target.id] === false ? "Apri FileX Suite per installare il tool" : `Apri ${target.label}`} onClick={() => { void sendToTool(target.id); }}>{sending === target.id ? "Apertura…" : target.label}{toolStates[target.id] === false ? " · Da installare" : ""}</button>; })}
        </div><small>{reading ? "Puoi selezionare singole foto; selezione completa e Maiusc saranno disponibili al termine della lettura." : "Più recenti prima · Clic per selezionare · Maiusc + clic per un intervallo · La selezione resta cambiando data."} {incompatible ? "Tool: seleziona foto compatibili, escludendo RAW e video." : "Party Frame e Batch Layout: massimo 500 foto. Photo ID: una foto."}</small>{feedback && <p role="status">{feedback}</p>}{error && <p role="alert">{error}</p>}</footer>
      </>}
    </section>
    {sdPath && <details className="import-advanced-panel"><summary>Sicurezza e impostazioni SD</summary><div className="stack" style={{ padding: "1rem 0" }}><div><strong>Sicurezza formattazione</strong><p>{checkingSafe ? "Verifica in corso…" : safeCheck?.status === "SAFE" ? `Tutti i ${safeCheck.totalFiles} file risultano verificati nell’archivio.` : safeCheck ? `${safeCheck.verifiedFiles}/${safeCheck.totalFiles} file verificati. ${safeCheck.reason ?? "Non formattare la SD."}` : "Usa Verifica SD per controllare i file realmente archiviati prima di formattare."}</p></div><button className="secondary-button" disabled={!complete || Boolean(sending)} onClick={() => onStartImport({})}>Importa tutta la SD</button><div><strong>Apertura di Esplora risorse</strong><p>In AutoPlay di Windows puoi scegliere “Nessuna azione”.</p><a className="secondary-button" href="ms-settings:autoplay" target="_blank" rel="noreferrer">Apri impostazioni AutoPlay</a></div><div><strong>Avvio con Windows</strong><p>Puoi attivarlo o disattivarlo nella schermata Impostazioni.</p></div></div></details>}
    <FilterRangePickerModal sourceIdentity={sourceIdentity || session} open={showRangePicker} sdPath={sdPath ?? ""} samples={visible} importedRanges={[]} truncated={reading} onClose={() => setShowRangePicker(false)} onApplyRange={applyRange} />
    {lightboxIndex >= 0 && <SdLightbox sourceIdentity={sourceIdentity || session} files={lightboxPhotos} index={lightboxIndex} onIndexChange={index => setLightboxPath(lightboxPhotos[index]!.filePath)} onClose={() => setLightboxPath(null)} />}
  </div>;
}
