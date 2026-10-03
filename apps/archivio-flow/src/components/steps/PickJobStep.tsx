import type { Job } from "../../types";
import { JobPicker } from "../JobPicker";
import { PhotosRecap, StepFrame } from "./StepFrame";

export function PickJobStep({ photosText, onChangePhotos, jobs, selectedId, query, onQueryChange, onPick, invalid, issues, onBack, onNext }: {
  photosText: string; onChangePhotos: () => void;
  jobs: Job[]; selectedId: string; query: string; invalid?: boolean;
  onQueryChange: (value: string) => void; onPick: (job: Job) => void;
  issues: ReadonlyArray<{ message: string }>;
  onBack: () => void; onNext: () => void;
}) {
  return <StepFrame
    title="A quale lavoro vanno aggiunte?"
    description="Cerca per nome del cliente o per data, poi tocca il lavoro giusto."
    recap={<PhotosRecap text={photosText} onChange={onChangePhotos} />}
    issues={issues}
    onBack={onBack}
    onNext={onNext}
    nextDisabled={!selectedId}
    nextHint="Scegli un lavoro dall'elenco"
  >
    <JobPicker jobs={jobs} selectedId={selectedId} query={query} invalid={invalid} onQueryChange={onQueryChange} onPick={onPick} />
  </StepFrame>;
}
