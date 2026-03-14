import { useEffect, useMemo, useState, useTransition } from "react";
import {
  changePageTemplate,
  clearSlotAssignment,
  createAutoLayoutPlan,
  createPage,
  moveImageBetweenSlots,
  placeImageInSlot,
  removePage,
  updateSlotAssignment
} from "@photo-tools/core";
import { DEFAULT_AUTO_LAYOUT_REQUEST, SHEET_PRESETS } from "@photo-tools/presets";
import type {
  AutoLayoutRequest,
  AutoLayoutResult,
  FitMode,
  LayoutMove,
  PlanningMode,
  RenderJob
} from "@photo-tools/shared-types";
import { AUTO_LAYOUT_SECTIONS, TOOL_NAVIGATION } from "@photo-tools/ui-schema";
import { AssignmentInspector } from "./components/AssignmentInspector";
import { InputPanel } from "./components/InputPanel";
import { LayoutPreviewBoard } from "./components/LayoutPreviewBoard";
import { OutputPanel } from "./components/OutputPanel";
import { PanelSection } from "./components/PanelSection";
import { ResultPanel } from "./components/ResultPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { inferFolderLabelFromFiles, loadImageAssetsFromFiles } from "./browser-image-assets";
import { mockWeddingAssets } from "./mock/wedding-selection";
import { exportSheets } from "./sheet-renderer";

type AppScreen = "setup" | "studio";

interface DragState {
  kind: "asset" | "slot";
  imageId: string;
  sourcePageId?: string;
  sourceSlotId?: string;
}

function buildInitialRequest(): AutoLayoutRequest {
  return {
    ...DEFAULT_AUTO_LAYOUT_REQUEST,
    assets: mockWeddingAssets,
    output: { ...DEFAULT_AUTO_LAYOUT_REQUEST.output },
    sheet: { ...DEFAULT_AUTO_LAYOUT_REQUEST.sheet }
  };
}

function buildRenderQueue(request: AutoLayoutRequest, result: AutoLayoutResult): RenderJob[] {
  return result.pages.map((page) => ({
    pageId: page.id,
    outputPath: `${request.output.folderPath}/${request.output.fileNamePattern.replace("{index}", String(page.pageNumber))}.${request.output.format}`,
    format: request.output.format
  }));
}

function syncResultRequest(current: AutoLayoutResult, nextRequest: AutoLayoutRequest): AutoLayoutResult {
  return {
    ...current,
    request: nextRequest,
    renderQueue: buildRenderQueue(nextRequest, current)
  };
}

export function App() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>("setup");
  const [request, setRequest] = useState<AutoLayoutRequest>(() => buildInitialRequest());
  const [result, setResult] = useState<AutoLayoutResult>(() => createAutoLayoutPlan(buildInitialRequest()));
  const [selectedPageId, setSelectedPageId] = useState<string | null>("page-1");
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>("page-1:hero");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [usesMockData, setUsesMockData] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [outputDirectoryHandle, setOutputDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [activityLog, setActivityLog] = useState<string[]>([
    "Campione reale matrimonio caricato.",
    "Studio pronto: prima imposta il progetto, poi rifinisci i layout."
  ]);
  const [isPlanningPending, startPlanningTransition] = useTransition();
  const [isEditingPending, startEditingTransition] = useTransition();

  useEffect(() => {
    if (!result.pages.find((page) => page.id === selectedPageId)) {
      const nextPage = result.pages[0];
      setSelectedPageId(nextPage?.id ?? null);
      setSelectedSlotKey(nextPage?.slotDefinitions[0] ? `${nextPage.id}:${nextPage.slotDefinitions[0].id}` : null);
    }
  }, [result, selectedPageId]);

  useEffect(() => {
    if (!selectedSlotKey) {
      return;
    }

    const [pageId, slotId] = selectedSlotKey.split(":");
    const page = result.pages.find((item) => item.id === pageId);
    const slotExists = page?.slotDefinitions.some((slot) => slot.id === slotId);

    if (!slotExists) {
      setSelectedSlotKey(null);
    }
  }, [result, selectedSlotKey]);

  const sections = Object.fromEntries(AUTO_LAYOUT_SECTIONS.map((section) => [section.id, section]));
  const assetsById = useMemo(
    () => new Map(result.request.assets.map((asset) => [asset.id, asset] as const)),
    [result.request.assets]
  );
  const usageByAssetId = useMemo(
    () =>
      new Map(
        result.pages.flatMap((page) =>
          page.assignments.map((assignment) => [
            assignment.imageId,
            { pageId: page.id, pageNumber: page.pageNumber, slotId: assignment.slotId }
          ] as const)
        )
      ),
    [result.pages]
  );
  const selectedPage = result.pages.find((page) => page.id === selectedPageId) ?? null;
  const selectedSlotId = selectedSlotKey?.split(":")[1] ?? null;
  const selectedSlot = selectedPage?.slotDefinitions.find((slot) => slot.id === selectedSlotId);
  const selectedAssignment = selectedPage?.assignments.find((assignment) => assignment.slotId === selectedSlotId);
  const selectedAsset = selectedAssignment ? assetsById.get(selectedAssignment.imageId) : undefined;
  const supportsDirectoryPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const usedImagesCount = result.summary.totalImages - result.unassignedAssets.length;
  const canOpenStudio = result.pages.length > 0 && request.assets.length > 0;

  function pushActivity(entry: string) {
    setActivityLog((current) => [entry, ...current].slice(0, 12));
  }

  function applyPlanningRequest(nextRequest: AutoLayoutRequest) {
    startPlanningTransition(() => {
      setRequest(nextRequest);
      setResult(createAutoLayoutPlan(nextRequest));
      setExportMessage(null);
    });
  }

  function updateOutput(field: "folderPath" | "fileNamePattern" | "quality" | "format", value: string | number) {
    const nextRequest = {
      ...request,
      output: {
        ...request.output,
        [field]: value
      }
    };

    setRequest(nextRequest);
    setResult((current) => syncResultRequest(current, nextRequest));
  }

  function handleSheetPresetChange(presetId: string) {
    const preset = SHEET_PRESETS.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    applyPlanningRequest({
      ...request,
      sheet: {
        ...request.sheet,
        presetId: preset.id,
        label: preset.label,
        widthCm: preset.widthCm,
        heightCm: preset.heightCm
      }
    });
  }

  function handleSheetFieldChange(field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi", value: number) {
    const isDimensionField = field === "widthCm" || field === "heightCm";

    applyPlanningRequest({
      ...request,
      sheet: {
        ...request.sheet,
        [field]: value,
        presetId: isDimensionField ? "custom" : request.sheet.presetId,
        label: isDimensionField ? "Personalizzato" : request.sheet.label
      }
    });
  }

  function handleFitModeChange(value: FitMode) {
    applyPlanningRequest({ ...request, fitMode: value });
  }

  function handlePlanningModeChange(value: PlanningMode) {
    applyPlanningRequest({ ...request, planningMode: value });
  }

  function handleDesiredSheetCountChange(value: number) {
    applyPlanningRequest({ ...request, desiredSheetCount: value });
  }

  function handleMaxPhotosPerSheetChange(value: number) {
    applyPlanningRequest({ ...request, maxPhotosPerSheet: value });
  }

  function handleAllowTemplateVariationChange(value: boolean) {
    applyPlanningRequest({ ...request, allowTemplateVariation: value });
  }

  function handleDrop(move: LayoutMove) {
    startEditingTransition(() => {
      setResult((current) => moveImageBetweenSlots(current, move));
    });
    setDragState(null);
    pushActivity(`Foto scambiata tra ${move.sourcePageId}:${move.sourceSlotId} e ${move.targetPageId}:${move.targetSlotId}.`);
  }

  function handleAssetDropped(pageId: string, slotId: string, imageId: string) {
    startEditingTransition(() => {
      setResult((current) =>
        placeImageInSlot(current, { imageId, targetPageId: pageId, targetSlotId: slotId })
      );
    });
    setDragState(null);
    setSelectedPageId(pageId);
    setSelectedSlotKey(`${pageId}:${slotId}`);
    pushActivity(`Foto assegnata manualmente allo slot ${pageId}:${slotId}.`);
  }

  function handleTemplateChange(pageId: string, templateId: string) {
    startEditingTransition(() => {
      setResult((current) => changePageTemplate(current, { pageId, templateId }));
    });
    pushActivity(`Template aggiornato sul foglio ${pageId}.`);
  }

  function handleRemovePage(pageId: string) {
    startEditingTransition(() => {
      setResult((current) => removePage(current, { pageId }));
    });
    pushActivity(`Foglio ${pageId} rimosso. Le sue foto sono tornate disponibili.`);
  }

  function handleCreatePageFromUnused() {
    startEditingTransition(() => {
      setResult((current) => createPage(current));
    });
    pushActivity("Nuovo foglio creato a partire dalle foto non usate.");
  }

  function handleDropToUnused() {
    if (!dragState) {
      return;
    }

    const usage = usageByAssetId.get(dragState.imageId);
    if (!usage) {
      setDragState(null);
      return;
    }

    startEditingTransition(() => {
      setResult((current) =>
        clearSlotAssignment(current, {
          pageId: usage.pageId,
          slotId: usage.slotId
        })
      );
    });
    setDragState(null);
    pushActivity(`Foto rimossa dal foglio ${usage.pageNumber} e riportata tra le non usate.`);
  }

  async function handlePickOutputFolder() {
    if (!supportsDirectoryPicker) {
      return;
    }

    const picker = window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };

    try {
      const directoryHandle = await picker.showDirectoryPicker?.();
      if (!directoryHandle) {
        return;
      }

      setOutputDirectoryHandle(directoryHandle);
      updateOutput("folderPath", directoryHandle.name);
      pushActivity(`Cartella reale di output selezionata: ${directoryHandle.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Selezione cartella annullata.";
      setExportMessage(message);
    }
  }

  async function handleGenerate() {
    if (result.pages.length === 0) {
      setExportMessage("Non ci sono fogli da esportare.");
      return;
    }

    setIsExporting(true);
    setExportMessage(null);

    try {
      const exportResult = await exportSheets(result, {
        directoryHandle: outputDirectoryHandle
      });
      const formatNote =
        request.output.format === "tif"
          ? " Il browser non genera TIFF nativi, quindi i fogli sono stati salvati in JPG."
          : "";
      const destination = exportResult.savedToDirectory
        ? `nella cartella ${request.output.folderPath}`
        : "tramite download del browser";
      const message = `${exportResult.exportedFiles.length} fogli esportati ${destination}.${formatNote}`;
      setExportMessage(message);
      pushActivity(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore durante l'esportazione dei fogli.";
      setExportMessage(message);
      pushActivity(message);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleFolderSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const files = Array.from(fileList);
    setIsImporting(true);

    try {
      const assets = await loadImageAssetsFromFiles(files);

      if (assets.length === 0) {
        pushActivity("Nessuna immagine supportata trovata. Seleziona file JPG o PNG.");
        return;
      }

      const folderLabel = inferFolderLabelFromFiles(files);
      const nextRequest = {
        ...request,
        assets,
        sourceFolderPath: folderLabel || request.sourceFolderPath
      };

      setUsesMockData(false);
      setOutputDirectoryHandle(null);
      applyPlanningRequest(nextRequest);
      pushActivity(`Caricate ${assets.length} immagini da ${folderLabel || "file selezionati"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossibile importare i file selezionati.";
      pushActivity(message);
    } finally {
      setIsImporting(false);
    }
  }

  function handleLoadMockData() {
    const nextRequest = {
      ...request,
      assets: mockWeddingAssets,
      sourceFolderPath: DEFAULT_AUTO_LAYOUT_REQUEST.sourceFolderPath
    };

    setUsesMockData(true);
    setOutputDirectoryHandle(null);
    applyPlanningRequest(nextRequest);
    pushActivity("Campione reale matrimonio ripristinato.");
  }

  function renderStepSwitcher() {
    return (
      <div className="workflow-switcher">
        <button
          type="button"
          className={currentScreen === "setup" ? "workflow-step workflow-step--active" : "workflow-step"}
          onClick={() => setCurrentScreen("setup")}
        >
          <span>1</span>
          <strong>Imposta Progetto</strong>
          <small>Formato, gap, foto e parametri</small>
        </button>
        <button
          type="button"
          className={currentScreen === "studio" ? "workflow-step workflow-step--active" : "workflow-step"}
          onClick={() => {
            if (canOpenStudio) {
              setCurrentScreen("studio");
            }
          }}
          disabled={!canOpenStudio}
        >
          <span>2</span>
          <strong>Studio Layout</strong>
          <small>Spread, modifica rapida ed export</small>
        </button>
      </div>
    );
  }

  function renderSetupScreen() {
    return (
      <>
        <header className="workspace__header">
          <div>
            <span className="workspace__eyebrow">Impaginazione Automatica</span>
            <h2>Prepara il progetto prima di entrare nello studio layout</h2>
            <p>
              In questa schermata imposti formato foglio, bordi, gap, numero di fogli e sorgente
              immagini. Quando il progetto e' pronto passi alla modifica visuale a pieno schermo.
            </p>
          </div>

          <div className="header-badges">
            <span className="badge">{result.summary.totalImages} foto caricate</span>
            <span className="badge">{result.pages.length} fogli previsti</span>
            <span className="badge">{request.sheet.label}</span>
            <span className="badge">{isPlanningPending ? "Aggiornamento layout..." : "Layout aggiornato"}</span>
          </div>
        </header>

        {renderStepSwitcher()}

        <div className="context-strip">
          <span>{usesMockData ? "Demo fotografica reale" : "Servizio importato"}: {request.assets.length} immagini</span>
          <span>Formato foglio: {request.sheet.label}</span>
          <span>Output: {request.output.folderPath}</span>
        </div>

        <div className="workspace-grid">
          <div className="workspace-grid__main">
            <PanelSection title={sections.input.title} description={sections.input.description}>
              <InputPanel
                sourceFolderPath={request.sourceFolderPath}
                totalImages={result.summary.totalImages}
                verticalCount={result.summary.verticalCount}
                horizontalCount={result.summary.horizontalCount}
                squareCount={result.summary.squareCount}
                isImporting={isImporting}
                usesMockData={usesMockData}
                onSourceFolderChange={(value) =>
                  applyPlanningRequest({ ...request, sourceFolderPath: value })
                }
                onFolderSelected={handleFolderSelected}
                onLoadMockData={handleLoadMockData}
              />
            </PanelSection>

            <PanelSection title={sections.settings.title} description={sections.settings.description}>
              <SettingsPanel
                request={request}
                onSheetPresetChange={handleSheetPresetChange}
                onSheetFieldChange={handleSheetFieldChange}
                onFitModeChange={handleFitModeChange}
                onPlanningModeChange={handlePlanningModeChange}
                onDesiredSheetCountChange={handleDesiredSheetCountChange}
                onMaxPhotosPerSheetChange={handleMaxPhotosPerSheetChange}
                onAllowTemplateVariationChange={handleAllowTemplateVariationChange}
              />
            </PanelSection>
          </div>

          <div className="workspace-grid__side">
            <PanelSection title={sections.result.title} description={sections.result.description}>
              <ResultPanel result={result} />
            </PanelSection>

            <PanelSection title={sections.output.title} description={sections.output.description}>
              <OutputPanel
                request={request}
                isExporting={isExporting}
                exportMessage={exportMessage}
                supportsDirectoryPicker={supportsDirectoryPicker}
                onOutputChange={updateOutput}
                onPickOutputFolder={handlePickOutputFolder}
                onGenerate={handleGenerate}
              />
            </PanelSection>

            <PanelSection
              title="Registro Attivita"
              description="Traccia operativa della sessione corrente, utile durante la vendita e la stampa."
            >
              <ul className="activity-log">
                {activityLog.map((entry, index) => (
                  <li key={`${entry}-${index}`}>{entry}</li>
                ))}
              </ul>
            </PanelSection>
          </div>
        </div>

        <div className="setup-footer">
          <div>
            <strong>Quando il progetto e' pronto, apri lo studio layout.</strong>
            <p>La seconda schermata usa tutto lo schermo del PC per spread, modifica rapida ed export.</p>
          </div>
          <button
            type="button"
            className="primary-button setup-footer__action"
            disabled={!canOpenStudio}
            onClick={() => setCurrentScreen("studio")}
          >
            Apri studio layout
          </button>
        </div>
      </>
    );
  }

  function renderStudioScreen() {
    return (
      <>
        <header className="studio-shell__header">
          <div className="studio-shell__intro">
            <span className="workspace__eyebrow">Studio Layout</span>
            <h2>Modifica i layout a pieno schermo e tieni l'export sempre a portata di mano</h2>
            <p>
              Lo studio e' ottimizzato per PC: spread centrali ampie, ribbon foto interna, controlli
              slot laterali ed export sempre visibile nella barra superiore.
            </p>
          </div>

          <div className="studio-shell__actions">
            <button type="button" className="ghost-button" onClick={() => setCurrentScreen("setup")}>
              Torna alle impostazioni
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={result.unassignedAssets.length === 0}
              onClick={handleCreatePageFromUnused}
            >
              Nuovo foglio dalle non usate
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleGenerate}
              disabled={isExporting || result.pages.length === 0}
            >
              {isExporting ? "Esportazione in corso..." : "Esporta"}
            </button>
          </div>
        </header>

        {renderStepSwitcher()}

        <div className="studio-shell__statusbar">
            <span>{request.assets.length} foto caricate</span>
            <span>{usedImagesCount} gia' impaginate</span>
            <span>{result.unassignedAssets.length} ancora libere</span>
            <span>Output: {request.output.folderPath}</span>
            <span>{isEditingPending ? "Aggiornamento foglio..." : "Editor pronto"}</span>
          </div>

        <div className="studio-shell__content">
          <div className="studio-shell__board">
            <LayoutPreviewBoard
              result={result}
              assets={result.request.assets}
              assetsById={assetsById}
              usageByAssetId={usageByAssetId}
              selectedPageId={selectedPageId}
              selectedSlotKey={selectedSlotKey}
              dragState={dragState}
              onSelectPage={(pageId, slotId) => {
                setSelectedPageId(pageId);
                setSelectedSlotKey(slotId ? `${pageId}:${slotId}` : null);
              }}
              onStartSlotDrag={(pageId, slotId, imageId) =>
                setDragState({
                  kind: "slot",
                  imageId,
                  sourcePageId: pageId,
                  sourceSlotId: slotId
                })
              }
              onDragAssetStart={(imageId) =>
                setDragState({
                  kind: "asset",
                  imageId
                })
              }
              onDragEnd={() => setDragState(null)}
              onDrop={handleDrop}
              onAssetDropped={handleAssetDropped}
              onDropToUnused={handleDropToUnused}
              onClearSlot={(pageId, slotId) => {
                startEditingTransition(() => {
                  setResult((current) =>
                    clearSlotAssignment(current, {
                      pageId,
                      slotId
                    })
                  );
                });
                pushActivity(`Foto rimossa manualmente dallo slot ${pageId}:${slotId}.`);
              }}
              onTemplateChange={handleTemplateChange}
              onRemovePage={handleRemovePage}
            />
          </div>

          <aside className="studio-shell__side">
            <PanelSection
              title="Stato Progetto"
              description="Riepilogo rapido del lavoro corrente mentre modifichi la spread."
            >
              <div className="studio-summary-grid">
                <div className="stat-card stat-card--highlight">
                  <span>Fogli</span>
                  <strong>{result.pages.length}</strong>
                </div>
                <div className="stat-card">
                  <span>Usate</span>
                  <strong>{usedImagesCount}</strong>
                </div>
                <div className="stat-card">
                  <span>Libere</span>
                  <strong>{result.unassignedAssets.length}</strong>
                </div>
                <div className="stat-card">
                  <span>DPI</span>
                  <strong>{request.sheet.dpi}</strong>
                </div>
              </div>
            </PanelSection>

            <PanelSection
              title="Azioni Foglio"
              description="Azioni immediate sulla pagina attiva e sul progetto."
            >
              <div className="stack">
                <button
                  type="button"
                  className="secondary-button studio-side__button"
                  disabled={result.unassignedAssets.length === 0}
                  onClick={handleCreatePageFromUnused}
                >
                  Aggiungi nuovo foglio
                </button>
                <button
                  type="button"
                  className="ghost-button studio-side__button"
                  disabled={!selectedPage}
                  onClick={() => {
                    if (selectedPage) {
                      handleRemovePage(selectedPage.id);
                    }
                  }}
                >
                  Elimina foglio attivo
                </button>
                <button
                  type="button"
                  className="ghost-button studio-side__button"
                  onClick={() => setCurrentScreen("setup")}
                >
                  Torna alla preparazione
                </button>
              </div>
            </PanelSection>

            <PanelSection
              title="Controllo Slot"
              description="Regola manualmente il riquadro selezionato senza perdere il resto della spread."
            >
              <AssignmentInspector
                pageLabel={selectedPage ? `Foglio ${selectedPage.pageNumber}` : null}
                slot={selectedSlot}
                assignment={selectedAssignment}
                asset={selectedAsset}
                onChange={(changes) => {
                  if (!selectedPage || !selectedSlot) {
                    return;
                  }

                  startEditingTransition(() => {
                    setResult((current) =>
                      updateSlotAssignment(current, {
                        pageId: selectedPage.id,
                        slotId: selectedSlot.id,
                        changes
                      })
                    );
                  });
                }}
                onClear={() => {
                  if (!selectedPage || !selectedSlot) {
                    return;
                  }

                  startEditingTransition(() => {
                    setResult((current) =>
                      clearSlotAssignment(current, {
                        pageId: selectedPage.id,
                        slotId: selectedSlot.id
                      })
                    );
                  });
                  pushActivity(`Slot ${selectedSlot.id} svuotato manualmente.`);
                }}
              />
            </PanelSection>

            <PanelSection
              title="Output"
              description="Percorso, formato e bottone export sempre pronti anche mentre modifichi."
            >
              <OutputPanel
                request={request}
                isExporting={isExporting}
                exportMessage={exportMessage}
                supportsDirectoryPicker={supportsDirectoryPicker}
                onOutputChange={updateOutput}
                onPickOutputFolder={handlePickOutputFolder}
                onGenerate={handleGenerate}
              />
            </PanelSection>
          </aside>
        </div>
      </>
    );
  }

  return (
    <div className={currentScreen === "studio" ? "app-shell app-shell--studio" : "app-shell"}>
      {currentScreen === "setup" ? <Sidebar tools={TOOL_NAVIGATION} activeToolId="auto-layout" /> : null}

      <main className={currentScreen === "studio" ? "workspace workspace--studio" : "workspace"}>
        {currentScreen === "setup" ? renderSetupScreen() : renderStudioScreen()}
      </main>
    </div>
  );
}
