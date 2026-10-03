import { PhotosRecap, StepFrame } from "./StepFrame";

export function NewJobStep({ photosText, onChangePhotos, name, onName, day, onDay, dayHint, categories, categoryKey, onCategory, invalidName, invalidDay, issues, onBack, onNext }: {
  photosText: string; onChangePhotos: () => void;
  name: string; onName: (value: string) => void;
  day: string; onDay: (value: string) => void;
  /** Spiega da dove viene la data proposta (es. "il giorno delle foto"). */
  dayHint?: string;
  categories: ReadonlyArray<{ key: string; label: string }>;
  categoryKey: string; onCategory: (value: string) => void;
  invalidName?: boolean; invalidDay?: boolean;
  issues: ReadonlyArray<{ message: string }>;
  onBack: () => void; onNext: () => void;
}) {
  return <StepFrame
    title="Come si chiama il lavoro?"
    description="Il nome del cliente o dell'evento: lo ritroverai in archivio con questo nome."
    recap={<PhotosRecap text={photosText} onChange={onChangePhotos} />}
    issues={issues}
    onBack={onBack}
    onNext={onNext}
    nextDisabled={!name.trim()}
    nextHint="Scrivi il nome del lavoro"
  >
    <div className="inline-grid inline-grid--2">
      <label className="field">
        <span>Nome del cliente o del lavoro</span>
        <input
          type="text" value={name} autoFocus placeholder="es. Maria Rossi Shooting"
          onChange={(event) => onName(event.target.value)}
          aria-invalid={invalidName || undefined}
          style={invalidName ? { borderColor: "var(--danger)" } : undefined}
        />
      </label>
      <label className="field">
        <span>Giorno del lavoro</span>
        <input type="date" value={day} onChange={(event) => onDay(event.target.value)} aria-invalid={invalidDay || undefined} style={invalidDay ? { borderColor: "var(--danger)" } : undefined} />
        {dayHint && <small className="wizard-note">{dayHint}</small>}
      </label>
    </div>
    {categories.length > 0 && <label className="field">
      <span>Tipo di lavoro <small style={{ color: "var(--text-muted)" }}>(sceglie in automatico la cartella giusta)</small></span>
      <select value={categoryKey} onChange={(event) => onCategory(event.target.value)}>
        <option value="">Nessuno: scelgo io la cartella</option>
        {categories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
      </select>
    </label>}
  </StepFrame>;
}
