import { useState } from "react";

/** Interruzione in due tempi: prima si spiega cosa succede, poi si conferma. Nessuna perdita di foto già copiate. */
export function CancelImportView({ confirming, onAsk, onKeep, onConfirm }: { confirming: boolean; onAsk: () => void; onKeep: () => void; onConfirm: () => void }) {
  if (!confirming) return <button type="button" className="ghost-button" onClick={onAsk} style={{ padding: "0.5rem 0.8rem", fontSize: "0.84rem" }}>Interrompi importazione</button>;
  return <div className="cancel-confirm" role="alertdialog" aria-label="Interrompere l'importazione?">
    <p><strong>Vuoi fermarti?</strong> Le foto già copiate restano al loro posto, e rifacendo la stessa importazione salterò quelle già copiate.</p>
    <div className="button-row">
      <button type="button" className="secondary-button" onClick={onConfirm}>Sì, ferma</button>
      <button type="button" className="ghost-button" onClick={onKeep}>No, continua</button>
    </div>
  </div>;
}

export function CancelImport({ onCancel }: { onCancel: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return <CancelImportView confirming={confirming} onAsk={() => setConfirming(true)} onKeep={() => setConfirming(false)} onConfirm={() => { setConfirming(false); onCancel(); }} />;
}
