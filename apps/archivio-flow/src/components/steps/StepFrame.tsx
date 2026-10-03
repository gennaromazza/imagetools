import type { KeyboardEvent, ReactNode } from "react";

/** Cornice comune di ogni schermata del percorso: titolo, una sola domanda, messaggi e pulsanti Indietro/Avanti. */
export function StepFrame({ title, description, recap, issues, children, onBack, backLabel = "← Indietro", onNext, nextLabel = "Avanti →", nextDisabled, nextHint, hideNav, sticky, footer }: {
  title: string; description?: string;
  /** Riga di riepilogo in alto (es. "42 foto scelte · Cambia"). */
  recap?: ReactNode;
  issues?: ReadonlyArray<{ message: string }>;
  children: ReactNode;
  onBack?: () => void; backLabel?: string;
  onNext?: () => void; nextLabel?: string; nextDisabled?: boolean;
  /** Spiega perche' Avanti e' spento. */
  nextHint?: string;
  hideNav?: boolean; sticky?: boolean; footer?: ReactNode;
}) {
  /** Invio avanza, tranne su pulsanti, elenchi e aree di testo (dove ha gia' un altro significato). */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || event.defaultPrevented || !onNext || nextDisabled) return;
    const target = event.target as HTMLElement;
    if (["BUTTON", "TEXTAREA", "SELECT", "A", "SUMMARY"].includes(target.tagName) || target.isContentEditable) return;
    event.preventDefault();
    onNext();
  }
  return <div className="panel-section wizard-slide" style={{ padding: "var(--space-4)" }} onKeyDown={handleKeyDown}>
    <div className="stack">
      {recap}
      <div>
        <h3 className="wizard-title">{title}</h3>
        {description && <p className="import-step__description">{description}</p>}
      </div>
      {children}
      {issues && issues.length > 0 && <div className="message-box wizard-issues" role="alert">
        <strong>Manca ancora qualcosa:</strong>
        <ul>{issues.map((issue, index) => <li key={`${index}-${issue.message}`}>{issue.message}</li>)}</ul>
      </div>}
      {footer}
      {!hideNav && <div className={`wizard-nav${sticky ? " wizard-nav--sticky" : ""}`}>
        {onBack ? <button type="button" className="ghost-button" onClick={onBack}>{backLabel}</button> : <span />}
        {onNext && <div className="wizard-nav__next">
          {nextHint && nextDisabled && <small>{nextHint}</small>}
          <button type="button" className="primary-button" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>
        </div>}
      </div>}
    </div>
  </div>;
}

export function PhotosRecap({ text, onChange, hint }: { text: string; onChange: () => void; hint?: string }) {
  return <div className="wizard-recap">
    <span aria-hidden="true">📷</span>
    <div>
      <strong>{text}</strong>
      {hint && <small>{hint}</small>}
    </div>
    <button type="button" className="ghost-button" onClick={onChange}>Cambia foto</button>
  </div>;
}
