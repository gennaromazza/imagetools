import type { WhatsNewRelease } from "../model/whatsNew";
import { Modal } from "./ui";

/** «Novità»: elenco di cosa è cambiato con i nomi esatti dei pulsanti dove trovare ogni funzione. */
export function WhatsNewDialog({ releases, onClose }: { releases: readonly WhatsNewRelease[]; onClose: () => void }) {
  const newest = releases[releases.length - 1];
  if (!newest) return null;
  const ordered = [...releases].reverse();
  return (
    <Modal
      title={`Novità di Album Flow ${newest.version}`}
      subtitle={ordered.length > 1 ? `Dalla versione che usavi: ${ordered.length} aggiornamenti` : newest.headline}
      onClose={onClose}
      wide
      footer={<button type="button" className="btn btn--primary" onClick={onClose} autoFocus>Ho capito</button>}
    >
      <div className="whatsnew">
        {ordered.map((release) => (
          <section key={release.version} className="whatsnew__release" aria-label={`Versione ${release.version}`}>
            {ordered.length > 1 ? <h3>Versione {release.version} <small className="muted">· {release.headline}</small></h3> : null}
            <ul className="whatsnew__list">
              {release.items.map((item) => (
                <li key={item.title} className="whatsnew__item">
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                  {item.where?.length ? (
                    <p className="whatsnew__where"><span className="muted small">Dove:</span> {item.where.map((place) => <kbd key={place}>{place}</kbd>)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
