import { LayoutGrid, Ruler, Square } from "lucide-react";
import type { ReactNode } from "react";
import { PHOTO_COUNT_ASPECTS, PHOTO_PRESETS } from "../../print-engine";
import { MAX_PHOTO_EDGE_CM, MAX_PHOTOS_PER_PAGE, MIN_PHOTO_EDGE_CM, getPhotoPreset } from "../../print-planner";
import type { GoalKind, Workbench } from "../../hooks/useWorkbench";
import { Callout, NumberField, SelectField } from "../ui";

const QUICK_COUNTS = [1, 2, 3, 4, 6, 8, 9, 12];

const GOAL_CARDS: Array<{ kind: GoalKind; title: string; text: string; icon: ReactNode }> = [
  {
    kind: "count",
    title: "Più foto su ogni pagina",
    text: "Dimmi quante ne vuoi: calcolo io la misura più grande che ci sta.",
    icon: <LayoutGrid size={22} />,
  },
  {
    kind: "format",
    title: "Formato istantaneo",
    text: "Polaroid, Instax, Hi-Print: scegli il formato e ti consiglio la carta.",
    icon: <Square size={22} />,
  },
  {
    kind: "custom",
    title: "Misura personalizzata",
    text: "Decidi tu larghezza e altezza di ogni foto.",
    icon: <Ruler size={22} />,
  },
];

function formatCm(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

export function GoalStep({ wb }: { wb: Workbench }) {
  const selectedPreset = getPhotoPreset(wb.formatPresetId);

  return (
    <div className="slide">
      <header className="slide__intro">
        <h2>Che cosa vuoi stampare?</h2>
        <p>Scegli come vuoi decidere la misura delle foto. La carta la scegli al passo dopo, con i consigli.</p>
      </header>

      <div className="choice-grid" role="radiogroup" aria-label="Cosa vuoi stampare">
        {GOAL_CARDS.map((card) => (
          <button
            key={card.kind}
            type="button"
            role="radio"
            aria-checked={wb.goalKind === card.kind}
            className={wb.goalKind === card.kind ? "choice-card choice-card--active" : "choice-card"}
            onClick={() => wb.setGoalKind(card.kind)}
          >
            <span className="choice-card__icon">{card.icon}</span>
            <strong>{card.title}</strong>
            <span>{card.text}</span>
          </button>
        ))}
      </div>

      {wb.goalKind === "count" ? (
        <section className="slide__section">
          <h3>Quante foto su ogni pagina?</h3>
          <div className="chip-row" role="group" aria-label="Foto per pagina">
            {QUICK_COUNTS.map((value) => (
              <button key={value} type="button" className={wb.photosPerPage === value ? "chip chip--active" : "chip"} aria-pressed={wb.photosPerPage === value} onClick={() => wb.setCount(value)}>
                {value}
              </button>
            ))}
          </div>
          <div className="grid-two">
            <NumberField label="Un altro numero" value={wb.photosPerPage} min={1} max={MAX_PHOTOS_PER_PAGE} step={1} onChange={(value) => wb.setCount(value)} />
            <SelectField
              label="Proporzioni delle foto"
              value={wb.countAspectId}
              onChange={wb.setCountAspectId}
              options={PHOTO_COUNT_ASPECTS.map((aspect) => ({ value: aspect.id, label: aspect.label }))}
            />
          </div>
          <p className="slide__hint">
            «Libero» sfrutta tutto lo spazio; con un rapporto fisso (3:2, 1:1…) le foto restano proporzionate e possono lasciare un po' di bianco.
          </p>
        </section>
      ) : null}

      {wb.goalKind === "format" ? (
        <section className="slide__section">
          <h3>Scegli il formato</h3>
          <div className="format-grid" role="radiogroup" aria-label="Formato istantaneo">
            {PHOTO_PRESETS.map((preset) => {
              const active = wb.formatPresetId === preset.presetId;
              return (
                <button
                  key={preset.presetId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? "format-card format-card--active" : "format-card"}
                  onClick={() => wb.selectFormatPreset(preset.presetId)}
                >
                  <span
                    className="format-card__shape"
                    style={{ aspectRatio: `${preset.widthCm} / ${preset.heightCm}` }}
                    aria-hidden="true"
                  />
                  <strong>{preset.label.replace(/\s*\(.*\)$/, "")}</strong>
                  <span>{formatCm(preset.widthCm)} × {formatCm(preset.heightCm)} cm</span>
                </button>
              );
            })}
          </div>
          {selectedPreset ? (
            <Callout tone="info">{selectedPreset.description}</Callout>
          ) : (
            <p className="slide__hint">Seleziona un formato per continuare.</p>
          )}
        </section>
      ) : null}

      {wb.goalKind === "custom" ? (
        <section className="slide__section">
          <h3>Misura di ogni foto</h3>
          <div className="custom-size">
            <NumberField label="Larghezza" suffix="cm" value={wb.customSize.widthCm} min={MIN_PHOTO_EDGE_CM} max={MAX_PHOTO_EDGE_CM} step={0.1} onChange={(widthCm) => wb.setCustomPhotoSize({ widthCm })} />
            <span className="custom-size__x" aria-hidden="true">×</span>
            <NumberField label="Altezza" suffix="cm" value={wb.customSize.heightCm} min={MIN_PHOTO_EDGE_CM} max={MAX_PHOTO_EDGE_CM} step={0.1} onChange={(heightCm) => wb.setCustomPhotoSize({ heightCm })} />
            <span
              className="custom-size__shape"
              style={{ aspectRatio: `${wb.customSize.widthCm} / ${wb.customSize.heightCm}` }}
              aria-hidden="true"
            />
          </div>
          <p className="slide__hint">Al prossimo passo vedrai su quali carte questa misura entra e quante foto ci stanno.</p>
        </section>
      ) : null}

      {wb.goalValid && !wb.evaluations.some((evaluation) => evaluation.fits) ? (
        <Callout tone="warning">
          Con questa scelta le foto non entrano in nessuna carta standard. Riduci la misura, oppure al prossimo passo inserisci le misure della tua carta con «Altra misura».
        </Callout>
      ) : null}
    </div>
  );
}
