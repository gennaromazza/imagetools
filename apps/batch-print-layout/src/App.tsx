import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useWorkbench } from "./hooks/useWorkbench";
import { Stepper, type StepDefinition } from "./components/Stepper";
import { SheetPreview } from "./components/SheetPreview";
import { PhotosStep } from "./components/steps/PhotosStep";
import { GoalStep } from "./components/steps/GoalStep";
import { PaperStep } from "./components/steps/PaperStep";
import { LayoutControls, PhotoEditor } from "./components/steps/LayoutStep";
import { ExportStep } from "./components/steps/ExportStep";

const STEPS: StepDefinition[] = [
  { id: "photos", label: "Foto" },
  { id: "paper", label: "Carta" },
  { id: "goal", label: "Cosa stampi" },
  { id: "layout", label: "Impagina" },
  { id: "export", label: "Esporta" },
];
const LAST_STEP = STEPS.length - 1;

const PREVIEW_CAPTIONS: Record<string, string> = {
  paper: "Anteprima di esempio sulla carta scelta (4 foto per pagina). Al prossimo passo decidi cosa stampare.",
  goal: "Anteprima di esempio. Inquadratura, margini e ritocchi si sistemano al passo «Impagina».",
};

export function App() {
  const wb = useWorkbench();
  const [step, setStep] = useState(0);

  // Ogni passo si sblocca quando il precedente è completo.
  const gates = [
    { ok: wb.assets.length > 0, hint: "Scegli almeno una foto per continuare." },
    { ok: true, hint: "" },
    { ok: wb.goalValid && wb.ready, hint: !wb.goalValid ? (wb.goalKind === "format" ? "Scegli un formato per continuare." : "Inserisci una misura valida per continuare.") : "La foto non entra nella carta: scegli un altro formato o cambia carta." },
    { ok: true, hint: "" },
    { ok: wb.ready, hint: "" },
  ];
  const firstClosedGate = gates.findIndex((gate) => !gate.ok);
  const reachable = firstClosedGate === -1 ? LAST_STEP : firstClosedGate;
  const current = Math.min(step, reachable);
  const stepId = STEPS[current].id;
  const gate = gates[current];

  const goTo = (index: number) => {
    wb.setStatus("");
    setStep(Math.max(0, Math.min(index, reachable)));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Print Flow</h1>
          <span>Più stampe su ogni foglio, senza sprechi di carta</span>
        </div>
        <Stepper steps={STEPS} current={current} reachable={reachable} onGo={goTo} />
      </header>

      <input ref={wb.fileInputRef} type="file" accept="image/*" multiple className="hidden-input" onChange={wb.handleFilesSelected} />
      <input ref={wb.logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden-input" onChange={wb.handleLogoSelected} />

      {stepId === "photos" ? (
        <main className="body body--single">
          <PhotosStep wb={wb} />
        </main>
      ) : (
        <main className="body body--split">
          <aside className="panel">
            {stepId === "goal" ? <GoalStep wb={wb} /> : null}
            {stepId === "paper" ? <PaperStep wb={wb} /> : null}
            {stepId === "layout" ? <LayoutControls wb={wb} /> : null}
            {stepId === "export" ? <ExportStep wb={wb} /> : null}
          </aside>
          <section className="stage">
            <SheetPreview wb={wb} interactive={stepId === "layout"} caption={PREVIEW_CAPTIONS[stepId]} />
            {stepId === "layout" ? <PhotoEditor wb={wb} /> : null}
          </section>
        </main>
      )}

      <footer className="footer">
        <p className="footer__status" role="status" aria-live="polite">
          {wb.isBusy || gate.ok || current === LAST_STEP ? wb.status : gate.hint}
        </p>
        <div className="footer__nav">
          <button type="button" className="secondary-button" onClick={() => goTo(current - 1)} disabled={current === 0 || wb.isBusy}>
            <ArrowLeft size={16} />
            Indietro
          </button>
          {current < LAST_STEP ? (
            <button type="button" className="primary-button" onClick={() => goTo(current + 1)} disabled={!gate.ok || wb.isBusy} title={gate.ok ? undefined : gate.hint}>
              Continua
              <ArrowRight size={16} />
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
