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
    version: "0.2.27",
    date: "2026-10-09",
    headline: "Comandi della foto sui quattro lati e posizionamento libero più libero",
    items: [
      {
        title: "Comandi della foto sui quattro lati",
        text: "Selezionando una foto, i comandi si dividono attorno a lei: sopra ritaglio e forma, a sinistra rotazione e bordo, a destra anteprima, editor e informazioni, sotto lucchetto e cestino. Sulle foto piccole diventano due colonne. Spariscono mentre trascini una foto, così non si sbaglia clic.",
        where: ["Barre ai lati della foto"],
      },
      {
        title: "Foto libere più grandi della pagina",
        text: "Con «Sposta le foto liberamente» puoi ingrandire una foto oltre la sua pagina, per esempio uno sfondo che passa anche sull'altra metà del foglio, e portarla dietro le altre con «Porta dietro le altre». Se poi cambi la divisione dello spread, le foto restano dove sono.",
        where: ["Sposta le foto liberamente", "Porta dietro le altre", "Dividi"],
      },
      {
        title: "Porta davanti e dietro funzionano subito",
        text: "In modalità libera, le frecce «Porta davanti alle altre» e «Porta dietro le altre» ora mostrano subito l'effetto: prima la foto selezionata restava sempre in primo piano e sembrava che non succedesse nulla.",
        where: ["Porta davanti alle altre", "Porta dietro le altre"],
      },
      {
        title: "Maniglia di ingrandimento sul bordo",
        text: "Il triangolino per ingrandire la foto nella disposizione libera ora sta proprio sull'angolo della foto, non più qualche millimetro più in là.",
      },
    ],
  },
  {
    version: "0.2.26",
    date: "2026-10-09",
    headline: "Barra della foto divisa in due, senza coprire l'immagine",
    items: [
      {
        title: "Due barre ai lati della foto",
        text: "Selezionando una foto, i comandi non stanno più in una sola barra larga al centro: a sinistra trovi ritaglio, forma, rotazione e bordo; a destra anteprima, editor, informazioni, lucchetto e cestino. Nelle celle strette la barra di destra sale sopra quella di sinistra.",
        where: ["Barra a sinistra della foto", "Barra a destra della foto"],
      },
    ],
  },
  {
    version: "0.2.25",
    date: "2026-10-09",
    headline: "Aggiungi spread con un «+» e sfoglia con la rotella",
    items: [
      {
        title: "Un «+» per aggiungere uno spread dove vuoi",
        text: "Passa il mouse tra due miniature nella striscia in basso (o dopo l'ultima): compare un «+». Un clic crea uno spread vuoto proprio in quel punto e lo apre.",
        where: ["+ tra le miniature"],
      },
      {
        title: "Sfoglia l'album con la rotella",
        text: "Con il puntatore sopra lo spread, la rotella del mouse passa allo spread precedente o successivo. Con Ctrl, ⌘, Alt o Maiusc la rotella fa ancora zoom e raddrizzamento.",
        where: ["Rotella sullo spread"],
      },
      {
        title: "Pagine con solo testo più pulite",
        text: "Se una pagina ha già il testo del template e nessuna foto, «Trascina qui le foto» non copre più il titolo: resta il bordo tratteggiato e una piccola icona nell'angolo; la scritta compare al passaggio del mouse o quando trascini una foto.",
      },
    ],
  },
  {
    version: "0.2.24",
    date: "2026-10-08",
    headline: "Più foto in Photoshop in un colpo solo e filtro «Usate»",
    items: [
      {
        title: "Aprire più foto dello spread in Photoshop",
        text: "Tieni premuto Maiusc e clicca le foto dello spread che vuoi ritoccare, poi clic destro e «Modifica N foto nell'editor»: si aprono tutte insieme. Per aprire l'intero spread usa «Modifica tutte le foto dello spread nell'editor». Salvi in Photoshop e le foto si aggiornano da sole al ritorno.",
        where: ["Maiusc + clic", "Modifica N foto nell'editor", "Modifica tutte le foto dello spread nell'editor", "Altre azioni sullo spread"],
      },
      {
        title: "Vedere solo le foto già usate",
        text: "Accanto a «N da usare» c'è ora «N usate»: un clic e la libreria mostra solo le foto che hai già messo nell'album; un secondo clic le mostra di nuovo tutte.",
        where: ["N usate", "N da usare"],
      },
      {
        title: "Riposizionare la foto con Alt",
        text: "Tieni premuto Alt e trascina una foto per spostarla dentro la sua cella senza aprire il ritaglio. Con Alt e la rotella la ingrandisci, come prima.",
        where: ["Alt + trascinamento", "Alt + rotella"],
      },
      {
        title: "Premendo Alt la pagina non si sposta più",
        text: "Prima, premendo Alt, compariva la barra dei menu di Windows e tutta la pagina scendeva di qualche pixel. Ora resta ferma.",
      },
      {
        title: "Barra della foto più compatta e spread più comodi",
        text: "Il pulsante del bordo è un'icona piccola. Duplica ed elimina non coprono più le miniature degli spread: li trovi col clic destro sulla miniatura, insieme a «Sposta all'inizio» e «Sposta in fondo».",
        where: ["Bordo (icona nella barra della foto)", "Clic destro su uno spread"],
      },
    ],
  },
  {
    version: "0.2.23",
    date: "2026-10-08",
    headline: "Bordo per singola foto e disegno libero più fluido",
    items: [
      {
        title: "Bordo solo su una foto",
        text: "Ogni foto può avere il suo bordo, con spessore e colore propri, in tutti i layout e anche nel disegno libero. Se non lo imposti vale quello dell'area; «Come l'area» la fa tornare com'era. Un album con bordi per foto non si apre con le versioni precedenti di Album Flow.",
        where: ["Bordo (barra della foto)", "Come l'area"],
      },
      {
        title: "Spostare le foto in modo libero senza ritardo",
        text: "Trascinando o ridimensionando una foto nel disegno libero il movimento è immediato e la maniglia di ridimensionamento sta sull'angolo della foto.",
      },
      {
        title: "Template libero: proporzioni e livelli",
        text: "Le foto aggiunte («+ 1:1 quadrata», «+ 3:4 verticale»…) mantengono le proporzioni scelte anche su un foglio largo. Con «Avanti di uno» e «Indietro di uno» porti una foto sopra o sotto un'altra un livello alla volta.",
        where: ["Avanti di uno", "Indietro di uno", "Porta davanti", "Porta dietro"],
      },
    ],
  },
  {
    version: "0.2.22",
    date: "2026-10-08",
    headline: "Ricollega ritrova anche le foto ri-salvate",
    items: [
      {
        title: "Foto modificate dopo l'album: ora si ritrovano",
        text: "Se una foto è stata ri-salvata dopo aver creato l'album (Lightroom, Camera Raw, Photoshop), il suo peso è cambiato e «Ricollega le foto» non la riconosceva. Ora la ritrova dal nome, purché nella cartella scelta ci sia un solo file con quel nome. Con nomi doppi non sceglie al posto tuo.",
        where: ["Ricollega le foto"],
      },
    ],
  },
  {
    version: "0.2.21",
    date: "2026-10-08",
    headline: "Photoshop salva le foto anche mentre Album Flow è aperto",
    items: [
      {
        title: "Salvataggio da Photoshop senza blocchi",
        text: "Prima Photoshop poteva non riuscire a salvare una foto mentre Album Flow ne generava le miniature o le anteprime, soprattutto con TIFF e PNG grandi. Ora Album Flow occupa la foto solo il tempo di leggerla, non per tutta l'elaborazione: modifichi, salvi e al ritorno in Album Flow la foto si aggiorna da sola.",
        where: ["Modifica nell'editor"],
      },
    ],
  },
  {
    version: "0.2.20",
    date: "2026-10-08",
    headline: "Caroselli: elimina elementi, calamite e griglia, niente frasi ripetute",
    items: [
      {
        title: "Elimina testi ed elementi dei modelli",
        text: "Nel modo «Testo/grafiche» clicca un testo, una linea, un riquadro o un ornamento e premi Canc (o «Elimina elemento»). «Rimetti eliminati» li riporta, «Riporta tutto al posto» rimette tutto come nel modello.",
        where: ["Testo/grafiche", "Elimina elemento", "Rimetti eliminati", "Riporta tutto al posto"],
      },
      {
        title: "Calamite e griglia per allineare",
        text: "Spostando o ridimensionando foto, testi e grafiche ci si aggancia a centro, margini e altri elementi, con linee guida rosa; tieni premuto Alt per muovere senza aggancio. «Griglia» mostra centro, terzi e margini, e ridimensionando una foto vedi misura e proporzioni.",
        where: ["Calamite", "Griglia", "Alt"],
      },
      {
        title: "Mai la stessa frase due volte",
        text: "Un carosello nuovo non ripete la stessa frase. Se ne scrivi una già usata, sotto il campo compare l'avviso con il numero della slide; «Evita frasi ripetute» le sostituisce con frasi nuove e il controllo prima di esportare le segnala.",
        where: ["Evita frasi ripetute", "Suggerisci", "Esporta"],
      },
    ],
  },
  {
    version: "0.2.19",
    date: "2026-10-08",
    headline: "Caroselli: sposta testi e grafiche, modelli semplici a una foto",
    items: [
      {
        title: "Un modo solo per testi e grafiche",
        text: "Sotto l'anteprima scegli «Testo/grafiche» e il trascinamento sposta solo testi, linee, riquadri, ornamenti, numero di pagina e doppie pagine del modello: le foto restano ferme e il testo non si confonde più con la foto. L'elemento scelto ha un contorno tratteggiato; un clic su un testo lo modifica, «Riporta tutto al posto» rimette tutto nel modello.",
        where: ["Inquadra", "Sposta foto", "Scambia", "Testo/grafiche", "Riporta tutto al posto"],
      },
      {
        title: "Otto modelli semplici a una foto",
        text: "In testa all'elenco «Modello»: Foto intera (a tutta slide, senza testo), Foto con margine, Bordo bianco, Cornice sottile, Foto e didascalia, Foto tonda, Foto con banda e Foto su riquadro. Si vestono dei colori dello stile e funzionano in tutti i formati.",
        where: ["Modello", "Foto intera", "Bordo bianco", "Cornice sottile", "Foto tonda"],
      },
    ],
  },
  {
    version: "0.2.18",
    date: "2026-10-08",
    headline: "Caroselli: foto libere, maniglie per ridimensionare, testi spostabili",
    items: [
      {
        title: "Ridimensiona e gira le foto con le maniglie",
        text: "Clicca una foto nell'anteprima: le maniglie ai bordi la allargano e la stringono (gli angoli mantengono le proporzioni) e il cerchio in alto la gira. Usando una maniglia la slide passa da sola alla disposizione libera, senza spostare nulla.",
        where: ["Inquadra", "Sposta", "Scambia"],
      },
      {
        title: "Disposizione libera, anche con le foto sovrapposte",
        text: "Nella scheda «Foto» scegli «Libera»: sposti le foto dove vuoi, le sovrapponi, scegli la forma (rettangolo, tonda, arco), il bordo bianco e l'ombra, e le porti «Davanti» o «Dietro». «Del modello» riporta le foto negli spazi del modello.",
        where: ["Foto", "Disposizione", "Libera", "Davanti", "Dietro", "Cambia foto…", "Raddrizza"],
      },
      {
        title: "Altre foto disponibili",
        text: "In fondo alla scheda «Foto» vedi le foto segnate «Per i social» che il carosello non usa ancora: un clic le aggiunge alla slide (o le mette nello spazio selezionato).",
        where: ["Foto", "Altre foto disponibili", "Segna come", "Per i social"],
      },
      {
        title: "Sposta i testi dove vuoi",
        text: "Trascina un testo sulla slide per metterlo dove preferisci; un semplice clic lo modifica come prima. Nella scheda «Testi», «riporta al posto» lo rimette nel modello.",
        where: ["Testi", "riporta al posto"],
      },
      {
        title: "Tredici nuovi modelli con tre o quattro foto",
        text: "Mosaico a quattro, quattro colonne, una grande e due piccole, tre e quattro polaroid, pellicola a quattro, tre ritratti con titolo, tre cerchi, collage sovrapposto, tre archi, una alta e due basse, quattro cornici e tre fotogrammi larghi: utili quando le foto sono tante e le slide poche.",
        where: ["Modello", "Slide"],
      },
    ],
  },
  {
    version: "0.2.17",
    date: "2026-10-08",
    headline: "Caroselli: sposta le foto, scrivi sulla slide, scegli quante slide",
    items: [
      {
        title: "Crea il carosello dalle foto che hai scelto",
        text: "«Nuovo carosello» mostra le foto segnate «Per i social» (o, se non ce ne sono, le migliori dell'album) e propone quante slide servono per usarle tutte. Cambi il numero con il cursore, aggiungi o togli foto con «Scegli le foto…» e solo allora crei il carosello.",
        where: ["Nuovo", "Nuovo carosello", "Scegli le foto…", "Numero di slide"],
      },
      {
        title: "Sposta le foto tra le slide",
        text: "Con l'interruttore «Sposta» sotto l'anteprima trascini una foto su un'altra foto, su uno spazio vuoto o su una slide della striscia: le due foto si scambiano. Puoi trascinarle anche dalle miniature «Foto 1», «Foto 2» a destra. «Inquadra» resta il modo per muovere e ingrandire la foto nel suo spazio, anche sotto i testi.",
        where: ["Sposta", "Inquadra", "Foto 1", "Foto 2"],
      },
      {
        title: "Scrivi direttamente sulla slide",
        text: "Clicca un testo nell'anteprima: si apre un riquadro dove scrivi, premi «Suggerisci» per una proposta nuova o «Stile» per carattere, dimensione e colore.",
        where: ["Suggerisci", "Stile", "Fine"],
      },
      {
        title: "Pannello a schede e aiuto automatico per slide",
        text: "A destra le funzioni sono divise in Modello, Foto, Testi e Aspetto, così i testi non sono più in fondo a un elenco di modelli. A sinistra «Aiuto automatico» applica «Riscegli le foto» e «Suggerisci i testi» alla slide selezionata oppure a tutto il carosello.",
        where: ["Modello", "Foto", "Testi", "Aspetto", "Aiuto automatico", "Tutto il carosello"],
      },
    ],
  },
  {
    version: "0.2.16",
    date: "2026-10-06",
    headline: "Caroselli e storie per Instagram, dal tuo album",
    items: [
      {
        title: "Un carosello Instagram con le foto già scelte",
        text: "Dall'album aperto, il pulsante «Carosello» propone subito 10 slide con le foto migliori già in pagina, in quattro stili (Editoriale, Galleria, Moda, Cinema) e 50 modelli: copertine tipografiche, foto tra due parole, collage con bordo bianco, polaroid, foto ad arco, panorama su più slide e le pagine vere del tuo album in una scena. Formati Post 4:5, quadrato e Storia 9:16, da 2 a 20 slide con il cursore «Numero di slide». Esporti un JPG per slide, numerati, più il testo del post. Dalla Home, «Nuovo carosello» parte direttamente dalle foto, senza impaginare un album.",
        where: ["Carosello", "Nuovo carosello", "Numero di slide", "Esporta"],
      },
      {
        title: "Segna le foto «Per i social»",
        text: "Tasto destro su una foto, in libreria o sullo spread, poi «Segna come» e «Per i social» (oppure il tasto I): il carosello usa quelle foto per prime, poi quelle con più stelle. Se cambi stelle o segnalini dopo aver creato il carosello, Album Flow te lo dice e «Riscegli le foto» aggiorna la scelta tenendo stile e testi.",
        where: ["Segna come", "Per i social", "I", "Riscegli le foto"],
      },
      {
        title: "Inquadra le foto e ritocca i testi",
        text: "Trascina la foto nel suo spazio e ingrandiscila con la rotella; scegli la forma (1:1, 4:5, 3:2, 16:9…) e specchia la slide. Clicca un testo nell'anteprima per cambiarne carattere, dimensione, colore, allineamento e maiuscole, oppure premi «Suggerisci» per avere titoli, parole e frasi dalla libreria editoriale dei fotolibri.",
        where: ["Inquadratura", "Forma della foto", "Specchiata", "Aa", "Suggerisci"],
      },
      {
        title: "Ogni carosello è diverso dall'altro",
        text: "Ogni carosello nuovo mette i modelli in un ordine diverso e specchia alcune slide, così quelli di settimane diverse non escono uguali. «Altra variante» rifà l'ordine tenendo foto e testi; nome, profilo, colori e font si scrivono una volta e restano per i caroselli successivi.",
        where: ["Altra variante", "Il tuo studio", "Colori", "Caratteri"],
      },
    ],
  },
  {
    version: "0.2.15",
    date: "2026-10-06",
    headline: "Raddrizza con la rotella e spostamenti più fluidi",
    items: [
      {
        title: "La rotella del mouse raddrizza la foto",
        text: "Nel ritaglio (doppio clic sulla foto), porta il puntatore sul cursore «Raddrizza», sul campo dell'angolo o sull'etichetta e gira la rotella: l'angolo cambia di 0,1° a scatto (1° tenendo premuto Maiusc), senza scrivere i numeri. Ctrl/⌘ + rotella sulla foto raddrizza ugualmente, e con lo strumento «linea» acceso basta la rotella.",
        where: ["Doppio clic sulla foto", "Raddrizza", "Rotella del mouse"],
      },
      {
        title: "Calamite a interruttore e foto libere più scorrevoli",
        text: "Nella barra in basso, accanto a «Guide», il nuovo interruttore «Calamite» attiva o spegne l'aggancio di foto libere, testi e grafiche. Sulle foto libere le calamite sono più leggere (solo i bordi e la piega), le foto possono uscire in parte dal margine e la barra delle azioni non compare più mentre le sposti.",
        where: ["Calamite", "Guide"],
      },
    ],
  },
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
