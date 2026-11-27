import type { FileSyncChoice, FileSyncQuestion } from "../hooks/useFileSync";
import { Modal } from "./ui";

interface Copy { title: string; text: string; buttons: ReadonlyArray<{ choice: FileSyncChoice; label: string; primary?: boolean; danger?: boolean }> }

const COPY: Record<FileSyncQuestion["kind"], (name: string) => Copy> = {
  exit: () => ({
    title: "Salvare sul file prima di chiudere?",
    text: "Hai fatto modifiche che non sono ancora nel file dell'album. Se non salvi restano solo su questo PC.",
    buttons: [{ choice: "cancel", label: "Annulla" }, { choice: "discard", label: "Non salvare" }, { choice: "save", label: "Salva", primary: true }],
  }),
  overwrite: () => ({
    title: "Il file è stato cambiato da un altro PC",
    text: "Dall'ultima volta che l'hai aperto qui, un altro PC ha salvato una versione nuova. Sovrascrivendo, quella versione si perde.",
    buttons: [{ choice: "cancel", label: "Annulla" }, { choice: "load", label: "Carica la sua versione" }, { choice: "overwrite", label: "Sovrascrivi", danger: true }],
  }),
  replace: (name) => ({
    title: "Sostituire il file?",
    text: `Nella cartella c'è già «${name}».`,
    buttons: [{ choice: "cancel", label: "Annulla" }, { choice: "overwrite", label: "Sostituisci", danger: true }],
  }),
  load: (name) => ({
    title: "C'è una versione più nuova",
    text: `Un altro PC ha salvato «${name}» sul file dopo l'ultima volta che l'hai aperto qui.`,
    buttons: [{ choice: "keep", label: "Tieni questa" }, { choice: "load", label: "Carica", primary: true }],
  }),
  "load-losing": (name) => ({
    title: "C'è una versione diversa nel file",
    text: `Il file di «${name}» è diverso dall'album di questo PC, che ha modifiche non salvate sul file. Caricando il file, quelle modifiche si perdono.`,
    buttons: [{ choice: "cancel", label: "Annulla" }, { choice: "keep", label: "Tieni questa" }, { choice: "load", label: "Carica il file", danger: true }],
  }),
};

/** Domande del collegamento al file: uscita, sovrascrittura, versione più nuova salvata da un altro PC. */
export function FileSyncDialog({ question }: { question: FileSyncQuestion }) {
  const copy = COPY[question.kind](question.name);
  const close = () => question.answer(question.kind === "load" ? "keep" : "cancel");
  return (
    <Modal title={copy.title} onClose={close} footer={<>
      {copy.buttons.map((button) => (
        <button key={button.choice} type="button" className={`btn${button.primary ? " btn--primary" : ""}${button.danger ? " btn--danger" : ""}`} onClick={() => question.answer(button.choice)}>{button.label}</button>
      ))}
    </>}>
      <p>{copy.text}</p>
    </Modal>
  );
}
