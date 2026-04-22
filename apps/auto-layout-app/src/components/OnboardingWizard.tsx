import { useEffect, useRef, useState } from "react";
import { SHEET_PRESETS } from "@photo-tools/presets";
import type { AutoLayoutRequest, ImageAsset, WorkflowMode } from "@photo-tools/shared-types";
import { DismissibleBanner } from "./DismissibleBanner";
import { PhotoSelector } from "./PhotoSelector";

interface OnboardingWizardProps {
  isOpen: boolean;
  isLoading: boolean;
  loadingPhase?: "reading" | "preparing";
  loadingProcessed?: number;
  loadingTotal?: number;
  loadingCurrentFile?: string | null;
  onClose: () => void;
  onComplete: (request: AutoLayoutRequest, projectName: string) => void;
  currentRequest: AutoLayoutRequest;
  onAssetsChange?: (assets: ImageAsset[]) => void;
  onFolderSelected?: (files: FileList | null) => void;
  onLoadMockData?: () => void;
}

type WizardStep = "welcome" | "projectName" | "mode" | "images" | "select" | "template" | "planning" | "preview";

export function OnboardingWizard({
  isOpen,
  isLoading,
  loadingPhase = "reading",
  loadingProcessed = 0,
  loadingTotal = 0,
  loadingCurrentFile = null,
  onClose,
  onComplete,
  currentRequest,
  onAssetsChange,
  onFolderSelected,
  onLoadMockData
}: OnboardingWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const [step, setStep] = useState<WizardStep>("welcome");
  const [projectName, setProjectName] = useState(`Progetto ${new Date().toLocaleDateString("it-IT")}`);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>(currentRequest.workflowMode ?? "auto");
  const [selectedPresetId, setSelectedPresetId] = useState(currentRequest.sheet.presetId);
  const [planningMode, setPlanningMode] = useState<"fogli" | "foto">("fogli");
  const [plannedValue, setPlannedValue] = useState(currentRequest.desiredSheetCount ?? 5);
  const [dismissedWelcomeBanner, setDismissedWelcomeBanner] = useState(false);

  useEffect(() => {
    if (!fileInputRef.current) {
      return;
    }

    fileInputRef.current.setAttribute("webkitdirectory", "");
    fileInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep("welcome");
      setWorkflowMode(currentRequest.workflowMode ?? "auto");
      setSelectedPresetId(currentRequest.sheet.presetId);
      setPlanningMode(currentRequest.planningMode === "maxPhotosPerSheet" ? "foto" : "fogli");
      setPlannedValue(
        currentRequest.planningMode === "maxPhotosPerSheet"
          ? currentRequest.maxPhotosPerSheet ?? 2
          : currentRequest.desiredSheetCount ?? 5
      );
      setSelectedPhotoIds(currentRequest.assets.map((asset) => asset.id));
    }

    wasOpenRef.current = isOpen;
  }, [currentRequest, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const validIds = new Set(currentRequest.assets.map((asset) => asset.id));

    setSelectedPhotoIds((current) => {
      if (current.length === 0) {
        return current;
      }

      const filtered = current.filter((id) => validIds.has(id));
      const hadInvalidEntries = filtered.length !== current.length;

      if (!hadInvalidEntries) {
        return current;
      }

      return filtered;
    });
  }, [currentRequest.assets, isOpen]);

  if (!isOpen) return null;

  const wizardSteps: WizardStep[] =
    workflowMode === "manual"
      ? ["welcome", "projectName", "mode", "images", "select", "template", "preview"]
      : ["welcome", "projectName", "mode", "images", "select", "template", "planning", "preview"];

  const handleNext = () => {
    const currentIndex = wizardSteps.indexOf(step);
    if (currentIndex < wizardSteps.length - 1) {
      const nextStep = wizardSteps[currentIndex + 1];
      if (nextStep === "select" && workflowMode !== "manual" && selectedPhotoIds.length === 0) {
        setSelectedPhotoIds(currentRequest.assets.map((asset) => asset.id));
      }
      setStep(nextStep);
    }
  };

  const handlePrevious = () => {
    const currentIndex = wizardSteps.indexOf(step);
    if (currentIndex > 0) {
      setStep(wizardSteps[currentIndex - 1]);
    }
  };

  const handleCompleteWizard = () => {
    const selectedPreset = SHEET_PRESETS.find((preset) => preset.id === selectedPresetId);
    if (!selectedPreset) return;

    const selectedAssets = currentRequest.assets.filter((asset) => selectedPhotoIds.includes(asset.id));
    if (selectedAssets.length === 0) {
      return;
    }

    const updatedRequest: AutoLayoutRequest = {
      ...currentRequest,
      assets: selectedAssets,
      workflowMode,
      sheet: {
        ...currentRequest.sheet,
        presetId: selectedPreset.id,
        label: selectedPreset.label,
        widthCm: selectedPreset.widthCm,
        heightCm: selectedPreset.heightCm
      },
      planningMode:
        workflowMode === "manual"
          ? "desiredSheetCount"
          : planningMode === "fogli"
            ? "desiredSheetCount"
            : "maxPhotosPerSheet",
      desiredSheetCount: planningMode === "fogli" ? plannedValue : undefined,
      maxPhotosPerSheet:
        workflowMode === "manual"
          ? currentRequest.maxPhotosPerSheet
          : planningMode === "foto"
            ? plannedValue
            : undefined
    };

    onComplete(updatedRequest, projectName);
    setStep("welcome");
    setSelectedPhotoIds([]);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="wizard-modal" onClick={(event) => event.stopPropagation()}>
        {step === "welcome" && (
          <div className="wizard-step">
            <div className="wizard-step__content">
              <h1 className="wizard-heading">Benvenuto in ImageAlbumMaker</h1>
              <p className="wizard-description">
                Ti guidero passo-passo per preparare il tuo progetto di impaginazione.
              </p>

              {!dismissedWelcomeBanner && (
                <DismissibleBanner
                  title="Suggerimento"
                  message="Dopo il setup puoi entrare nello studio per modificare i layout manualmente. Le modifiche vengono salvate automaticamente."
                  type="info"
                  onDismiss={() => setDismissedWelcomeBanner(true)}
                />
              )}

              <div className="wizard-benefits">
                <div className="benefit">
                  <span className="benefit__icon">IMG</span>
                  <p><strong>Carica le foto</strong><br />Seleziona la cartella con gli scatti del progetto.</p>
                </div>
                <div className="benefit">
                  <span className="benefit__icon">FMT</span>
                  <p><strong>Scegli il formato</strong><br />Imposta il foglio di stampa piu adatto al lavoro.</p>
                </div>
                <div className="benefit">
                  <span className="benefit__icon">CFG</span>
                  <p><strong>Configura il layout</strong><br />Decidi quanti fogli creare o quante foto inserire.</p>
                </div>
                <div className="benefit">
                  <span className="benefit__icon">STD</span>
                  <p><strong>Rifinisci nello studio</strong><br />Perfeziona il risultato e poi esporta.</p>
                </div>
              </div>
            </div>

            <div className="wizard-actions">
              <button type="button" className="ghost-button" onClick={onClose}>
                Annulla
              </button>
              <button type="button" className="primary-button" onClick={handleNext} disabled={isLoading}>
                Inizia
              </button>
            </div>
          </div>
        )}

        {step === "projectName" && (
          <div className="wizard-step">
            <div className="wizard-step__content">
              <h2 className="wizard-heading">Dai un nome al progetto</h2>
              <p className="wizard-description">
                Scegli un nome che ti aiuti a riconoscere questo lavoro in futuro.
              </p>

              <div className="wizard-project-name-input-group">
                <label className="wizard-project-name-label">
                  <span className="wizard-label-text">Nome progetto</span>
                  <input
                    type="text"
                    className="wizard-project-name-input"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="Es: Matrimonio Anna e Marco"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleNext();
                    }}
                    aria-label="Nome del progetto"
                  />
                </label>
              </div>

              <div className="wizard-info-box wizard-info-box--info">
                <p>
                  <strong>Consiglio:</strong> usa un nome descrittivo come "Matrimonio [Sposi]" oppure "Sessione [Evento]".
                </p>
              </div>
            </div>

            <div className="wizard-actions">
              <button type="button" className="ghost-button" onClick={handlePrevious} disabled={isLoading}>
                Indietro
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleNext}
                disabled={isLoading || !projectName.trim()}
              >
                Continua
              </button>
            </div>
          </div>
        )}

        {step === "mode" && (
          <div className="wizard-step">
            <div className="wizard-step__content">
              <h2 className="wizard-heading">Scegli il flusso di lavoro</h2>
              <p className="wizard-description">
                Decidi se partire da una distribuzione automatica o da un progetto a fogli manuali.
              </p>

              <div className="planning-options">
                <label className={`planning-option ${workflowMode === "auto" ? "planning-option--selected" : ""}`}>
                  <input
                    type="radio"
                    name="workflow-mode"
                    value="auto"
                    checked={workflowMode === "auto"}
                    onChange={() => setWorkflowMode("auto")}
                  />
                  <div className="planning-option__content">
                    <div className="planning-option__title">Auto (da foto)</div>
                    <p className="planning-option__description">
                      L'app distribuisce automaticamente le foto nei fogli in base alle regole di planning.
                    </p>
                  </div>
                </label>

                <label className={`planning-option ${workflowMode === "manual" ? "planning-option--selected" : ""}`}>
                  <input
                    type="radio"
                    name="workflow-mode"
                    value="manual"
                    checked={workflowMode === "manual"}
                    onChange={() => setWorkflowMode("manual")}
                  />
                  <div className="planning-option__content">
                    <div className="planning-option__title">Impaginazione libera</div>
                    <p className="planning-option__description">
                      Carichi le foto e scegli tu cosa impaginare, senza distribuzione automatica nei fogli.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="wizard-actions">
              <button type="button" className="ghost-button" onClick={handlePrevious} disabled={isLoading}>
                Indietro
              </button>
              <button type="button" className="primary-button" onClick={handleNext} disabled={isLoading}>
                Continua
              </button>
            </div>
          </div>
        )}

        {step === "images" && (
          <div className="wizard-step">
            <div className="wizard-step__content">
              <h2 className="wizard-heading">Carica le foto</h2>
              <p className="wizard-description">
                Seleziona la cartella con le immagini che vuoi impaginare.
              </p>

              <div className="wizard-info-box wizard-info-box--info">
                <p>
                  <strong>Tip:</strong> usa una cartella che contenga solo le immagini del progetto. ImageAlbumMaker rileva JPG, PNG e WEBP.
                </p>
              </div>

              <div className="wizard-image-status">
                <span className="status-badge">
                  <span className="status-badge__label">
                    {isLoading ? "Caricamento foto:" : "Foto caricate:"}
                  </span>
                  <span className="status-badge__value">{currentRequest.assets.length}</span>
                </span>
              </div>

              {isLoading ? (
                <div className="wizard-loading-state" role="status" aria-live="polite">
                  <div className="wizard-loading-state__spinner" aria-hidden="true" />
                  <div className="wizard-loading-state__copy">
                    <strong>
                      {loadingPhase === "reading"
                        ? "Sto leggendo la cartella selezionata..."
                        : `Sto preparando ${loadingProcessed} di ${Math.max(loadingTotal, 1)} foto...`}
                    </strong>
                    <span>
                      {loadingCurrentFile ??
                        (loadingPhase === "reading"
                          ? "Controllo i file supportati prima di mostrare la selezione."
                          : "Creo anteprime e metadati delle immagini.")}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="wizard-loading-actions">
                <button
                  type="button"
                  className="secondary-button wizard-secondary-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  aria-label="Seleziona una cartella con le foto"
                >
                  Seleziona cartella foto
                </button>

                <small className="wizard-or-label">oppure</small>

                <button
                  type="button"
                  className="ghost-button wizard-secondary-button"
                  onClick={() => onLoadMockData?.()}
                  disabled={isLoading}
                  aria-label="Carica le foto demo"
                >
                  Usa foto demo
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => onFolderSelected?.(event.currentTarget.files)}
                disabled={isLoading}
                style={{ display: "none" }}
                aria-label="Seleziona file immagine"
              />
            </div>

            <div className="wizard-actions">
              <button type="button" className="ghost-button" onClick={handlePrevious} disabled={isLoading}>
                Indietro
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleNext}
                disabled={currentRequest.assets.length === 0 || isLoading}
              >
                Continua
              </button>
            </div>
          </div>
        )}

        {step === "select" && (
          <div className="wizard-step">
            <div className="wizard-step__content">
              <h2 className="wizard-heading">Seleziona le foto da impaginare</h2>
              <p className="wizard-description">
                Hai caricato {currentRequest.assets.length} foto. Ne hai selezionate {selectedPhotoIds.length}.
              </p>

              <PhotoSelector
                photos={currentRequest.assets}
                selectedIds={selectedPhotoIds}
                onSelectionChange={setSelectedPhotoIds}
                onPhotosChange={onAssetsChange}
              />
            </div>

            <div className="wizard-actions">
              <button type="button" className="ghost-button" onClick={handlePrevious} disabled={isLoading}>
                Indietro
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleNext}
                disabled={selectedPhotoIds.length === 0 || isLoading}
              >
                Continua
              </button>
            </div>
          </div>
        )}

        {step === "template" && (
          <div className="wizard-step">
            <div className="wizard-step__content">
              <h2 className="wizard-heading">Scegli il formato foglio</h2>
              <p className="wizard-description">
                Seleziona il formato di stampa preferito per questo progetto.
              </p>

              <div className="template-grid">
                {SHEET_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`template-card ${selectedPresetId === preset.id ? "template-card--selected" : ""}`}
                    onClick={() => setSelectedPresetId(preset.id)}
                  >
                    <div className="template-card__label">{preset.label}</div>
                    <div className="template-card__dimensions">
                      {preset.widthCm}x{preset.heightCm} cm
                    </div>
                  </button>
                ))}
              </div>

              <div className="wizard-info-box wizard-info-box--info">
                <p>
                  Puoi personalizzare le dimensioni piu tardi dal pannello <strong>Impostazioni avanzate</strong>.
                </p>
              </div>
            </div>

            <div className="wizard-actions">
              <button type="button" className="ghost-button" onClick={handlePrevious}>
                Indietro
              </button>
              <button type="button" className="primary-button" onClick={handleNext} disabled={isLoading}>
                Continua
              </button>
            </div>
          </div>
        )}

        {step === "planning" && (
          <div className="wizard-step">
            <div className="wizard-step__content">
              <h2 className="wizard-heading">Imposta il criterio di layout</h2>
              <p className="wizard-description">
                Scegli come calcolare automaticamente il numero di fogli.
              </p>

              <div className="planning-options">
                <label className={`planning-option ${planningMode === "fogli" ? "planning-option--selected" : ""}`}>
                  <input
                    type="radio"
                    name="planning"
                    value="fogli"
                    checked={planningMode === "fogli"}
                    onChange={() => setPlanningMode("fogli")}
                  />
                  <div className="planning-option__content">
                    <div className="planning-option__title">Numero di fogli desiderati</div>
                    <p className="planning-option__description">
                      Imposta quanti fogli vuoi ottenere e il sistema distribuira le foto.
                    </p>
                    <input
                      type="number"
                      min="1"
                      value={planningMode === "fogli" ? plannedValue : 5}
                      onChange={(event) => setPlannedValue(Number(event.target.value))}
                      className="planning-option__input"
                      disabled={planningMode !== "fogli"}
                    />
                  </div>
                </label>

                <label className={`planning-option ${planningMode === "foto" ? "planning-option--selected" : ""}`}>
                  <input
                    type="radio"
                    name="planning"
                    value="foto"
                    checked={planningMode === "foto"}
                    onChange={() => setPlanningMode("foto")}
                  />
                  <div className="planning-option__content">
                    <div className="planning-option__title">Foto per foglio</div>
                    <p className="planning-option__description">
                      Imposta quante foto inserire per foglio e il sistema calcolera il numero totale.
                    </p>
                    <input
                      type="number"
                      min="1"
                      max="4"
                      value={planningMode === "foto" ? plannedValue : 2}
                      onChange={(event) => setPlannedValue(Number(event.target.value))}
                      className="planning-option__input"
                      disabled={planningMode !== "foto"}
                    />
                  </div>
                </label>
              </div>

              <div className="wizard-info-box wizard-info-box--info">
                <p>
                  <strong>Importante:</strong> entrambe le modalita sono reversibili. Potrai cambiarle anche piu tardi nello studio.
                </p>
              </div>
            </div>

            <div className="wizard-actions">
              <button type="button" className="ghost-button" onClick={handlePrevious}>
                Indietro
              </button>
              <button type="button" className="primary-button" onClick={handleNext} disabled={isLoading}>
                Anteprima
              </button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="wizard-step">
            <div className="wizard-step__content">
              <h2 className="wizard-heading">Anteprima del progetto</h2>
              <p className="wizard-description">
                Verifica che tutto sia corretto prima di entrare nello studio.
              </p>

              <div className="preview-summary">
                <div className="summary-item">
                  <span className="summary-item__label">Foto selezionate:</span>
                  <span className="summary-item__value">
                    {selectedPhotoIds.length} su {currentRequest.assets.length}
                  </span>
                </div>
                <div className="summary-item">
                  <span className="summary-item__label">Formato foglio:</span>
                  <span className="summary-item__value">
                    {SHEET_PRESETS.find((preset) => preset.id === selectedPresetId)?.label} (
                    {SHEET_PRESETS.find((preset) => preset.id === selectedPresetId)?.widthCm}x
                    {SHEET_PRESETS.find((preset) => preset.id === selectedPresetId)?.heightCm} cm)
                  </span>
                </div>
                <div className="summary-item">
                  <span className="summary-item__label">Workflow:</span>
                  <span className="summary-item__value">
                    {workflowMode === "manual" ? "Impaginazione libera" : "Auto (da foto)"}
                  </span>
                </div>
                <div className="summary-item">
                  <span className="summary-item__label">Criterio di layout:</span>
                  <span className="summary-item__value">
                    {workflowMode === "manual"
                      ? "Selezione e composizione manuale delle foto"
                      : planningMode === "fogli"
                        ? `${plannedValue} fogli desiderati`
                        : `${plannedValue} foto per foglio`}
                  </span>
                </div>
              </div>

              <div className="wizard-info-box wizard-info-box--success">
                <p>
                  Tutto e pronto. Ora puoi accedere allo studio per rifinire i layout ed esportare i fogli.
                </p>
              </div>
            </div>

            <div className="wizard-actions">
              <button type="button" className="ghost-button" onClick={handlePrevious}>
                Indietro
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleCompleteWizard}
                disabled={isLoading || selectedPhotoIds.length === 0}
              >
                Accedi allo studio
              </button>
            </div>
          </div>
        )}

        <div className="wizard-progress">
          {(() => {
            const progressLabels: Record<WizardStep, string> = {
              welcome: "Benvenuto",
              projectName: "Nome progetto",
              mode: "Workflow",
              images: "Foto",
              select: "Selezione",
              template: "Formato",
              planning: "Layout",
              preview: "Anteprima"
            };

            return wizardSteps.map((wizardStep, index) => (
              <button
                key={wizardStep}
                type="button"
                className={`progress-dot ${step === wizardStep ? "progress-dot--active" : ""} ${
                  wizardSteps.indexOf(step) >= index ? "progress-dot--completed" : ""
                }`}
                onClick={() => {
                  if (wizardSteps.indexOf(step) >= index) {
                    setStep(wizardStep);
                  }
                }}
                title={progressLabels[wizardStep]}
              />
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
