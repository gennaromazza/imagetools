import { useMemo } from "react";
import { buildCustomPaper, CUSTOM_PAPER_ID, evaluatePaper, type PaperEvaluation } from "../../print-planner";
import type { Workbench } from "../../hooks/useWorkbench";
import { Callout, Fold, NumberField, SegmentedField } from "../ui";
import { SheetThumb } from "../SheetThumb";

function formatCm(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

function PaperCard({ evaluation, selected, goalKind, onSelect }: {
  evaluation: PaperEvaluation;
  selected: boolean;
  goalKind: Workbench["goalKind"];
  onSelect: () => void;
}) {
  const { paper, fits, layout, photo, perPage } = evaluation;
  const classes = ["paper-card", selected ? "paper-card--active" : "", fits ? "" : "paper-card--disabled"].filter(Boolean).join(" ");
  return (
    <button type="button" role="radio" aria-checked={selected} className={classes} onClick={onSelect} disabled={!fits}>
      {evaluation.recommended ? <span className="paper-card__badge">Consigliata</span> : null}
      <div className="paper-card__thumb">
        {fits && layout ? <SheetThumb layout={layout} perPage={perPage} /> : <span className="paper-card__none">—</span>}
      </div>
      <strong>{paper.label}</strong>
      {fits && photo ? (
        <>
          <span className="paper-card__main">{perPage} foto per foglio</span>
          <span className="paper-card__sub">
            {goalKind === "count"
              ? `ogni foto ${formatCm(photo.widthCm)} × ${formatCm(photo.heightCm)} cm`
              : `occupa il ${Math.round(evaluation.coverage * 100)}% della carta`}
            {evaluation.sheetsNeeded > 0 ? ` · ${evaluation.sheetsNeeded} ${evaluation.sheetsNeeded === 1 ? "foglio" : "fogli"}` : ""}
          </span>
        </>
      ) : (
        <span className="paper-card__sub">La foto non entra su questa carta</span>
      )}
    </button>
  );
}

export function PaperStep({ wb }: { wb: Workbench }) {
  const { goal, paperChoice, dpi, printCount, evaluations } = wb;
  const customEvaluation = useMemo(
    () => evaluatePaper(goal, buildCustomPaper(paperChoice), paperChoice, { dpi, printCount }),
    [dpi, goal, paperChoice, printCount],
  );
  const selectedId = wb.paper.id;
  const selectedEvaluation = selectedId === CUSTOM_PAPER_ID ? customEvaluation : evaluations.find((evaluation) => evaluation.paper.id === selectedId);
  const advice = wb.orientationAdvice;
  const orientation = paperChoice.orientation;
  const printsPortrait = wb.layout.sheetWidthCm <= wb.layout.sheetHeightCm;

  let adviceText: string | null = null;
  let adviceTarget: "portrait" | "landscape" | null = null;
  if (advice && advice.best !== "equal") {
    const bestCount = advice.best === "portrait" ? advice.portraitCount : advice.landscapeCount;
    const otherCount = advice.best === "portrait" ? advice.landscapeCount : advice.portraitCount;
    const label = advice.best === "portrait" ? "in verticale" : "in orizzontale";
    adviceText = `Stampando ${label} ci stanno ${bestCount} foto per foglio invece di ${otherCount}.`;
    if (orientation !== "auto" && orientation !== advice.best) adviceTarget = advice.best;
  }

  return (
    <div className="slide">
      <header className="slide__intro">
        <h2>Su quale carta stampi?</h2>
        <p>
          {goal.kind === "count"
            ? "Ecco come diventano le foto su ogni carta. Scegli quella che hai in casa."
            : "Ho provato ogni carta: ti dico quante foto ci stanno e quale spreca meno. Puoi sempre scegliere un'altra misura."}
        </p>
      </header>

      <div className="paper-grid" role="radiogroup" aria-label="Carta">
        {evaluations.map((evaluation) => (
          <PaperCard
            key={evaluation.paper.id}
            evaluation={evaluation}
            selected={selectedId === evaluation.paper.id}
            goalKind={goal.kind}
            onSelect={() => wb.choosePaper(evaluation.paper.id)}
          />
        ))}

        <div className={selectedId === CUSTOM_PAPER_ID ? "paper-card paper-card--custom paper-card--active" : "paper-card paper-card--custom"}>
          <div className="paper-card__thumb">
            {customEvaluation.fits && customEvaluation.layout
              ? <SheetThumb layout={customEvaluation.layout} perPage={customEvaluation.perPage} />
              : <span className="paper-card__none">—</span>}
          </div>
          <strong>Altra misura</strong>
          <div className="paper-card__fields">
            <NumberField label="Larghezza cm" value={paperChoice.customWidthCm} min={2} max={120} step={0.1} onChange={(widthCm) => wb.setCustomPaperSize({ widthCm })} />
            <NumberField label="Altezza cm" value={paperChoice.customHeightCm} min={2} max={120} step={0.1} onChange={(heightCm) => wb.setCustomPaperSize({ heightCm })} />
          </div>
          <span className="paper-card__sub">
            {customEvaluation.fits
              ? `${customEvaluation.perPage} foto per foglio`
              : "La foto non entra in questa misura"}
          </span>
          {selectedId !== CUSTOM_PAPER_ID ? (
            <button type="button" className="secondary-button" onClick={() => wb.choosePaper(CUSTOM_PAPER_ID)}>Usa questa misura</button>
          ) : null}
        </div>
      </div>

      {!selectedEvaluation?.fits ? (
        <Callout tone="warning">
          La foto ({wb.printSpec.widthCm} × {wb.printSpec.heightCm} cm) non entra nella carta scelta con questi margini.
          {goal.kind === "custom" ? (
            <button type="button" className="link-button" onClick={wb.shrinkCustomGoalToPaper}>Riduci la foto per farla entrare</button>
          ) : " Scegli una carta più grande o riduci i margini."}
        </Callout>
      ) : null}

      <section className="slide__section">
        <h3>Come metti la carta?</h3>
        <SegmentedField
          value={orientation}
          onChange={(value) => wb.setOrientation(value as typeof orientation)}
          options={[
            { value: "auto", label: "Scegli tu per me" },
            { value: "portrait", label: "In verticale" },
            { value: "landscape", label: "In orizzontale" },
          ]}
        />
        <p className="slide__hint">
          {wb.ready
            ? <>Si stampa <strong>{printsPortrait ? "in verticale" : "in orizzontale"}</strong>: foglio {formatCm(wb.layout.sheetWidthCm)} × {formatCm(wb.layout.sheetHeightCm)} cm.</>
            : "Scegli una carta in cui la foto entra."}
        </p>
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
        <Fold title="Margini e distanze tra le foto">
          <div className="grid-two">
            <NumberField label="Margine esterno" suffix="mm" value={wb.sheet.marginMm} min={0} max={100} step={0.5} disabled={wb.paper.kind === "media"} onChange={wb.setMarginMm} />
            <NumberField label="Distanza tra foto" suffix="mm" value={wb.sheet.gapMm} min={0} max={100} step={0.5} disabled={wb.paper.kind === "media"} onChange={wb.setGapMm} />
          </div>
          <p className="slide__hint">
            Il margine è la distanza minima dal bordo della carta (molte stampanti non arrivano al bordo); la distanza è lo spazio vuoto tra due foto, utile per ritagliare.
            {wb.ready
              ? ` Margini effettivi: sinistra/destra ${((wb.layout.outerMarginLeftPx * 25.4) / wb.printSpec.dpi).toFixed(1)} / ${((wb.layout.outerMarginRightPx * 25.4) / wb.printSpec.dpi).toFixed(1)} mm · alto/basso ${((wb.layout.outerMarginTopPx * 25.4) / wb.printSpec.dpi).toFixed(1)} / ${((wb.layout.outerMarginBottomPx * 25.4) / wb.printSpec.dpi).toFixed(1)} mm.`
              : ""}
          </p>
        </Fold>
      </section>
    </div>
  );
}
