import { LayoutGrid, Ruler, Square } from "lucide-react";
import type { ReactNode } from "react";
import { getFrameGeometry, PHOTO_COUNT_ASPECTS } from "../../print-engine";
import { MAX_PHOTO_EDGE_CM, MAX_PHOTOS_PER_PAGE, MIN_PHOTO_EDGE_CM, getPhotoPreset } from "../../print-planner";
import type { GoalKind, Workbench } from "../../hooks/useWorkbench";
import { Callout, NumberField, SegmentedField, SelectField } from "../ui";

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
    text: "Polaroid, Instax, Hi-Print: ti dico quante ne entrano sulla tua carta.",
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
  const advice = wb.orientationAdvice;
  const orientation = wb.paperChoice.orientation;

  let adviceText: string | null = null;
  let adviceTarget: "portrait" | "landscape" | null = null;
  if (wb.ready && advice && advice.best !== "equal") {
    const bestCount = advice.best === "portrait" ? advice.portraitCount : advice.landscapeCount;
    const otherCount = advice.best === "portrait" ? advice.landscapeCount : advice.portraitCount;
    adviceText = `Stampando ${advice.best === "portrait" ? "in verticale" : "in orizzontale"} ci stanno ${bestCount} foto per foglio invece di ${otherCount}.`;
    if (orientation !== "auto" && orientation !== advice.best) adviceTarget = advice.best;
    else if (orientation === "auto") adviceText += " Ho scelto io l'orientamento migliore.";
  }

  return (
    <div className="slide">
      <header className="slide__intro">
        <h2>Che cosa stampi su {wb.paper.label}?</h2>
        <p>Scegli come vuoi decidere la misura delle foto: ti mostro sempre quante ne entrano su questa carta.</p>
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
          {wb.ready ? (
            <div className="result-card">
              <span>Ogni foto sarà</span>
              <strong>{formatCm(wb.printSpec.widthCm)} × {formatCm(wb.printSpec.heightCm)} cm</strong>
              <small>griglia {wb.layout.cols}×{wb.layout.rows} su {wb.paper.label}</small>
            </div>
          ) : null}
          <p className="slide__hint">
            «Libero» sfrutta tutto lo spazio; con un rapporto fisso (3:2, 1:1…) le foto restano proporzionate e possono lasciare un po' di bianco.
          </p>
        </section>
      ) : null}

      {wb.goalKind === "format" ? (
        <section className="slide__section">
          <h3>Scegli il formato</h3>
          <div className="format-grid" role="radiogroup" aria-label="Formato istantaneo">
            {wb.formatEvaluations.map(({ preset, evaluation }) => {
              const active = wb.formatPresetId === preset.presetId;
              const frame = getFrameGeometry(preset.frameStyle);
              const classes = ["format-card", active ? "format-card--active" : "", evaluation.fits ? "" : "format-card--off"].filter(Boolean).join(" ");
              return (
                <button
                  key={preset.presetId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={classes}
                  disabled={!evaluation.fits}
                  onClick={() => wb.selectFormatPreset(preset.presetId)}
                >
                  <span className={frame ? "format-card__shape format-card__shape--framed" : "format-card__shape"} style={{ aspectRatio: `${preset.widthCm} / ${preset.heightCm}` }} aria-hidden="true">
                    {frame ? (
                      <i
                        style={{
                          left: `${(frame.imageX / frame.outerWidth) * 100}%`,
                          top: `${(frame.imageY / frame.outerHeight) * 100}%`,
                          width: `${(frame.imageWidth / frame.outerWidth) * 100}%`,
                          height: `${(frame.imageHeight / frame.outerHeight) * 100}%`,
                        }}
                      />
                    ) : null}
                  </span>
                  <strong>{preset.label.replace(/\s*\(.*\)$/, "")}</strong>
                  <span>{formatCm(preset.widthCm)} × {formatCm(preset.heightCm)} cm</span>
                  <span className={evaluation.fits ? "format-card__count" : "format-card__none"}>
                    {evaluation.fits
                      ? `${evaluation.perPage} per foglio${evaluation.sheetsNeeded > 0 ? ` · ${evaluation.sheetsNeeded} ${evaluation.sheetsNeeded === 1 ? "foglio" : "fogli"}` : ""}`
                      : "Non entra in questa carta"}
                  </span>
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
            <span className="custom-size__shape" style={{ aspectRatio: `${wb.customSize.widthCm} / ${wb.customSize.heightCm}` }} aria-hidden="true" />
          </div>
          {wb.ready ? (
            <div className="result-card">
              <span>Su {wb.paper.label} ne entrano</span>
              <strong>{wb.perPage} per foglio</strong>
              <small>{wb.pages.length} {wb.pages.length === 1 ? "foglio" : "fogli"} per tutte le foto</small>
            </div>
          ) : (
            <Callout tone="warning">
              Questa misura non entra in {wb.paper.label} con i margini attuali.
              <button type="button" className="link-button" onClick={wb.shrinkCustomGoalToPaper}>Riduci la foto per farla entrare</button>
            </Callout>
          )}
        </section>
      ) : null}

      {wb.goalKind === "format" && wb.goalValid && !wb.ready ? (
        <Callout tone="warning">Questo formato non entra in {wb.paper.label}: scegline un altro oppure torna indietro e cambia carta.</Callout>
      ) : null}

      <section className="slide__section">
        <h3>Come riempire ogni foto?</h3>
        <SegmentedField
          value={wb.adjustments.fitMode}
          onChange={(value) => wb.handleFitModeChange(value as "cover" | "contain")}
          options={[
            { value: "cover", label: "Riempi e ritaglia" },
            { value: "contain", label: "Tutta la foto, senza ritaglio" },
          ]}
        />
        <p className="slide__hint">
          «Riempi» taglia l'eccedenza per coprire tutto lo spazio: trascina le foto sull'anteprima per scegliere l'inquadratura. «Tutta la foto» la mostra intera e lascia un bordo bianco dove serve.
        </p>
      </section>

      {adviceText ? (
        <Callout tone="advice">
          {adviceText}
          {adviceTarget ? (
            <button type="button" className="link-button" onClick={() => wb.setOrientation(adviceTarget!)}>
              Usa {adviceTarget === "portrait" ? "verticale" : "orizzontale"}
            </button>
          ) : null}
        </Callout>
      ) : null}

      {wb.paperSuggestion ? (
        <Callout tone="advice">
          Su {wb.paperSuggestion.label} ne entrerebbero {wb.paperSuggestion.perPage} per foglio invece di {wb.perPage}.
          <button type="button" className="link-button" onClick={() => wb.choosePaper(wb.paperSuggestion!.paperId)}>
            Usa {wb.paperSuggestion.label}
          </button>
        </Callout>
      ) : null}
    </div>
  );
}
