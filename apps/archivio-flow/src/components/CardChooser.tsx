import { describeCard } from "../wizardModel";

interface CardLike { path: string; volumeName?: string; totalSize?: number }

/** Con più schede collegate si sceglie quale guardare: la scheda in uso resta evidenziata. */
export function CardChooser({ cards, activePath, onChoose }: { cards: readonly CardLike[]; activePath: string | null; onChoose: (path: string) => void }) {
  if (cards.length < 2) return null;
  return <div className="card-chooser" role="group" aria-label="Schede collegate">
    <span>Schede collegate:</span>
    {cards.map((card) => {
      const active = card.path.toLowerCase() === activePath?.toLowerCase();
      return <button key={card.path} type="button" className={`wizard-chip${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => { if (!active) onChoose(card.path); }}>{describeCard(card)}</button>;
    })}
  </div>;
}
