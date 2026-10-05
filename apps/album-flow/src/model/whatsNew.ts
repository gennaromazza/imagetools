/**
 * «Novità»: dopo un aggiornamento Album Flow mostra cosa è cambiato, indicando dove trovare ogni funzione nuova.
 * Ogni release di Album Flow deve aggiungere qui la sua voce (lo controlla `npm run test:album-flow-system`).
 */

export interface WhatsNewItem {
  title: string;
  text: string;
  /** Nomi esatti dei pulsanti, caselle o scorciatoie dove si trova la funzione: compaiono come etichette. */
  where?: readonly string[];
}

export interface WhatsNewRelease {
  version: string;
  /** Giorno della release, AAAA-MM-GG. */
  date: string;
  headline: string;
  items: readonly WhatsNewItem[];
}

/** Dal più recente al più vecchio. */
export const WHATS_NEW: readonly WhatsNewRelease[] = [
  {
    version: "0.2.6",
    date: "2026-10-05",
    headline: "La cella segue la forma della foto",
    items: [
      {
        title: "Cella e forma vanno d'accordo",
        text: "Quando dai una forma a una foto, la sua cella prende quella proporzione e le altre foto si adattano; se il layout attuale non lo permette, il programma passa a uno che lo permette. Se la cella ha già quasi la forma scelta, la foto la riempie senza fasce bianche, anche con Riempi.",
        where: ["Menu Forma", "MODO"],
      },
      {
        title: "La forma segue la foto",
        text: "Spostando una foto in un altro spread o in uno nuovo, la forma resta con lei. «Ripristina ritaglio, zoom e forma» (tasto 0) la toglie.",
        where: ["Trascinamento tra gli spread", "tasto 0"],
      },
    ],
  },
  {
    version: "0.2.5",
    date: "2026-10-05",
    headline: "I layout tengono conto della forma delle foto",
    items: [
      {
        title: "Layout calcolati con la forma scelta",
        text: "Se tagli una foto orizzontale in verticale con il menu Forma, i layout proposti la trattano come verticale: Mescola, le frecce, i tasti 1-9 e il browser dei layout scelgono disposizioni adatte alla forma che hai dato.",
        where: ["Menu Forma", "Mescola", "Browser dei layout"],
      },
    ],
  },
  {
    version: "0.2.4",
    date: "2026-10-05",
    headline: "Riempi gli spazi bianchi senza cambiare la disposizione",
    items: [
      {
        title: "Modo: tieni la disposizione o ridisegnala",
        text: "Un clic su Modo (Riempi / Foto intera) cambia il modo e tiene la disposizione, riempiendo solo gli spazi bianchi. Con Alt + clic il programma ridisegna anche la disposizione migliore per il nuovo modo.",
        where: ["MODO", "Alt + clic su MODO"],
      },
    ],
  },
  {
    version: "0.2.3",
    date: "2026-10-05",
    headline: "Forma di ogni foto, zoom e raddrizzamento con la rotella",
    items: [
      {
        title: "Cambia la forma di una foto",
        text: "Una foto orizzontale può diventare quadrata, verticale o panoramica senza cambiare il layout: la foto prende la proporzione scelta dentro la sua cella. Zoom, spostamento e raddrizzamento valgono dentro quella forma; «Ripristina ritaglio e zoom» la toglie.",
        where: ["Barra della foto", "menu Forma"],
      },
      {
        title: "Zoom e raddrizzamento senza aprire il ritaglio",
        text: "Alt + rotella sulla foto la ingrandisce direttamente nel suo spazio. Ctrl/⌘ + Alt + rotella la raddrizza (con Maiusc a passi più fini) e la foto si ingrandisce da sola quanto serve per coprire lo spazio.",
        where: ["Alt + rotella", "Ctrl/⌘ + Alt + rotella"],
      },
      {
        title: "Ritaglio anche in «Foto intera»",
        text: "Non serve più passare a «Riempi» per ritagliare, ingrandire o raddrizzare: la foto modificata riempie la sua cella e le altre restano intere. Passando tra «Riempi» e «Foto intera» la disposizione resta la stessa.",
        where: ["MODO", "Doppio clic sulla foto"],
      },
      {
        title: "Anteprima del trascinamento più fedele",
        text: "In «Foto intera», trascinando una foto il riquadro mostra lo spazio che occuperà davvero, non un'enorme striscia. Dopo avere trascinato foto dalla libreria la selezione si azzera, così il trascinamento successivo porta solo la foto scelta.",
        where: ["Trascinamento delle foto"],
      },
    ],
  },
  {
    version: "0.2.2",
    date: "2026-10-03",
    headline: "Il logo torna nella Home",
    items: [
      {
        title: "Corretto: logo di Album Flow nella Home",
        text: "Nel programma installato il logo in alto nella Home non si vedeva (compariva solo una cornice vuota). Ora il logo è sempre visibile.",
        where: ["Home"],
      },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-10-03",
    headline: "Anteprima intera nella libreria, finestra Novità e barra della foto sempre visibile",
    items: [
      {
        title: "Foto intera al passaggio del mouse",
        text: "Le miniature della libreria sono in un riquadro fisso e le foto verticali o i panorami restano piccoli. Fermando il mouse su una miniatura per un istante compare la foto completa, più grande, con nome e dimensioni. Sparisce quando sposti il mouse, scorri o trascini.",
        where: ["Libreria in basso", "mouse sopra la miniatura"],
      },
      {
        title: "Novità dopo ogni aggiornamento",
        text: "Dopo un aggiornamento questa finestra elenca cosa è cambiato e dove trovarlo. I pulsanti nuovi portano l'etichetta «Nuovo» finché non li apri una volta. Puoi rivederla quando vuoi dalla Home.",
        where: ["Novità (Home)", "etichetta Nuovo"],
      },
      {
        title: "Corretto: barra della foto coperta dal testo",
        text: "Con un testo sopra una foto, il doppio clic sulla foto apriva la barra (Raddrizza, anteprima, blocco) ma il testo la copriva. Ora la barra sta sempre in primo piano.",
        where: ["Doppio clic sulla foto"],
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-03",
    headline: "Raddrizza le foto, componi come una rivista e metti al sicuro il progetto",
    items: [
      {
        title: "Raddrizza l'orizzonte",
        text: "Nel ritaglio puoi ruotare la foto fino a 45° con una griglia a terzi per allinearla. L'ingrandimento sale da solo per non lasciare angoli vuoti.",
        where: ["Doppio clic sulla foto", "cursore «Raddrizza»", "Alt + rotella", "tasti , e ."],
      },
      {
        title: "Personalizza: sfondi a immagine",
        text: "Sfondi di serie o caricati da te, su tutto lo spread o su una sola pagina. Puoi adattarli, ripeterli a piastrella, regolarne la visibilità e applicarli a tutto l'album.",
        where: ["Personalizza", "scheda Sfondi"],
      },
      {
        title: "Personalizza: testi in stile rivista",
        text: "Testata, titolo, occhiello, testo con capolettera, citazione, didascalia, firma. Gli stili con più parti (come «Titolo») creano più box già agganciati: si spostano insieme, e con «Sgancia» ognuno torna libero. Maiusc o Ctrl + clic per riagganciarli. Con il pannello aperto le foto restano ferme.",
        where: ["Personalizza", "scheda Testo", "Sgancia", "Aggancia insieme"],
      },
      {
        title: "Quindici font open source",
        text: "Bodoni Moda, Playfair Display, Cormorant Garamond, Jost, Pinyon Script e altri, tutti inclusi e con licenza libera: il testo esce uguale in stampa. Il colore si adatta allo sfondo della pagina perché si legga.",
        where: ["Personalizza", "scheda Testo", "Carattere"],
      },
      {
        title: "La tua libreria di frasi, stili e grafiche",
        text: "Un archivio personale valido per tutti gli album: frasi da riusare, stili di testo salvati con un nome, ornamenti e logo in PNG o SVG.",
        where: ["Personalizza", "scheda Libreria"],
      },
      {
        title: "Backup su Google Drive",
        text: "Salvi il solo progetto (mai le foto) e lo riapri da un altro computer come copia, senza toccare l'album che hai. Dalla Home puoi attivare il backup automatico quando chiudi il programma.",
        where: ["Drive", "Backup su Drive alla chiusura (Home)"],
      },
      {
        title: "Ricollega le foto",
        text: "Se apri l'album su un altro computer o sposti le cartelle, le foto non trovate vengono segnalate: scegli la nuova cartella e vengono ritrovate per percorso, nome e dimensione, senza indovinare tra nomi doppi.",
        where: ["N foto non trovate · Ricollega"],
      },
      {
        title: "Anteprima grande più comoda",
        text: "Con Spazio la foto si apre sempre intera. Rotella, + e − per ingrandire, «1:1» per i pixel reali e trascinamento per spostarti: serve solo a guardare, il foglio non cambia.",
        where: ["Spazio", "1:1"],
      },
    ],
  },
];

const parse = (version: string): number[] => version.split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);

/** Confronto tra versioni «X.Y.Z»: negativo se a < b. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Versione di riferimento per chi aggiorna senza che il programma ricordi quale usava: la prima uscita. */
export const BASELINE_VERSION = "0.1.0";

/** Voci da mostrare a chi passa da `lastSeen` a `current` (tutte quelle in mezzo), dalla più vecchia alla più recente. */
export function releasesToShow(lastSeen: string | null, current: string, releases: readonly WhatsNewRelease[] = WHATS_NEW): WhatsNewRelease[] {
  const from = lastSeen ?? BASELINE_VERSION;
  return releases
    .filter((release) => compareVersions(release.version, from) > 0 && compareVersions(release.version, current) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Si mostrano le novità solo a chi ha già usato il programma: al primo avvio assoluto (nessuna versione ricordata e
 * nessun album) non c'è nulla di «nuovo» da raccontare.
 */
export function shouldShowWhatsNew(lastSeen: string | null, current: string, hasAlbums: boolean, releases: readonly WhatsNewRelease[] = WHATS_NEW): boolean {
  if (lastSeen === current) return false;
  if (lastSeen === null && !hasAlbums) return false;
  return releasesToShow(lastSeen, current, releases).length > 0;
}

export const WHATS_NEW_KEY = "filex.albumFlow.lastSeenVersion";
export const FEATURES_SEEN_KEY = "filex.albumFlow.seenFeatures";

interface KeyValueStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const defaultStorage = (): KeyValueStorage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export function lastSeenVersion(storage: KeyValueStorage | null = defaultStorage()): string | null {
  try { const value = storage?.getItem(WHATS_NEW_KEY); return value && /^\d+\.\d+\.\d+/.test(value) ? value : null; } catch { return null; }
}

export function rememberVersion(version: string, storage: KeyValueStorage | null = defaultStorage()): void {
  try { storage?.setItem(WHATS_NEW_KEY, version); } catch { /* si mostrerà di nuovo: nessun danno */ }
}

/** Funzioni nuove già aperte almeno una volta: finché non lo fai, il pulsante porta l'etichetta «Nuovo». */
export function seenFeatures(storage: KeyValueStorage | null = defaultStorage()): string[] {
  try { const parsed = JSON.parse(storage?.getItem(FEATURES_SEEN_KEY) ?? "[]") as unknown; return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []; } catch { return []; }
}

export function markFeatureSeen(id: string, storage: KeyValueStorage | null = defaultStorage()): string[] {
  const next = [...new Set([...seenFeatures(storage), id])];
  try { storage?.setItem(FEATURES_SEEN_KEY, JSON.stringify(next)); } catch { /* l'etichetta resterà */ }
  return next;
}
