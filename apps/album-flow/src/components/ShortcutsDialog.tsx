import { useMemo, useState } from "react";
import { Modal, Segmented } from "./ui";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export const SHORTCUTS: Array<{ group: string; items: Array<[string, string]> }> = [
  { group: "Spread", items: [["← →", "Spread precedente / successivo"], ["Home · Fine", "Primo / ultimo spread"], ["↑ ↓", "Layout precedente / successivo per la pagina attiva"], ["1 – 9", "Applica uno dei primi nove layout"], [`${MOD}+D`, "Duplica lo spread"], ["F5", "Anteprima a tutto schermo per il cliente"]] },
  { group: "Foto nello spread", items: [["Clic", "Seleziona la foto"], ["Trascina sul centro di un'altra", "Scambia le due foto"], ["Trascina sul bordo di un'altra", "Inserisce accanto e ridisegna il layout"], ["Trascina sul bordo della pagina", "Nuova colonna o riga intera"], ["Trascina sulla linea tra due foto", "Si infila in mezzo"], ["Trascina sulla libreria", "Toglie la foto dallo spread"], ["Doppio clic · Invio", "Ritaglio: trascina e usa la rotella per lo zoom"], ["Alt + rotella sulla foto", "Zoom rapido, senza aprire il ritaglio"], ["Ctrl/⌘ + Alt + rotella", "Raddrizza la foto (Maiusc = passi fini)"], ["Alt + clic su Modo (Riempi / Foto intera)", "Cambia modo e ridisegna anche la disposizione"], ["Trascina un separatore", "Ridimensiona le foto (Alt = senza aggancio, doppio clic = riporta)"], ["Spazio", "Guarda la foto in grande"], ["L · Canc", "Blocca · rimuovi dallo spread"]] },
  { group: "Libreria", items: [["Clic · ⇧Clic · Ctrl/⌘Clic", "Seleziona una o più foto"], ["← ↑ → ↓", "Muoviti tra le foto (con la libreria attiva)"], ["Spazio", "Guarda in grande (poi ← → per scorrere)"], ["Invio · doppio clic", "Aggiungi all'area attiva e ridisegna"], ["0 – 5", "Stelle (scritte anche nel file XMP)"], ["K · P · M", "Copertina · panorama · principale"], ["Trascina su un capitolo", "Sposta le foto in quel capitolo"], [`${MOD}+A`, "Seleziona tutte le foto visibili"]] },
  { group: "Strumenti", items: [[`${MOD}+L`, "Stesso stile a sinistra e a destra"], ["B", "Mostra o nasconde tutti i layout possibili"], ["F", "Riempi le pagine vuote dello spread con le prossime foto non usate"], ["U", "Metti nell'area attiva la prossima foto non usata"], ["N", "Vai al prossimo spread con una pagina vuota"], ["D", "Segna lo spread come finito (Auto Build e Mescola non lo toccano)"], [`${MOD}+J`, "Mostra o nasconde la libreria"], [`${MOD}+B`, "Auto Build"], [`${MOD}+E`, "Esporta"], [`${MOD}+Z`, "Annulla"], [`${MOD}+⇧+Z · ${MOD}+Y`, "Ripeti"], ["+ / − · 0", "Ingrandisci / riduci / adatta la vista"], ["G", "Guide di margine"], ["S", "Mostra su ogni foto la misura stampata (cm) e la risoluzione"], ["?", "Questa guida"]] },
];

/** Passi consigliati per chi comincia: l'ordine di lavoro dall'importazione alla consegna. */
export const FIRST_STEPS: Array<{ title: string; text: string }> = [
  { title: "1. Importa le foto", text: "Premi «Importa» in basso a destra (o trascina una cartella sulla finestra). Puoi caricarne più di quante ne servono: poi scegli. Se nella cartella ci sono sottocartelle da non usare, togli la spunta." },
  { title: "2. Dai un nome ai capitoli", text: "I capitoli sono le sezioni dell'album (Casa sposo, Chiesa, Festa…). Premi «+ Capitolo» e scegli un gruppo pronto, oppure trascina le foto sulla scheda del capitolo." },
  { title: "3. Scegli con le stelle", text: "Clicca le stelle sotto una foto, oppure selezionala e premi un numero da 1 a 5. Con «Filtri» vedi solo le foto con quelle stelle, per esempio solo le ★5." },
  { title: "4. Lascia fare ad Auto Build", text: "Premi «Auto Build» (Ctrl/⌘+B): scegli quante foto per pagina vuoi e crea tutti gli spread. Poi ogni spread si può cambiare a mano." },
  { title: "5. Rifinisci spread per spread", text: "Usa le frecce ← → per scorrere. Premi ↑ ↓ per cambiare disposizione, trascina un separatore per ingrandire una foto. Quando uno spread ti piace premi D: nessuna funzione automatica lo cambierà più." },
  { title: "6. Mostra al cliente ed esporta", text: "F5 mostra l'album a tutto schermo. Con Ctrl/⌘+E controlli gli avvisi (pagine vuote, foto ripetute, bassa risoluzione) ed esporti in JPG per il laboratorio." },
];

/** Operazioni frequenti, ognuna con un esempio concreto. */
export const HOW_TO: Array<{ title: string; steps: string; example: string }> = [
  { title: "Aggiungere una foto allo spread", steps: "Trascina la miniatura dalla libreria sullo spread, oppure selezionala e premi Invio.", example: "Esempio: trascina la foto del bouquet sul bordo destro di una foto: finisce accanto, a destra." },
  { title: "Sostituire una foto", steps: "Trascina una foto dalla libreria sul CENTRO di una foto dello spread.", example: "Esempio: la foto sfocata in alto a sinistra viene rimpiazzata da quella nitida." },
  { title: "Scambiare due foto", steps: "Trascina una foto dello spread sul CENTRO di un'altra foto dello spread.", example: "Esempio: porti la foto dello sposo dalla pagina destra alla sinistra e quella della sposa va a destra." },
  { title: "Fare una colonna o una riga intera", steps: "Trascina la foto sul bordo esterno della pagina: il riquadro mostra dove finirà.", example: "Esempio: una verticale sul bordo sinistro diventa una colonna alta quanto la pagina." },
  { title: "Metterla tra due foto", steps: "Rilascia sulla linea sottile che separa due foto.", example: "Esempio: tra le due foto in alto ne inserisci una terza, e le altre si stringono." },
  { title: "Spostare una foto in un altro spread", steps: "Trascinala sulla miniatura dello spread in basso. Tra due miniature crea uno spread nuovo.", example: "Esempio: porti la foto dell'anello dallo spread 5 al 3: sparisce dal 5." },
  { title: "Cambiare la disposizione", steps: "↑ ↓ passano da un layout all'altro; B mostra tutti i layout possibili; Mescola prova una disposizione nuova.", example: "Esempio: premi B e clicca la terza miniatura per avere una foto grande e due piccole." },
  { title: "Ingrandire o ridurre una foto", steps: "Trascina il separatore tra due foto; doppio clic sul separatore lo riporta com'era.", example: "Esempio: allarghi la foto del bacio spostando il separatore verso la foto vicina." },
  { title: "Spostare il ritaglio dentro la foto", steps: "Doppio clic sulla foto, poi trascina per spostarla e usa la rotella per ingrandire. Per raddrizzare un orizzonte storto: Alt + rotella (Maiusc per i passi fini), il cursore «Raddrizza» nella barra, oppure i tasti , e . Esc chiude; 0 ripristina.", example: "Esempio: sposti l'inquadratura per non tagliare la testa di una persona." },
  { title: "Tenere uno spread com'è", steps: "Premi D (o «Segna come finito» nel menu azioni).", example: "Esempio: dopo aver rifinito lo spread 7, rifai Auto Build: lo spread 7 resta al suo posto." },
  { title: "Riempire in fretta uno spread vuoto", steps: "Premi F: usa le prossime foto non usate del capitolo. U ne aggiunge una sola; N salta al prossimo spread con pagine vuote.", example: "Esempio: aggiungi uno spread con «+», premi F e hai già 5 o 6 foto impaginate." },
  { title: "Vedere solo certe foto in libreria", steps: "Premi «Filtri»: stelle, etichetta del Selector, foto già usate o non usate.", example: "Esempio: «Non usate» + ★5 mostra le foto migliori che mancano nell'album." },
  { title: "Sapere quanto è grande ogni foto", steps: "Premi «Misure» (o S) sotto lo spread: su ogni foto compaiono le misure stampate in cm e i dpi reali. Verde = ottimo (240 dpi o più), giallo = da controllare (150-240), rosso = bassa (sotto 150).", example: "Esempio: una foto a tutta pagina con «23 × 30 cm · 180 dpi» è giallo: puoi tenerla, ma una più piccola verrebbe meglio." },
  { title: "Allineare le foto", steps: "Con «foto intera» le foto si allineano da sole (stessa altezza in una riga, stessa larghezza in una colonna). Per sistemare un layout vecchio o ritoccato a mano: menu azioni dello spread → «Allinea le foto».", example: "Esempio: due orizzontali impilate accanto a una verticale: dopo «Allinea» i bordi alti e bassi coincidono e non restano spazi laterali." },
  { title: "Cambiare il formato", steps: "Clicca le misure sotto il nome dell'album, in alto. Scrivi larghezza e altezza di UNA pagina: lo spread aperto è il doppio in larghezza.", example: "Esempio: 40 × 30 cm (pagina) → spread aperto 80 × 30 cm." },
  { title: "Disegnare un mio template", steps: "Apri i layout (B), premi «Disegna»: scegli «Divisioni» (foto affiancate) oppure «Libero» (foto che si sovrappongono, anche ruotate). Le celle verdi hanno proporzioni di foto comuni, quindi non vengono ritagliate.", example: "Esempio: libero con una foto grande 3:2 e due verticali 2:3 appoggiate sopra, leggermente ruotate. Dagli un nome e salva." },
  { title: "Usare i miei template", steps: "Con B vedi «I tuoi template» per lo stesso numero di foto della pagina: un clic li applica e le foto si mettono nella cella che le ritaglia meno. In Auto Build lascia attivo «Usa i miei template».", example: "Esempio: salvi un template per 3 foto; Auto Build lo usa in tutte le pagine da 3 foto dove si adatta." },
  { title: "Muovere le foto di un layout libero", steps: "Selezionala e trascinala per spostarla, trascina l'angolo per ridimensionarla (le proporzioni restano), usa ↺ ↻ per ruotarla e le frecce nella barra per portarla davanti o dietro.", example: "Esempio: porti davanti la foto più bella e la ruoti di 5° a destra." },
  { title: "Tornare indietro", steps: "Ctrl/⌘+Z annulla, Ctrl/⌘+Maiusc+Z ripete. Dopo molte azioni compare anche «Annulla» nell'avviso.", example: "Esempio: hai tolto per sbaglio una foto? Ctrl+Z e torna al suo posto." },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"start" | "how" | "keys">("start");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const match = (...texts: string[]) => !needle || texts.some((text) => text.toLocaleLowerCase().includes(needle));
  const how = useMemo(() => HOW_TO.filter((entry) => match(entry.title, entry.steps, entry.example)), [needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useMemo(() => SHORTCUTS.map((group) => ({ ...group, items: group.items.filter(([combo, description]) => match(combo, description, group.group)) })).filter((group) => group.items.length > 0), [needle]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="Guida" subtitle="Cosa fare, passo dopo passo, con esempi. Per riaprirla premi ? in qualsiasi momento." onClose={onClose} wide>
      <div className="help__bar">
        <Segmented label="Sezione della guida" value={tab} onChange={(value) => setTab(value)} options={[{ value: "start", label: "Primi passi" }, { value: "how", label: "Come si fa" }, { value: "keys", label: "Scorciatoie" }]} />
        {tab !== "start" ? <input className="input help__search" type="search" placeholder="Cerca (es. ritaglio, stelle, spostare)" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Cerca nella guida" /> : null}
      </div>
      {tab === "start" ? (
        <ol className="help__steps">
          {FIRST_STEPS.map((step) => <li key={step.title}><strong>{step.title}</strong><p>{step.text}</p></li>)}
        </ol>
      ) : null}
      {tab === "how" ? (
        <div className="help__how">
          {how.map((entry) => (
            <article key={entry.title} className="help__card">
              <h3>{entry.title}</h3>
              <p>{entry.steps}</p>
              <p className="help__example">{entry.example}</p>
            </article>
          ))}
          {how.length === 0 ? <p className="muted">Nessun risultato: prova con un'altra parola.</p> : null}
        </div>
      ) : null}
      {tab === "keys" ? (
        <div className="shortcuts">
          {keys.map((group) => (
            <section key={group.group}>
              <h3>{group.group}</h3>
              <dl>
                {group.items.map(([combo, description]) => (
                  <div key={combo}><dt><kbd>{combo}</kbd></dt><dd>{description}</dd></div>
                ))}
              </dl>
            </section>
          ))}
          {keys.length === 0 ? <p className="muted">Nessun risultato: prova con un'altra parola.</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}
