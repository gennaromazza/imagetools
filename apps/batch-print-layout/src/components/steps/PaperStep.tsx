import { CUSTOM_PAPER_ID, getMediaPapers, getStandardPapers, type PaperOption } from "../../print-planner";
import type { Workbench } from "../../hooks/useWorkbench";
import { Fold, NumberField, SegmentedField } from "../ui";

function formatCm(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

/** Sagoma proporzionata della carta, per riconoscerla a colpo d'occhio. */
function PaperShape({ widthCm, heightCm }: { widthCm: number; heightCm: number }) {
  const longEdge = Math.max(widthCm, heightCm, 1);
  const width = (Math.min(widthCm, heightCm) / longEdge) * 100;
  const height = 100;
  return (
    <svg className="sheet-thumb" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={2} className="sheet-thumb__paper" />
    </svg>
  );
}

function PaperCard({ paper, selected, onSelect }: { paper: PaperOption; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={selected ? "paper-card paper-card--active" : "paper-card"} onClick={onSelect}>
      <div className="paper-card__thumb"><PaperShape widthCm={paper.widthCm} heightCm={paper.heightCm} /></div>
      <strong>{paper.label}</strong>
      <span className="paper-card__sub">
        {formatCm(Math.min(paper.widthCm, paper.heightCm))} × {formatCm(Math.max(paper.widthCm, paper.heightCm))} cm
        {paper.kind === "media" ? " · una foto per foglio" : ""}
      </span>
    </button>
  );
}

export function PaperStep({ wb }: { wb: Workbench }) {
  const { paperChoice } = wb;
  const standard = getStandardPapers();
  const media = getMediaPapers();
  const selectedId = wb.paper.id;
  const printsPortrait = wb.layout.sheetWidthCm <= wb.layout.sheetHeightCm;

  return (
    <div className="slide">
      <header className="slide__intro">
        <h2>Su quale carta stampi?</h2>
        <p>Scegli la carta che hai a disposizione. Al prossimo passo ti propongo i formati che ci stanno e quante foto per foglio.</p>
      </header>

      <div className="paper-grid" role="radiogroup" aria-label="Carta">
        {standard.map((paper) => (
          <PaperCard key={paper.id} paper={paper} selected={selectedId === paper.id} onSelect={() => wb.choosePaper(paper.id)} />
        ))}

        <div className={selectedId === CUSTOM_PAPER_ID ? "paper-card paper-card--custom paper-card--active" : "paper-card paper-card--custom"}>
          <div className="paper-card__thumb"><PaperShape widthCm={paperChoice.customWidthCm} heightCm={paperChoice.customHeightCm} /></div>
          <strong>Altra misura</strong>
          <div className="paper-card__fields">
            <NumberField label="Larghezza cm" value={paperChoice.customWidthCm} min={2} max={120} step={0.1} onChange={(widthCm) => wb.setCustomPaperSize({ widthCm })} />
            <NumberField label="Altezza cm" value={paperChoice.customHeightCm} min={2} max={120} step={0.1} onChange={(heightCm) => wb.setCustomPaperSize({ heightCm })} />
          </div>
          {selectedId !== CUSTOM_PAPER_ID ? (
            <button type="button" className="secondary-button" onClick={() => wb.choosePaper(CUSTOM_PAPER_ID)}>Usa questa misura</button>
          ) : null}
        </div>
      </div>

      {media.length > 0 ? (
        <section className="slide__section">
          <h3>Carta per stampanti istantanee</h3>
          <div className="paper-grid" role="radiogroup" aria-label="Carta istantanea">
            {media.map((paper) => (
              <PaperCard key={paper.id} paper={paper} selected={selectedId === paper.id} onSelect={() => wb.choosePaper(paper.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="slide__section">
        <h3>Come metti la carta?</h3>
        <SegmentedField
          value={paperChoice.orientation}
          onChange={(value) => wb.setOrientation(value as typeof paperChoice.orientation)}
          options={[
            { value: "auto", label: "Scegli tu per me" },
            { value: "portrait", label: "In verticale" },
            { value: "landscape", label: "In orizzontale" },
          ]}
        />
        <p className="slide__hint">
          {paperChoice.orientation === "auto"
            ? "Con «Scegli tu per me» il programma userà l'orientamento che fa entrare più foto e te lo dirà."
            : <>Si stampa <strong>{printsPortrait ? "in verticale" : "in orizzontale"}</strong>: foglio {formatCm(wb.layout.sheetWidthCm)} × {formatCm(wb.layout.sheetHeightCm)} cm.</>}
        </p>
        <Fold title="Margini e distanze tra le foto">
          <div className="grid-two">
            <NumberField label="Margine esterno" suffix="mm" value={wb.sheet.marginMm} min={0} max={100} step={0.5} disabled={wb.paper.kind === "media"} onChange={wb.setMarginMm} />
            <NumberField label="Distanza tra foto" suffix="mm" value={wb.sheet.gapMm} min={0} max={100} step={0.5} disabled={wb.paper.kind === "media"} onChange={wb.setGapMm} />
          </div>
          <p className="slide__hint">
            Il margine è la distanza minima dal bordo della carta (molte stampanti non arrivano al bordo); la distanza è lo spazio vuoto tra due foto, utile per ritagliare.
          </p>
        </Fold>
      </section>
    </div>
  );
}
