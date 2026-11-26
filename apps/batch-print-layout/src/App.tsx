import { useEffect, useState } from "react";
import { Download, FilePlus2 } from "lucide-react";
import { countPrints, CUSTOMER_NAME_MAX } from "./order/model";
import { collectDroppedFiles, dragCarriesFiles } from "./lib/assets";
import { CropDialog } from "./ui/CropDialog";
import { ExportDialog } from "./ui/ExportDialog";
import { GroupList } from "./ui/GroupList";
import { GroupSettings } from "./ui/GroupSettings";
import { PhotoGrid } from "./ui/PhotoGrid";
import { StartScreen } from "./ui/StartScreen";
import { usePrintOrder } from "./ui/usePrintOrder";

export function App() {
  const api = usePrintOrder();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cropPhotoId, setCropPhotoId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [isDragging, setDragging] = useState(false);
  // Un lavoro salvato si riapre direttamente; altrimenti si parte dalla scelta iniziale.
  const [chosen, setChosen] = useState(false);
  const totalPhotos = api.order.groups.reduce((sum, group) => sum + group.photos.length, 0);
  const totalPrints = api.order.groups.reduce((sum, group) => sum + countPrints(group), 0);
  const started = chosen || totalPhotos > 0 || Boolean(api.order.customer) || Boolean(api.busy);

  const activeGroup = api.order.groups.find((group) => group.id === api.selectedGroupId) ?? api.order.groups[0];
  useEffect(() => setSelectedIds(new Set()), [activeGroup.id]);

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
    api.doRemovePhotos(activeGroup.id, [...selectedIds]);
    setSelectedIds(new Set());
  };

  const transfer = (toId: string, mode: "copy" | "move") => {
    api.doTransferPhotos(activeGroup.id, toId, [...selectedIds], mode);
    if (mode === "move") setSelectedIds(new Set());
  };

  const cropIndex = activeGroup.photos.findIndex((photo) => photo.id === cropPhotoId);
  const cropPhoto = cropIndex >= 0 ? activeGroup.photos[cropIndex] : null;
  const openAt = (index: number) => setCropPhotoId(activeGroup.photos[Math.min(activeGroup.photos.length - 1, Math.max(0, index))].id);

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
            selectedGroupId={activeGroup.id}
            onSelectGroup={(id) => api.setSelectedGroupId(id)}
            onAddGroup={() => api.doAddGroup()}
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
            <PhotoGrid
              group={activeGroup}
              allGroups={api.order.groups}
              thumbnails={api.thumbnails}
              logo={api.order.logo}
              logoUrl={api.logoPreviewUrl}
              selectedIds={selectedIds}
              busy={Boolean(api.busy)}
              onToggleSelect={toggle}
              onSelectAll={() => setSelectedIds(new Set(activeGroup.photos.map((photo) => photo.id)))}
              onClearSelection={() => setSelectedIds(new Set())}
              onOpenCrop={(photo) => setCropPhotoId(photo.id)}
              onAddFiles={api.addFilesFromInput}
              onAddFolder={api.addFolder}
              onRemoveSelected={removeSelected}
              onTransferSelected={transfer}
              onSetCopies={(photoId, copies) => api.doSetCopies(activeGroup.id, photoId, copies)}
            />
            {isDragging ? <div className="drop-overlay">Rilascia le foto in questo formato</div> : null}
          </main>
        </div>
      )}

      <footer className="statusbar">
        {api.busy ? <progress value={api.busy.done} max={api.busy.total || 1} aria-label="Importazione" /> : null}
        <span role="status" aria-live="polite">
          {api.busy ? `Importo le foto: ${api.busy.done} di ${api.busy.total}` : (started && api.statusMessage) || "Pronto."}
        </span>
        {started ? <span className="statusbar__totals">{totalPhotos} foto · {totalPrints} stampe · {api.order.groups.length} {api.order.groups.length === 1 ? "formato" : "formati"}</span> : null}
      </footer>

      {cropPhoto ? (
        <CropDialog
          group={activeGroup}
          photo={cropPhoto}
          url={api.thumbnails.urls.get(cropPhoto.sourceKey) ?? null}
          logo={api.order.logo}
          logoUrl={api.logoPreviewUrl}
          index={cropIndex + 1}
          total={activeGroup.photos.length}
          onClose={() => setCropPhotoId(null)}
          onPrev={() => openAt(cropIndex - 1)}
          onNext={() => openAt(cropIndex + 1)}
          onSetCrop={(crop) => api.doSetCrop(activeGroup.id, cropPhoto.id, crop)}
        />
      ) : null}

      {showExport ? (
        <ExportDialog order={api.order} thumbnails={api.thumbnails} onClose={() => setShowExport(false)} renderFile={api.renderFile} />
      ) : null}
    </div>
  );
}
