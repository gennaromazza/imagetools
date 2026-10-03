import { WIZARD_STEPS, canJumpToStep, type WizardStep } from "../wizardModel";

/** Indicatore "Passo 1 di 3": le schermate gia' superate sono cliccabili per tornare indietro. */
export function ImportStepper({ current, onGoTo, narrow }: { current: WizardStep; onGoTo?: (step: WizardStep) => void; /** Allineato alla colonna centrale delle schermate a domande. */ narrow?: boolean }) {
  return <nav className={`wizard-stepper${narrow ? " wizard-stepper--narrow" : ""}`} aria-label="Passi dell'importazione">
    <ol>
      {WIZARD_STEPS.map(({ step, title, hint }) => {
        const state = step === current ? "current" : step < current ? "done" : "todo";
        const clickable = Boolean(onGoTo) && canJumpToStep(current, step);
        const content = <>
          <span className="wizard-stepper__dot" aria-hidden="true">{state === "done" ? "✓" : step}</span>
          <span className="wizard-stepper__text"><strong>{title}</strong><small>{hint}</small></span>
        </>;
        return <li key={step} className={`wizard-stepper__item wizard-stepper__item--${state}`} aria-current={state === "current" ? "step" : undefined}>
          {clickable
            ? <button type="button" onClick={() => onGoTo!(step)} aria-label={`Torna al passo ${step}: ${title}`}>{content}</button>
            : <div>{content}</div>}
        </li>;
      })}
    </ol>
  </nav>;
}
