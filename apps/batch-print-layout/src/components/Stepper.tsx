import { Check } from "lucide-react";

export interface StepDefinition {
  id: string;
  label: string;
}

/** Barra dei passi: si può tornare indietro e saltare ai passi già raggiunti. */
export function Stepper({ steps, current, reachable, onGo }: {
  steps: StepDefinition[];
  current: number;
  /** Indice massimo selezionabile. */
  reachable: number;
  onGo: (index: number) => void;
}) {
  return (
    <nav aria-label="Passi" className="stepper">
      <ol>
        {steps.map((step, index) => {
          const state = index === current ? "current" : index < current ? "done" : "todo";
          const enabled = index <= reachable;
          return (
            <li key={step.id} className={`stepper__item stepper__item--${state}`}>
              <button
                type="button"
                onClick={() => onGo(index)}
                disabled={!enabled}
                aria-current={index === current ? "step" : undefined}
              >
                <span className="stepper__badge">{state === "done" ? <Check size={14} /> : index + 1}</span>
                <span className="stepper__label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
