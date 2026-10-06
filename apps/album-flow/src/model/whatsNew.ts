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
    version: "0.2.14",
    date: "2026-10-06",
    headline: "Lo spazio tra le foto per tutto l'album",
    items: [
      {
        title: "Spazio tra le foto predefinito dell'album",
        text: "Dalla finestra che si apre cliccando il formato in alto scegli lo spazio tra le foto di tutto l'album. Vale per le pagine dove non l'avevi cambiato a mano: i fogli che hai personalizzato dalla striscia «Spazio» e gli spread finiti restano come sono. I nuovi spread nascono con il nuovo spazio.",
        where: ["Formato e spazi dell'album", "Spazio tra le foto (cm)", "Spazio"],
      },
    ],
  },
  {
    version: "0.2.13",
    date: "2026-10-06",
    headline: "Il lucchetto del layout e la scheda Grafiche",
    items: [
      {
        title: "Layout libero o bloccato, pagina per pagina",
        text: "Sotto «Mescola», in ogni striscia laterale, il pulsante «Layout» rende libera la pagina (sposti e ridimensioni le foto a piacere, anche se il layout l'ha proposto il programma) oppure la protegge: una pagina bloccata non cambia con Mescola, con i layout proposti né con Auto Build. Dalla barra in basso blocchi la pagina sinistra, la destra o tutto il foglio. Tornando al layout automatico scegli se tornare a prima o tenere la disposizione nuova.",
        where: ["LAYOUT", "Sposta le foto liberamente", "Proteggi il layout", "Layout bloccato"],
      },
      {
        title: "Loghi e ornamenti in una scheda tutta loro",
        text: "In Personalizza, accanto a Libreria, la scheda «Grafiche» raccoglie le immagini da mettere sopra le foto: PNG con trasparenza, SVG, WebP o JPG. Un clic le inserisce nella pagina attiva e poi le sposti, ridimensioni e ruoti liberamente. Quelle già caricate ci sono già.",
        where: ["Personalizza", "Grafiche", "Carica grafica"],
      },
    ],
  },
  {
    version: "0.2.12",
    date: "2026-10-06",
    headline: "Testi narrativi pronti e calamite per i testi",
    items: [
      {
        title: "Racconto: testi che accompagnano le foto",
        text: "Oltre 300 testi scritti per i matrimoni, divisi per momento: aperture, preparativi, cerimonia, festa, finale. «Proponi un testo» sceglie quello adatto alla pagina, «Rigenera testo» ne propone un altro, «Proponi i testi per l'album» li mette sulle pagine libere senza ripeterne nessuno. Puoi anche sfogliare la libreria con i filtri e usare un testo a mano.",
        where: ["Personalizza", "Racconto", "Rigenera testo"],
      },
      {
        title: "Calamite e allineamenti per testi e grafiche",
        text: "Trascinando, un testo si aggancia a bordi, centro, piega, margini, foto e altri testi, con le linee guida (tieni premuto Alt per muoverlo senza calamite). Nuovi pulsanti per allinearlo alla pagina: sinistra, centro, destra, alto, metà, basso.",
        where: ["Personalizza", "Allinea alla pagina", "Alt"],
      },
      {
        title: "Testi più facili da gestire",
        text: "Un testo non esce più del tutto dalla pagina, un gruppo si ferma tutto insieme al bordo, ridimensionare un testo ruotato non lo fa più scappare e il testo incollato da altrove viene ripulito.",
      },
    ],
  },
  {
    version: "0.2.11",
    date: "2026-10-05",
    headline: "Raddrizza con una linea, testi già pronti per il matrimonio",
    items: [
      {
        title: "Raddrizza l'orizzonte con una linea",
        text: "Apri il ritaglio con un doppio clic sulla foto, premi il pulsante «linea» e trascina lungo l'orizzonte (o lungo un lato che deve essere verticale): l'angolo si calcola da solo. Puoi anche scriverlo nel campo e cambiarlo di 0,1° con ↑ ↓ (1° con Maiusc).",
        where: ["Doppio clic sulla foto", "linea", "Raddrizza"],
      },
      {
        title: "Ruota le foto di 90°",
        text: "I pulsanti ↺ ↻ nella barra della foto, e le voci nei menu a clic destro, ruotano la foto in tutto l'album: il ritaglio ruota con l'immagine e le miniature della libreria mostrano la foto ruotata.",
        where: ["↺ ↻", "Clic destro sulla foto"],
      },
      {
        title: "Spostare le foto è più sicuro",
        text: "Nessuna foto sparisce più dallo spread, nemmeno trascinata sul separatore accanto. Una foto bloccata resta ferma. Se uno spread è pieno ti avvisa. Riordinare un elenco filtrato non rimescola più il resto della libreria, e spostando una foto su un altro spread la vista resta dove eri.",
        where: ["Trascina sullo spread", "Miniature degli spread"],
      },
      {
        title: "Zoom e ritaglio più precisi",
        text: "La parte visibile della foto sta sempre dentro la cella, senza angoli vuoti e senza deformarsi, anche con la foto raddrizzata. Ingrandire di pochissimo non fa più saltare la foto.",
        where: ["Rotella sulla foto"],
      },
      {
        title: "31 modelli di testo per il matrimonio",
        text: "Capitoli (La storia, I dettagli, Le mani…), copertine, citazioni, didascalie e dediche, già composti in stile rivista: si inseriscono con tutti i loro pezzi e si modificano come vuoi. Nella Libreria trovi anche 45 frasi nuove.",
        where: ["Personalizza", "Testo", "Libreria"],
      },
    ],
  },
  {
    version: "0.2.10",
    date: "2026-10-05",
    headline: "Più sicurezza e il testo che non scappa",
    items: [
      {
        title: "L'album non sparisce più dalla Home",
        text: "Se cambiando la divisione di uno spread le foto non stanno in una pagina (il massimo è 12), il cambio viene rifiutato con un messaggio. Un album già finito in questa situazione viene riparato quando lo riapri, senza perdere le foto: restano nella libreria.",
        where: ["Divisione dello spread", "Home"],
      },
      {
        title: "Il testo si sposta senza intoppi",
        text: "Il pannello Personalizza non copre più lo spread: la pagina si sposta nello spazio libero. Afferrare e trascinare un testo non apre più il pannello a metà gesto; si apre con un clic.",
        where: ["Personalizza", "Trascina il testo"],
      },
      {
        title: "Salvataggi ed esportazioni anche su dischi exFAT",
        text: "Il progetto e le immagini si possono ora salvare su dischi formattati exFAT o FAT32 (molti dischi esterni): prima il salvataggio falliva con un errore.",
      },
    ],
  },
  {
    version: "0.2.9",
    date: "2026-10-05",
    headline: "Scegli la copertina del progetto",
    items: [
      {
        title: "Una foto come copertina nella Home",
        text: "Clic destro su una foto della libreria o di uno spread e «Imposta come copertina»: la foto compare nella lista dei Progetti della Home. Se non scegli niente resta la prima foto impaginata.",
        where: ["Clic destro sulla foto", "Imposta come copertina", "Home"],
      },
    ],
  },
  {
    version: "0.2.8",
    date: "2026-10-05",
    headline: "Provino: tutti gli spread in una vista",
    items: [
      {
        title: "Cambia l'ordine dell'album da una sola schermata",
        text: "Il Provino mostra tutti gli spread insieme, come i provini di stampa. Trascinali per riordinarli, anche più d'uno alla volta (Maiusc o Ctrl/⌘ per sceglierli). Alt + ← → sposta di un posto, doppio clic o Invio aprono lo spread. L'esportazione segue l'ordine che hai dato.",
        where: ["Provino", "tasto V"],
      },
    ],
  },
  {
    version: "0.2.7",
    date: "2026-10-05",
    headline: "Calamita e linee guida nei template liberi",
    items: [
      {
        title: "Le foto si agganciano e mostrano l'allineamento",
        text: "Spostando o ridimensionando una foto di un template libero, i suoi bordi e il suo centro si attaccano a quelli delle altre foto, ai margini dell'area e alla piega, e una linea guida mostra che sono allineati. Tieni premuto Alt per muoverla senza aggancio.",
        where: ["Trascina una foto di un template libero", "Alt = senza aggancio"],
      },
    ],
  },
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
