import { useState, type FormEvent } from "react";
import { ArrowRight, UserRound, Zap } from "lucide-react";
import { CUSTOMER_NAME_MAX } from "../order/model";

interface StartScreenProps {
  onCustomerOrder: (name: string) => void;
  onQuickJob: () => void;
}

export function StartScreen({ onCustomerOrder, onQuickJob }: StartScreenProps) {
  const [name, setName] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onCustomerOrder(name);
  };

  return (
    <main className="start">
      <p className="eyebrow">Nuovo lavoro</p>
      <h2>Come vuoi stampare queste foto?</h2>
      <p className="start__lead">Poi carichi le foto, scegli il formato, controlli i ritagli ed esporti.</p>

      <div className="start__choices">
        <form className="choice choice--main" onSubmit={submit}>
          <span className="choice__icon"><UserRound size={22} /></span>
          <h3>Ordine cliente</h3>
          <p>La cartella di esportazione porta il nome del cliente e la data.</p>
          <label htmlFor="customer-name">Nome del cliente</label>
          <input
            id="customer-name"
            value={name}
            maxLength={CUSTOMER_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mario Rossi"
            autoFocus
          />
          <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
            Crea ordine <ArrowRight size={16} />
          </button>
        </form>

        <section className="choice">
          <span className="choice__icon"><Zap size={22} /></span>
          <h3>Lavoro veloce</h3>
          <p>Senza nome: al momento di esportare scegli tu dove salvare.</p>
          <button type="button" className="btn" onClick={onQuickJob}>
            Inizia senza cliente <ArrowRight size={16} />
          </button>
        </section>
      </div>
    </main>
  );
}
