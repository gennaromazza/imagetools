import { Download, FolderOpen } from "lucide-react";
import type { ExportFormat } from "../../print-engine";
import type { Workbench } from "../../hooks/useWorkbench";
import { Callout, RangeField, SegmentedField, TextField } from "../ui";

function formatCm(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

export function ExportStep({ wb }: { wb: Workbench }) {
  const { printSpec, layout, pages } = wb;
  const unreviewed = Math.max(0, wb.assets.length - wb.reviewedCount);
  const supportsQuality = wb.format === "jpg" || wb.format === "pdf";

  return (
    <div className="slide slide--side">
      <header className="slide__intro">
        <h2>Pronto da stampare</h2>
        <p>Controlla il riepilogo, scegli il formato del file e salva.</p>
      </header>

      <dl className="summary-list">
        <div><dt>Foto</dt><dd>{wb.assets.length}{wb.copies > 1 ? ` × ${wb.copies} copie = ${wb.printCount} stampe` : ""}</dd></div>
        <div><dt>Misura di ogni foto</dt><dd>{formatCm(printSpec.widthCm)} × {formatCm(printSpec.heightCm)} cm</dd></div>
        <div><dt>Carta</dt><dd>{wb.paper.label} · {layout.sheetWidthCm <= layout.sheetHeightCm ? "verticale" : "orizzontale"}</dd></div>
        <div><dt>Foto per foglio</dt><dd>{wb.perPage}</dd></div>
        <div><dt>Fogli da stampare</dt><dd><strong>{pages.length}</strong></dd></div>
      </dl>

      {unreviewed > 0 ? (
        <Callout tone="info">{unreviewed} {unreviewed === 1 ? "foto non è stata controllata" : "foto non sono state controllate"} nel passo «Impagina». Puoi esportare lo stesso: userò l'inquadratura automatica.</Callout>
      ) : null}

      <section className="slide__section">
        <SegmentedField
          label="Formato del file"
          value={wb.format}
          onChange={(value) => wb.setFormat(value as ExportFormat)}
          options={[
            { value: "jpg", label: "JPG" },
            { value: "png", label: "PNG" },
            { value: "pdf", label: "PDF" },
            { value: "tif", label: "TIF" },
          ]}
        />
        <p className="slide__hint">
          {wb.format === "pdf" ? "Un solo PDF con tutti i fogli: comodo da mandare in stampa."
            : wb.format === "tif" ? "Massima qualità, file pesanti."
              : wb.format === "png" ? "Senza perdita di qualità, file più pesanti del JPG."
                : "Leggero e adatto a qualsiasi laboratorio di stampa."}
        </p>
        <SegmentedField
          label="Qualità di stampa"
          value={String(wb.dpi)}
          onChange={(value) => wb.setDpi(Number(value))}
          options={[
            { value: "150", label: "150 DPI · bozza" },
            { value: "300", label: "300 DPI · standard" },
            { value: "600", label: "600 DPI · massima" },
          ]}
        />
        {supportsQuality ? (
          <RangeField label="Compressione" value={Math.round(wb.quality * 100)} min={50} max={100} step={1} suffix="%" onChange={(value) => wb.setQuality(value / 100)} />
        ) : null}
        <TextField label="Nome dei file" value={wb.fileNamePrefix} onChange={wb.setFileNamePrefix} />
        <button type="button" className="wide-button" onClick={wb.chooseOutputFolder} disabled={!window.filexDesktop?.chooseOutputFolder}>
          <FolderOpen size={16} />
          {wb.outputDirectoryPath ? "Cambia cartella di destinazione" : "Scegli la cartella di destinazione"}
        </button>
        <p className="slide__hint">{wb.outputDirectoryPath ?? "Nel browser, più fogli vengono scaricati insieme in un file ZIP."}</p>
      </section>

      <button type="button" className="primary-button primary-button--large" onClick={wb.handleExport} disabled={wb.isBusy || !wb.ready || pages.length === 0}>
        <Download size={18} />
        {wb.isExporting ? "Esportazione in corso..." : `Esporta ${pages.length} ${pages.length === 1 ? "foglio" : "fogli"}`}
      </button>
    </div>
  );
}
