import { useEffect, useMemo, useState } from "react";
import type { AutoLayoutRequest, OutputFormat } from "@photo-tools/shared-types";

export interface OutputProfile {
  id: string;
  name: string;
  format: OutputFormat;
  quality: number;
  dpi: number;
  fileNamePattern: string;
}

interface OutputPanelProps {
  request: AutoLayoutRequest;
  pageCount: number;
  unassignedCount: number;
  warningCount: number;
  readinessTone: "ok" | "warning" | "critical" | "progress";
  readinessLabel: string;
  readinessDetail: string;
  isExporting: boolean;
  exportMessage: string | null;
  supportsDirectoryPicker: boolean;
  onOutputChange: (
    field: "folderPath" | "fileNamePattern" | "quality" | "format",
    value: string | number
  ) => void;
  onPickOutputFolder: () => void;
  onGenerate: () => void;
  onExportPsd: () => void;
  isExportingPsd: boolean;
  onApplyOutputProfile: (profile: OutputProfile) => void;
}

const OUTPUT_PROFILES_STORAGE_KEY = "imagetool-output-profiles-v1";

const BUILTIN_OUTPUT_PROFILES: OutputProfile[] = [
  {
    id: "builtin-lab-fuji-300-jpg",
    name: "Lab Fuji 300dpi JPG",
    format: "jpg",
    quality: 95,
    dpi: 300,
    fileNamePattern: "lab-fuji-{index}"
  },
  {
    id: "builtin-web-proof-72-png",
    name: "Prova web 72dpi PNG",
    format: "png",
    quality: 90,
    dpi: 72,
    fileNamePattern: "web-proof-{index}"
  }
];

function isOutputProfile(value: unknown): value is OutputProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<OutputProfile>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.format === "jpg" || candidate.format === "png" || candidate.format === "tif") &&
    typeof candidate.quality === "number" &&
    Number.isFinite(candidate.quality) &&
    typeof candidate.dpi === "number" &&
    Number.isFinite(candidate.dpi) &&
    typeof candidate.fileNamePattern === "string"
  );
}

function loadStoredOutputProfiles(): OutputProfile[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(OUTPUT_PROFILES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isOutputProfile);
  } catch {
    return [];
  }
}

function saveStoredOutputProfiles(profiles: OutputProfile[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(OUTPUT_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

function buildCustomProfileId(profileName: string): string {
  const normalized = profileName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `custom-${normalized || "preset"}-${Date.now()}`;
}

export function OutputPanel({
  request,
  pageCount,
  unassignedCount,
  warningCount,
  readinessTone,
  readinessLabel,
  readinessDetail,
  isExporting,
  exportMessage,
  supportsDirectoryPicker,
  onOutputChange,
  onPickOutputFolder,
  onGenerate,
  onExportPsd,
  isExportingPsd,
  onApplyOutputProfile
}: OutputPanelProps) {
  const [savedProfiles, setSavedProfiles] = useState<OutputProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState(BUILTIN_OUTPUT_PROFILES[0]?.id ?? "");
  const [profileNameDraft, setProfileNameDraft] = useState("");

  useEffect(() => {
    setSavedProfiles(loadStoredOutputProfiles());
  }, []);

  const allProfiles = useMemo(
    () => [...BUILTIN_OUTPUT_PROFILES, ...savedProfiles],
    [savedProfiles]
  );

  const selectedProfile = useMemo(
    () => allProfiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [allProfiles, selectedProfileId]
  );

  const isSelectedProfileCustom = Boolean(
    selectedProfile && !BUILTIN_OUTPUT_PROFILES.some((profile) => profile.id === selectedProfile.id)
  );
  const needsFinalCheck = warningCount > 0 || unassignedCount > 0;

  const handleApplySelectedProfile = () => {
    if (!selectedProfile) {
      return;
    }

    onApplyOutputProfile(selectedProfile);
  };

  const handleSaveCurrentAsProfile = () => {
    const trimmedName = profileNameDraft.trim();
    if (!trimmedName) {
      return;
    }

    const nextProfile: OutputProfile = {
      id: buildCustomProfileId(trimmedName),
      name: trimmedName,
      format: request.output.format,
      quality: request.output.quality,
      dpi: request.sheet.dpi,
      fileNamePattern: request.output.fileNamePattern
    };

    const nextSavedProfiles = [...savedProfiles, nextProfile];
    setSavedProfiles(nextSavedProfiles);
    saveStoredOutputProfiles(nextSavedProfiles);
    setSelectedProfileId(nextProfile.id);
    setProfileNameDraft("");
  };

  const handleDeleteSelectedProfile = () => {
    if (!selectedProfile || !isSelectedProfileCustom) {
      return;
    }

    const nextSavedProfiles = savedProfiles.filter((profile) => profile.id !== selectedProfile.id);
    setSavedProfiles(nextSavedProfiles);
    saveStoredOutputProfiles(nextSavedProfiles);
    setSelectedProfileId(BUILTIN_OUTPUT_PROFILES[0]?.id ?? "");
  };

  return (
    <div className="output-panel stack">
      <div className="stats-grid">
        <div className={`stat-card stat-card--highlight output-panel__status-card output-panel__status-card--${readinessTone}`}>
          <span>Stato export</span>
          <strong>{readinessLabel}</strong>
          <small className="output-panel__card-note">{readinessDetail}</small>
        </div>
        <div className="stat-card">
          <span>Fogli pronti</span>
          <strong>{pageCount}</strong>
          <small className="output-panel__card-note">Verranno numerati con il pattern scelto.</small>
        </div>
        <div className="stat-card">
          <span>Foto libere</span>
          <strong>{unassignedCount}</strong>
          <small className="output-panel__card-note">
            {unassignedCount > 0 ? "Restano fuori dai fogli finche non le assegni." : "Tutte le foto attive sono gia distribuite."}
          </small>
        </div>
        <div className="stat-card">
          <span>Formato finale</span>
          <strong>{request.output.format.toUpperCase()}</strong>
          <small className="output-panel__card-note">Qualita {request.output.quality} / {request.sheet.dpi} DPI</small>
        </div>
      </div>

      {needsFinalCheck ? (
        <div className="message-box message-box--warning">
          {warningCount > 0
            ? `${warningCount} segnalazioni risultano ancora aperte.`
            : "Nessun avviso bloccante aperto."}{" "}
          {unassignedCount > 0
            ? `${unassignedCount} foto non sono ancora finite in un foglio.`
            : "La distribuzione foto e completa."}
        </div>
      ) : null}

      <section className="output-panel__section">
        <div className="output-panel__section-header">
          <strong>Destinazione e nome file</strong>
          <p>Definisci cartella finale e naming, cosi l'export resta leggibile anche fuori dall'app.</p>
        </div>

        <div className="inline-grid inline-grid--2">
          <label className="field">
            <span>Cartella di output</span>
            <input
              type="text"
              value={request.output.folderPath}
              onChange={(event) => onOutputChange("folderPath", event.target.value)}
            />
          </label>

          <label className="field">
            <span>Nome file</span>
            <input
              type="text"
              value={request.output.fileNamePattern}
              onChange={(event) => onOutputChange("fileNamePattern", event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="output-panel__section">
        <div className="output-panel__section-header">
          <strong>Formato e preset</strong>
          <p>Imposta il tipo di file finale oppure richiama un preset gia usato in produzione.</p>
        </div>

        <div className="inline-grid inline-grid--2">
          <label className="field">
            <span>Formato</span>
            <select
              value={request.output.format}
              onChange={(event) => onOutputChange("format", event.target.value as OutputFormat)}
            >
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="tif">TIF (salvato come JPG)</option>
            </select>
          </label>

          <label className="field">
            <span>Qualita</span>
            <input
              type="number"
              min="1"
              max="100"
              value={request.output.quality}
              onChange={(event) => onOutputChange("quality", Number(event.target.value))}
            />
          </label>
        </div>

        <div className="inline-grid inline-grid--2">
          <label className="field">
            <span>Preset export</span>
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
            >
              {allProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} / {profile.dpi}dpi / {profile.format.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Azioni preset</span>
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                onClick={handleApplySelectedProfile}
                disabled={!selectedProfile}
              >
                Applica preset
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={handleDeleteSelectedProfile}
                disabled={!isSelectedProfileCustom}
              >
                Elimina
              </button>
            </div>
          </div>
        </div>

        <div className="inline-grid inline-grid--2">
          <label className="field">
            <span>Salva preset corrente</span>
            <input
              type="text"
              placeholder="Es. Lab wedding 300"
              value={profileNameDraft}
              onChange={(event) => setProfileNameDraft(event.target.value)}
            />
          </label>
          <div className="field">
            <span>&nbsp;</span>
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                onClick={handleSaveCurrentAsProfile}
                disabled={profileNameDraft.trim().length === 0}
              >
                Salva preset
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="output-panel__section">
        <div className="output-panel__section-header">
          <strong>Esporta adesso</strong>
          <p>Scegli se produrre i fogli standard oppure i PSD multilayer per ritocco e Camera Raw.</p>
        </div>

        <div className="button-row">
          {supportsDirectoryPicker ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onPickOutputFolder}
              aria-label="Seleziona la cartella di output reale dal computer"
            >
              Scegli cartella reale
            </button>
          ) : null}
          <button
            type="button"
            className="primary-button"
            onClick={onGenerate}
            disabled={isExporting}
            aria-label="Esporta i fogli di stampa in base alle impostazioni"
          >
            {isExporting ? "Esportazione in corso..." : "Esporta fogli"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onExportPsd}
            disabled={isExportingPsd || isExporting}
            aria-label="Esporta ogni foglio come file PSD con Smart Objects separati per ogni foto"
            title="Ogni foto diventa un layer Smart Object. In Photoshop fai doppio click per aprirla in Camera Raw."
          >
            {isExportingPsd ? "Generazione PSD..." : "Esporta PSD con layer"}
          </button>
        </div>

        <p className="helper-copy">
          {supportsDirectoryPicker
            ? "Se scegli una cartella reale, i file vengono scritti direttamente li."
            : "La scelta diretta della cartella non e disponibile in questa build: i fogli verranno salvati come file."}
        </p>
      </section>

      {exportMessage ? <div className="message-box message-box--warning">{exportMessage}</div> : null}
    </div>
  );
}
