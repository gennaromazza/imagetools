import { useMemo, useRef, useState } from "react";
import { hasDesktop, revealInFolder } from "../desktop/api";
import type { Project } from "../model/project";
import { browserWriter, chooseDesktopWriter } from "../render/export";
import { carouselReport } from "../social/check";
import { exportCarousel } from "../social/export";
import { formatOf, type Carousel } from "../social/types";
import { Icon } from "./icons";
import { Field, Modal, Segmented } from "./ui";

/** Esportazione del carosello: controlli, dimensione, qualità e una immagine per slide. */
export function SocialExportDialog({ project, carousel, onClose, onStatus, onGoTo }: {
  project: Project;
  carousel: Carousel;
  onClose: () => void;
  onStatus: (message: string) => void;
  onGoTo: (slideIndex: number) => void;
}) {
  const report = useMemo(() => carouselReport(carousel, project), [carousel, project]);
  const [scale, setScale] = useState<"1" | "2">("1");
  const [quality, setQuality] = useState(92);
  const [withCaption, setWithCaption] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signal = useRef({ cancelled: false });
  const busy = progress !== null;
  const format = formatOf(carousel.format);
  const factor = Number(scale) as 1 | 2;
  const issues = report.issues.filter((issue) => issue.level !== "info" || report.issues.length < 8);

  async function run() {
    setError(null);
    signal.current = { cancelled: false };
    try {
      const writer = hasDesktop() ? await chooseDesktopWriter() : browserWriter();
      if (!writer) return;
      setProgress({ done: 0, total: carousel.slides.length });
      const result = await exportCarousel(project, carousel, writer, { scale: factor, quality: quality / 100, withCaption, signal: signal.current, onProgress: (done, total) => setProgress({ done, total }) });
      onStatus(signal.current.cancelled ? `Esportazione interrotta dopo ${result.count} slide.` : `${result.count} ${result.count === 1 ? "slide esportata" : "slide esportate"} (${writer.where()}). Caricale su Instagram nell'ordine dei numeri.`);
      if (result.written[0] && hasDesktop()) void revealInFolder(result.written[0]);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Esportazione non riuscita.");
      setProgress(null);
    }
  }

  return (
    <Modal
      title="Esporta il carosello"
      subtitle={`${carousel.name} · ${carousel.slides.length} slide · ${format.label}`}
      onClose={busy ? () => { signal.current.cancelled = true; } : onClose}
      wide
      footer={<>
        <button type="button" className="btn btn--ghost" onClick={busy ? () => { signal.current.cancelled = true; } : onClose}>{busy ? "Interrompi" : "Annulla"}</button>
        <button type="button" className="btn btn--primary" disabled={busy || report.errors > 0} onClick={() => void run()}><Icon name="export" size={16} /> Esporta {carousel.slides.length} immagini JPG</button>
      </>}
    >
      <section className="preflight" aria-label="Controlli prima dell'export">
        <h3>Controlli</h3>
        {issues.length === 0 ? <p className="ok-line"><Icon name="check" size={15} /> Tutto in ordine: ogni slide ha le sue foto e il numero di slide è valido.</p> : (
          <ul>
            {issues.slice(0, 30).map((issue, index) => (
              <li key={index} className={issue.level}>
                <Icon name={issue.level === "error" ? "close" : issue.level === "warning" ? "warning" : "info"} size={14} />
                <span>{issue.message}</span>
                {issue.slideIndex !== undefined ? <button type="button" className="link-btn" onClick={() => { onGoTo(issue.slideIndex!); onClose(); }}>Vai</button> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="export-options">
        <Field label="Dimensione" hint={`${format.width * factor} × ${format.height * factor} px per slide. ${factor === 1 ? "È la misura che Instagram usa." : "Il doppio: per archivio o stampa."}`}>
          <Segmented label="Dimensione" value={scale} onChange={setScale} options={[{ value: "1", label: "Instagram (1080 px)" }, { value: "2", label: "Doppia (2160 px)" }]} />
        </Field>
        <Field label={`Qualità JPG ${quality}%`}>
          <input type="range" min={70} max={100} step={1} value={quality} onChange={(event) => setQuality(Number(event.target.value))} aria-label="Qualità JPG" />
        </Field>
        <label className="switch social-switch">
          <input type="checkbox" checked={withCaption} onChange={(event) => setWithCaption(event.target.checked)} disabled={!carousel.caption.trim()} />
          <span className="switch__track" aria-hidden="true"><span className="switch__thumb" /></span>
          <span>{carousel.caption.trim() ? "Salva anche il testo del post in un file" : "Nessun testo del post da salvare"}</span>
        </label>
      </div>
      {progress ? (
        <div className="progress" role="status" aria-live="polite">
          <div className="progress__bar"><span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
          <span className="muted small">Slide {progress.done} di {progress.total}…</span>
        </div>
      ) : null}
      {error ? <p className="notice notice--warn">{error}</p> : null}
    </Modal>
  );
}
