import { useEffect, useState } from "react";
import { Download, FilePlus2, History } from "lucide-react";
import { countPrints, CUSTOMER_NAME_MAX, STANDARD_FORMATS, type FormatTarget } from "./order/model";
import { collectDroppedFiles, dragCarriesFiles } from "./lib/assets";
import { CropDialog } from "./ui/CropDialog";
import { ExportDialog } from "./ui/ExportDialog";
import { GroupList } from "./ui/GroupList";
import { FormatSelect } from "./ui/FormatSelect";
import { GroupSettings } from "./ui/GroupSettings";
import { PhotoGrid, type PhotoEntry } from "./ui/PhotoGrid";
import { assessQuality } from "./order/quality";
import { StartScreen } from "./ui/StartScreen";
import { OrderHistory } from "./ui/OrderHistory";
import { chooseEditor } from "./ui/library";
import { usePrintOrder } from "./ui/usePrintOrder";

export function App() {
  const api = usePrintOrder();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cropPhotoId, setCropPhotoId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isDragging, setDragging] = useState(false);
  // Un lavoro salvato si riapre direttamente; altrimenti si parte dalla scelta iniziale.
  const [chosen, setChosen] = useState(false);
  const totalPhotos = api.order.groups.reduce((sum, group) => sum + group.photos.length, 0);
  const totalPrints = api.order.groups.reduce((sum, group) => sum + countPrints(group), 0);
  const started = chosen || totalPhotos > 0 || Boolean(api.order.customer) || Boolean(api.busy);

  const activeGroup = api.order.groups.find((group) => group.id === api.selectedGroupId) ?? api.order.groups[0];
  const [showAll, setShowAll] = useState(true);
  useEffect(() => setSelectedIds(new Set()), [activeGroup.id, showAll]);

  // In «Tutte le foto» l'ordine è per nome: cambiando formato una foto non salta altrove.
  const everyEntry: PhotoEntry[] = api.order.groups.flatMap((group) => group.photos.map((photo) => ({ group, photo })));
  const entries = showAll
    ? [...everyEntry].sort((a, b) => a.photo.fileName.localeCompare(b.photo.fileName, undefined, { numeric: true }) || a.photo.sourceKey.localeCompare(b.photo.sourceKey))
    : activeGroup.photos.map((photo) => ({ group: activeGroup, photo }));

  // Un file lasciato fuori dalla griglia non deve sostituire l'app con la sua immagine.
  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const [customerDraft, setCustomerDraft] = useState(api.order.customer?.name ?? "");
  useEffect(() => setCustomerDraft(api.order.customer?.name ?? ""), [api.order.customer?.name]);

  const start = (customerName: string) => {
    api.newOrder(customerName);
    setShowAll(true);
    setSelectedIds(new Set());
    setChosen(true);
  };

  const backToStart = () => {
    if (totalPhotos > 0 && !window.confirm("Chiudere questo lavoro e iniziarne un altro? Le foto e i ritagli di questo non saranno più disponibili.")) return;
    api.newOrder();
    setSelectedIds(new Set());
    setChosen(false);
  };

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const removeSelected = () => {
    if (selectedIds.size === 0 || !window.confirm(`Rimuovere ${selectedIds.size} foto?`)) return;
    for (const group of api.order.groups) {
      const ids = group.photos.filter((photo) => selectedIds.has(photo.id)).map((photo) => photo.id);
      if (ids.length > 0) api.doRemovePhotos(group.id, ids);
    }
    setSelectedIds(new Set());
  };

  const assign = (photoIds: string[], target: FormatTarget, mode: "move" | "add") => {
    api.doAssignPhotos(photoIds, target, mode);
    if (photoIds.length > 1) setSelectedIds(new Set());
  };

  const cropIndex = entries.findIndex((entry) => entry.photo.id === cropPhotoId);
  const cropEntry = cropIndex >= 0 ? entries[cropIndex] : null;
  const openAt = (index: number) => setCropPhotoId(entries[Math.min(entries.length - 1, Math.max(0, index))].photo.id);

  // Nella finestra di ritaglio: i formati già nel lavoro, poi i più comuni.
  const quickFormats = cropEntry
    ? [
        ...api.order.groups.map((group) => ({ key: group.id, label: group.format.label, active: group.id === cropEntry.group.id, target: { groupId: group.id } as FormatTarget })),
        ...STANDARD_FORMATS.filter((format) => !api.order.groups.some((group) => group.format.id === format.id))
          .map((format) => ({ key: format.id, label: format.label, active: false, target: { format } as FormatTarget })),
      ]
    : [];
  const changeFormatInDialog = (target: FormatTarget, mode: "move" | "add") => {
    if (!cropEntry) return;
    // Cambiando formato la foto resta davanti agli occhi: si passa alla vista che le contiene tutte.
    setShowAll(true);
    api.doAssignPhotos([cropEntry.photo.id], target, mode);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">PF</div>
        <div className="brand">
          <p className="eyebrow">FileX Suite</p>
          <h1>Print Flow</h1>
        </div>

        {started ? (
          <>
            <label className={`job ${api.order.customer ? "job--customer" : ""}`}>
              <span>{api.order.customer ? "Cliente" : "Lavoro veloce"}</span>
              <input
                value={customerDraft}
                maxLength={CUSTOMER_NAME_MAX}
                placeholder="Aggiungi il nome del cliente"
                onChange={(event) => setCustomerDraft(event.target.value)}
                onBlur={() => api.setCustomerName(customerDraft)}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              />
            </label>
            <div className="topbar__actions">
              <button type="button" className="btn" onClick={() => setShowHistory(true)}>
                <History size={16} /> Cronologia
              </button>
              <button type="button" className="btn" onClick={backToStart} disabled={Boolean(api.busy)}>
                <FilePlus2 size={16} /> Nuovo lavoro
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setShowExport(true)} disabled={Boolean(api.busy) || totalPhotos === 0}>
                <Download size={16} /> Esporta
              </button>
            </div>
          </>
        ) : null}
      </header>

      {!started ? (
        <StartScreen onCustomerOrder={start} onQuickJob={() => start("")} />
      ) : (
        <div className="workspace">
          <GroupList
            order={api.order}
            selectedGroupId={showAll ? null : activeGroup.id}
            onSelectAll={() => setShowAll(true)}
            onSelectGroup={(id) => { api.setSelectedGroupId(id); setShowAll(false); }}
            onAddGroup={() => { api.doAddGroup(); setShowAll(false); }}
            onRemoveGroup={api.doRemoveGroup}
          />

          <main
            className="stage"
            onDragOver={(event) => {
              if (!dragCarriesFiles(event.dataTransfer)) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={async (event) => {
              event.preventDefault();
              setDragging(false);
              const files = await collectDroppedFiles(event.dataTransfer);
              if (files.length > 0) await api.addFilesFromInput(files);
            }}
          >
            {showAll ? (
              <section className="settings">
                <div className="settings__row">
                  <label className="field">
                    <span>Le foto che aggiungi entrano in</span>
                    <select className="field__format" value={activeGroup.id} onChange={(event) => api.setSelectedGroupId(event.target.value)}>
                      {api.order.groups.map((group) => <option key={group.id} value={group.id}>{group.format.label}</option>)}
                    </select>
                  </label>
                  <p className="hint settings__hint">Poi scegli il formato sotto ogni foto, oppure selezionane più d'una. Bordino e logo si regolano aprendo il formato a sinistra.</p>
                </div>
              </section>
            ) : (
            <GroupSettings
              key={activeGroup.id}
              group={activeGroup}
              logoUrl={api.logoPreviewUrl}
              logoSettings={api.order.logo}
              onUpdateGroup={(patch) => api.doUpdateGroup(activeGroup.id, patch)}
              onChooseLogo={api.chooseLogo}
              onRemoveLogo={api.removeLogo}
              onUpdateLogoSettings={api.updateLogoSettings}
              onSetLogoFile={api.setLogoFile}
            />
            )}
            <PhotoGrid
              entries={entries}
              intoLabel={activeGroup.format.label}
              allGroups={api.order.groups}
              thumbnails={api.thumbnails}
              logo={api.order.logo}
              logoUrl={api.logoPreviewUrl}
              selectedIds={selectedIds}
              busy={Boolean(api.busy)}
              onToggleSelect={toggle}
              onSelectAll={() => setSelectedIds(new Set(entries.map((entry) => entry.photo.id)))}
              onClearSelection={() => setSelectedIds(new Set())}
              onOpenCrop={(photo) => setCropPhotoId(photo.id)}
              onAddFiles={api.addFilesFromInput}
              onAddFolder={api.addFolder}
              onRemoveSelected={removeSelected}
              onAssign={assign}
              onSetCopies={api.doSetCopies}
              onEdit={api.editInPhotoshop}
            />
            {isDragging ? <div className="drop-overlay">Rilascia le foto in {activeGroup.format.label}</div> : null}
          </main>
        </div>
      )}

      <footer className="statusbar">
        {api.busy ? <progress value={api.busy.done} max={api.busy.total || 1} aria-label="Importazione" /> : null}
        <span role="status" aria-live="polite">
          {api.busy ? `Importo le foto: ${api.busy.done} di ${api.busy.total}` : (started && api.statusMessage) || "Pronto."}
        </span>
        {started ? <span className="statusbar__totals">{totalPhotos} foto · {totalPrints} {totalPrints === 1 ? "stampa" : "stampe"} · {api.order.groups.length} {api.order.groups.length === 1 ? "formato" : "formati"}</span> : null}
      </footer>

      {cropEntry ? (
        <CropDialog
          group={cropEntry.group}
          photo={cropEntry.photo}
          url={api.thumbnails.urls.get(cropEntry.photo.sourceKey) ?? null}
          logo={api.order.logo}
          logoUrl={api.logoPreviewUrl}
          index={cropIndex + 1}
          total={entries.length}
          onClose={() => setCropPhotoId(null)}
          onPrev={() => openAt(cropIndex - 1)}
          onNext={() => openAt(cropIndex + 1)}
          onSetCrop={(crop) => api.doSetCrop(cropEntry.group.id, cropEntry.photo.id, crop)}
          onEdit={window.filexDesktop ? () => void api.editInPhotoshop(cropEntry.photo) : undefined}
          onUseSavedFile={window.filexDesktop ? () => void api.useSavedFile(cropEntry.photo) : undefined}
          onChangeEditor={window.filexDesktop ? () => void chooseEditor() : undefined}
          formatBar={(
            <div className="cropper__formats" role="group" aria-label="Formato di questa foto">
              <span>Formato di questa foto</span>
              {quickFormats.map((item) => {
                // Il pallino dice come verrebbe la foto in quel formato, prima di sceglierlo.
                const group = "format" in item.target
                  ? { ...cropEntry.group, format: item.target.format }
                  : api.order.groups.find((candidate) => candidate.id === item.key)!;
                const quality = assessQuality(group, item.active ? cropEntry.photo : { ...cropEntry.photo, crop: undefined });
                return (
                  <button key={item.key} type="button" className="chip" aria-pressed={item.active} title={`${quality.score}/100 · ${quality.verdict} · taglio ${quality.cutPercent}%`} onClick={() => { if (!item.active) changeFormatInDialog(item.target, "move"); }}>
                    <span className={`dot dot--${quality.level}`} aria-hidden="true" /> {item.label}
                  </button>
                );
              })}
              <FormatSelect groups={api.order.groups} label="Altro formato o seconda stampa" placeholder="Altro o doppia stampa…" onAssign={changeFormatInDialog} />
            </div>
          )}
        />
      ) : null}

      {showHistory ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Cronologia dei lavori" onClick={(event) => { if (event.target === event.currentTarget) setShowHistory(false); }}>
          <div className="modal modal--wide">
            <h2>Cronologia dei lavori</h2>
            <OrderHistory />
            <div className="modal__actions">
              <button type="button" className="btn" autoFocus onClick={() => setShowHistory(false)}>Chiudi</button>
            </div>
          </div>
        </div>
      ) : null}

      {showExport ? (
        <ExportDialog order={api.order} thumbnails={api.thumbnails} onClose={() => setShowExport(false)} renderFile={api.renderFile} />
      ) : null}
    </div>
  );
}
