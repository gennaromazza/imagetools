interface StepperProps {
  currentStep: "setup" | "studio";
  canProceed: boolean;
}

export function Stepper({ currentStep, canProceed }: StepperProps) {
  const steps = [
    {
      id: "setup",
      number: 1,
      label: "Setup Progetto",
      description: "Configura formato, foto e parametri",
      required: "Carica immagini"
    },
    {
      id: "studio",
      number: 2,
      label: "Studio Layout",
      description: "Modifica e esporta",
      required: "Completa setup"
    }
  ] as const;

  return (
    <div className="stepper" role="region" aria-label="Progresso progetto">
      <div className="stepper__track">
        {steps.map((step, index) => (
          <div key={step.id} className="stepper__step-wrapper">
            <div
              className={`stepper__step ${
                currentStep === step.id
                  ? "stepper__step--current"
                  : index < steps.findIndex((item) => item.id === currentStep)
                    ? "stepper__step--completed"
                    : "stepper__step--pending"
              }`}
              aria-current={currentStep === step.id ? "step" : undefined}
            >
              <span className="stepper__number">{step.number}</span>
              <div className="stepper__content">
                <strong>{step.label}</strong>
                <small>{step.description}</small>
              </div>
            </div>

            {index < steps.length - 1 ? (
              <div className="stepper__connector" aria-hidden="true" />
            ) : null}
          </div>
        ))}
      </div>

      {!canProceed && currentStep === "setup" ? (
        <div className="stepper__hint" role="status" aria-live="polite">
          Completa il setup minimo: {steps[0].required.toLowerCase()} per entrare nello studio.
        </div>
      ) : null}
    </div>
  );
}
