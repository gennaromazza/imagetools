# AF-002 — Motore dinamico e modello v2

Data: 1 ottobre 2026. Stato: **specifica approvata a voce dall'utente** (decisioni in chat il 1 ottobre 2026), implementazione in corso a fasi. Sostituisce il modello a template fissi di AF-001 per tutto ciò che riguarda layout, spread e libreria.

## Riferimento osservato

Screenshot di AlbumTeller 1.9.0 forniti dall'utente (editor, popup Split e Align, menu libreria, nuovo album, home a colonne). Ciò che segue distingue **osservato**, **riferito dall'utente** e **mia scelta di progetto**.

Osservato o riferito dall'utente:
- Ogni spread ha una **divisione** (icone Split): foglio intero, due metà, un terzo+due terzi, due terzi+un terzo. Ogni area ha una striscia di controlli propria: Shuffle, Gap, Padding, Border (+colore), Mode, Align, Split, Link frame styles (Ctrl+L), flip.
- Mode = riempi ritagliando. Link = stesso stile a sinistra e a destra. Shuffle = cambia template dello spread (sinistra, destra o intero secondo la divisione). Binocolo = elenco dei template applicabili alle regole dello spread. Cestino = cancella lo spread.
- Sotto lo spread: sfondo (nero/bianco/colore) e BW. Mini-barra sulla foto: ritaglio, modifica, info, rimuovi. Libreria in basso con schede per capitolo, spunta verde sulle usate, stelline, cerca/filtra/ordina, Import. Spazio = foto grande; Invio = la mette nel foglio. Clic destro: Anteprima, Localizza, Modifica, Apri cartella, Copia nome, Elimina.

Decisioni dell'utente: motore dinamico stile AlbumTeller; struttura editor AlbumTeller con stile FileX; Home a colonne Pending/Editing/Proofing/Complete con fasi manuali e senza cloud; formati comuni + recenti + preferiti; rilascio sul bordo inserisce, sulla foto sostituisce/scambia; Gap/Padding/Border per area con scorciatoia su spread/album; Shuffle non cambia l'ordine delle foto; stelle salvate nel file XMP come il Selector; Invio aggiunge all'area selezionata ricalcolando; Spazio = foto grande, anteprima cliente su Play/F5; album esistenti non vanno migrati (erano prove); servizi desktop condivisi invece di incorporare Image Select Pro.

## Modello v2 (`AlbumProject.schemaVersion = 2`)

```ts
type AlbumSplitMode = "full" | "half" | "third" | "two-thirds"; // larghezza dell'area sinistra: 1, 1/2, 1/3, 2/3 dello spread
interface AreaStyle { gapCm; paddingCm; borderCm; borderColor; background; mode: "fill" | "fit"; align: "start" | "center" | "end"; mono: boolean }
type LayoutNode = { kind: "leaf"; itemId } | { kind: "split"; dir: "row" | "column"; ratio; first; second }; // albero guillotine
interface AlbumItem { id; assetId; zoom; cx; cy; locked? }            // inquadratura indipendente dal layout
interface AlbumArea { id; style: AreaStyle; layout: LayoutNode | null; items: AlbumItem[]; seed: number }
interface AlbumSpread { id; split: AlbumSplitMode; linked: boolean; areas: AlbumArea[] }   // 1 area se "full", altrimenti 2
interface AlbumProject { …; spreads: AlbumSpread[]; settings; stage: "pending"|"editing"|"proofing"|"complete"; favoriteLayouts: FavoriteLayout[] }
```

Regole:
1. Lo spread misura `2 × larghezza pagina` × `altezza pagina`. L'area sinistra occupa `frazione × larghezza spread`; con `full` c'è una sola area e le foto possono attraversare la piega. **La divisione 1/3 o 2/3 non coincide con la piega**: a schermo e in export lo spread resta un'unica immagine; è solo un aiuto di lavoro.
2. `layout` è un albero di divisioni (riga = affiancate, colonna = impilate) con rapporto di divisione. L'ordine delle foto è l'ordine di lettura delle foglie (sinistra→destra, alto→basso) e coincide con `items`.
3. Rettangolo area = rettangolo assegnato meno `paddingCm`; tra due foglie c'è `gapCm`; il bordo `borderCm` è disegnato dentro la foto.
4. L'inquadratura (`zoom`, `cx`, `cy`) appartiene alla foto, non alla cella: cambiare layout non perde i ritagli e la foto non si deforma mai.
5. `mode: "fill"` ritaglia per riempire la cella; `"fit"` mostra la foto intera e `align` ne decide la posizione nella cella.
6. Con `linked = true` ogni modifica di stile si applica a tutte le aree dello spread (Ctrl+L). «Applica a tutto l'album» copia lo stile dell'area su tutte le aree.
7. Il progetto v1 non viene migrato: all'apertura un progetto con `schemaVersion` 1 viene rifiutato con un messaggio chiaro e conservato intatto in una chiave di backup, mai cancellato.

## Motore di layout

- **Generazione**: dato l'elenco ordinato di foto (proporzioni), il rettangolo dell'area e lo stile, il motore enumera le forme di albero (tutte fino a 6 foto, campionate con seme oltre) e per ciascuna calcola i rapporti di divisione dalle proporzioni naturali delle foto. Punteggio = perdita media di ritaglio nelle celle + penalità per celle troppo piccole o troppo allungate. Le forme equivalenti (stesso disegno) sono deduplicate. Risultato: lista ordinata di layout candidati, deterministica.
- **Shuffle**: passa al candidato successivo nella lista (con seme per variare tra più chiamate) senza cambiare l'ordine delle foto; rispetta la divisione dello spread (agisce sull'area attiva, su entrambe se `linked`).
- **Binocolo**: mostra i primi K candidati distinti per l'area attiva, più i preferiti con lo stesso numero di foto.
- **Preferiti**: si salva la *forma* (direzioni e rapporti) e si riapplica a qualunque area con lo stesso numero di foto.
- **Separatori**: trascinare un separatore cambia il `ratio` del nodo, con aggancio a 1/2, 1/3, 2/3 e dimensione minima della cella.
- **Cambio divisione**: le foto restano nell'area in cui cade il loro centro; l'ordine non cambia; i layout vengono rigenerati.
- **Limiti**: massimo 12 foto per area. Prestazioni: Auto Build su 500 foto sotto 5 s; generazione di un'area sotto 50 ms.

## Gesti (trascinamento)

| Dove si rilascia | Cosa succede |
|---|---|
| Sul centro di una foto | Sostituisce (da libreria) o scambia (da altra foto) |
| Sul bordo di una foto (≈25%) | Inserisce accanto: divide la cella in direzione del bordo |
| Lungo il bordo dell'area (≈7%, fino a 22 mm) | Nuova colonna o riga a tutta area (evidenziata) |
| Sullo spazio tra due foto o gruppi | Si infila in mezzo al gruppo (evidenziato) |
| Sulla miniatura di uno spread | Aggiunge la foto a quello spread (pagina vuota, o con meno foto); da uno spread sposta, dalla libreria copia |
| Tra due miniature (o in fondo) della striscia | Crea un nuovo spread in quel punto con la foto |
| In un'area vuota | Aggiunge la foto come unica |
| Fuori dallo spread, sulla libreria | Rimuove la foto dall'area (non dal disco) |

Il separatore tra due foto si trascina; doppio clic sul separatore lo riporta al rapporto naturale.

## Libreria

- Mostra **tutte** le foto caricate (anche più di quante entrano nell'album), con distinzione netta tra **usate** (attenuate, spunta verde) e **non usate**. Filtri: tutte / non usate / usate, scheda per capitolo, cerca, ordina per nome/stelle/uso, zoom miniature.
- **Stelle**: valutazione 0–5 modificabile anche in Album Flow, scritta nel file XMP con lo stesso formato del Selector. Per farlo `xmp-sidecar.ts` viene spostato in un pacchetto condiviso; il Selector cambia solo l'import. Senza percorso su disco (browser) le stelle restano nel progetto.
- **Spazio** apre la foto grande (frecce per scorrere, stelle e Invio dentro la vista); **Invio** aggiunge la foto all'area selezionata e ricalcola. **Localizza** porta allo spread che la usa.
- Menu a clic destro: Anteprima, Localizza, Modifica (editor esterno), Apri cartella (nuova API desktop `revealInFolder`, funziona anche su macOS), Copia nome, Rimuovi dall'album.
- Miniature e anteprime dal processo desktop con le API a lotti e la cache condivisa con il Selector (`getThumbnails`, `getCachedThumbnails`, `getQuickPreviewFrame`).
- Import: aggiunge foto da una cartella (desktop) o da file (browser).

## Importazione e capitoli (richiesta dell'utente: «va migliorata»)

Stato attuale (verificato nel codice): import da file con il selettore del browser, dimensioni lette caricando l'immagine, nessuna lettura di cartelle o metadati; capitoli da etichette del Selector o creati a mano assegnando le foto selezionate. In AlbumTeller (screenshot) i capitoli sono schede colorate della libreria e «Import» è sempre disponibile.

Decisioni dell'utente: i capitoli sono un concetto **del software** («Casa sposo», «Casa sposa», …), indipendente da come le foto sono sul disco. L'ordine nel capitolo è **per orario di scatto** di default, con preferenza modificabile. Con foto già presenti l'importazione **chiede ogni volta**.

Progetto:
- **Capitoli come schede colorate** della libreria, con nome, colore, conteggio e foto assegnate. Si creano e rinominano a mano, si riordinano, si possono partire da un **gruppo predefinito** (es. «Matrimonio»: Casa sposo, Casa sposa, Chiesa, Esterni, Ristorante, Festa) modificabile e salvabile come proprio. Scheda «Senza capitolo» per le altre foto, scheda «Tutte».
- **Assegnazione**: selezionando foto nella libreria e trascinandole sulla scheda del capitolo, con il menu a clic destro («Sposta nel capitolo»), o scegliendo il capitolo di destinazione **nella finestra di importazione** («Importa in: Casa sposa»). Una foto sta in un solo capitolo; le etichette del Selector, se presenti, propongono i capitoli ma non li impongono.
- **Importazione** (desktop): scelta di cartelle (anche con sottocartelle, senza copiare i file) o trascinamento di file e cartelle sulla finestra, con avanzamento. Dimensioni con `getImageDimensions`, ora di scatto con `readCaptureTimes` (EXIF; in mancanza data del file e poi nome), stelle ed etichette da XMP. Nel browser: selezione di file.
- **Cartelle**: se la sorgente contiene sottocartelle (es. «chiesa», «NON METTERE»), la finestra di importazione le elenca con il numero di foto e permette di togliere la spunta a quelle da non importare; le cartelle non diventano capitoli (decisione dell'utente).
- **Duplicati**: il confronto usa percorso e impronta del file; se ce ne sono, una finestra elenca le foto già presenti e chiede se saltarle o aggiungerle (decisione per tutte o una per una).
- **Ordine**: preferenza del progetto «ordina per» orario di scatto (predefinito), nome file, ordine del Selector o manuale (trascinando nella libreria). Vale all'interno di ogni capitolo e per Auto Build.
- Si possono caricare **più foto di quante ne entrano** nell'album: la libreria resta completa e distingue usate/non usate.

## Template dell'utente (disposizioni disegnate)

Oltre ai layout calcolati e ai preferiti, l'utente può **disegnare e salvare template** (editor: tasto B → «Disegna»). Due tipi:

- **Divisioni** (`kind: "tree"`): una forma ad albero come i layout normali, disegnata dividendo celle e trascinando le linee; foto affiancate, mai sovrapposte.
- **Libero** (`kind: "free"`): una cornice per foto (`FreeFrame`: x, y, larghezza, altezza in frazione dell'area utile, rotazione in gradi, livello). Le foto possono sovrapporsi e ruotare. In un'area libera `AlbumArea.free` associa a ogni foto la sua cornice; `layout` resta una catena di foglie coerente come riserva.

Un template ha un **tipo di area** (pagina, foglio intero, un terzo, due terzi) e un numero di foto; vale per **tutti gli album** (archivio locale `filex.albumFlow.v2.templates`, massimo 200). Chi applica il template ne copia il risultato nell'area: il progetto resta autosufficiente.

**Elenco unico dei layout.** Mescola, le frecce ↑ ↓, i tasti 1-9 e il browser dei layout usano lo stesso elenco: il migliore calcolato, poi i template dell'utente adatti al contesto (dal migliore), poi gli altri calcolati. Il seme dell'area identifica il layout attuale (indice tra i calcolati, oppure 1000 + posizione tra i template); senza template l'elenco è quello di prima.

**Riconoscimento e abbinamento.** Per un'area con N foto il motore propone i template dello stesso tipo e numero di foto. A ogni cella assegna la foto che ritaglia meno (tutte le permutazioni fino a 7 foto, a parità resta l'ordine attuale; con foto bloccate l'ordine non cambia) e ordina i template per perdita media di ritaglio. Auto Build può usarli dove ritagliano quasi quanto il layout calcolato (tolleranza 0,12); gli spread «finiti» non si toccano.

**Quando decade un'area libera.** Stile, ritaglio, blocco e specchio la mantengono (lo specchio ribalta x e rotazione); togliere una foto lascia le altre ferme; aggiungere una foto, Mescola, layout n. o i preferiti riportano al layout normale. Nell'area libera il rilascio vale solo sulla foto più in alto (sostituisce o scambia); le foto si spostano trascinandole e si ridimensionano dall'angolo (proporzioni conservate); rotazione e livello dalla barra della foto.

Il controllo di coerenza ammette sovrapposizioni solo nelle aree libere. L'esportazione SVG/JPG disegna dal livello più basso al più alto e ruota ogni foto attorno al proprio centro.

## Schermata di impaginazione

Griglia (altezze a 1540×980): barra superiore 48 px; zona di lavoro con lo spread grande al centro; striscia degli spread in miniatura (88 px di altezza, con numero e colore del capitolo); separatore trascinabile; libreria a tutta larghezza con schede capitolo (altezza automatica `clamp(176px, 26vh, 300px)`, regolabile a mano e comprimibile fino alla sola barra delle schede). Nessun pannello fisso a destra.

- **Strisce laterali** (una per area, 88 px; 150 px a due colonne sotto 880 px di altezza): Mescola, Spazio, Margine, Bordo + colore, Modo, Allinea, Dividi, Collega stili e Scambia le pagine. Contengono solo i controlli della singola pagina.
- **Barra inferiore della zona di lavoro**: sfondo della pagina attiva e B/N; navigazione tra gli spread; azioni sullo spread (Mescola tutto, tutti i layout, preferito, applica lo stile a spread o album, duplica / specchia / svuota, elimina lo spread); zoom e guide. Le azioni sono nella barra e non nella striscia perché a 1540×980 una striscia con tutto non entra e a 1100×740 (finestra minima) sparirebbe fuori vista.
- **Foto selezionata**: anello dorato, nome del file e mini-barra (ritaglia, guarda in grande, informazioni, blocca, togli).
- **Pannello dei layout** (tasto B): a destra se la pagina attiva è la sinistra, a sinistra se è la destra, così non copre mai la pagina su cui si lavora.
- Pannelli a comparsa disegnati in un portale a posizione fissa: non vengono tagliati da strisce o aree con scorrimento. Toast in basso al centro (più in alto quando il visualizzatore è aperto).
- Stile: token FileX (scuro, oro `#b89a63`).

Scorciatoie: Spazio foto grande, F5 e Play anteprima cliente, Ctrl/⌘+L collega gli stili, ←/→ spread, ↑/↓ layout precedente/successivo, 1-9 i primi nove layout, B tutti i layout, Invio aggiunge dalla libreria (o ritaglia una foto selezionata nello spread), Ctrl/⌘+J mostra o nasconde la libreria, Ctrl/⌘+D duplica lo spread, Ctrl/⌘+Z annulla, Ctrl/⌘+B Auto Build, Ctrl/⌘+E esporta, G guide, S misure stampate e dpi su ogni foto, L blocca la foto, K/P/M tag copertina/panorama/principale. Velocità: F riempie le pagine vuote con le prossime foto non usate (del capitolo dello spread), U mette nell'area attiva la prossima foto non usata, N va al prossimo spread con una pagina vuota, D segna lo spread come «finito» (Auto Build, Mescola e i layout automatici non lo toccano; Auto Build lo lascia nella stessa posizione).

## Home e nuovo album

Bacheca a colonne Pending / Editing / Proofing / Complete con conteggi; fasi spostate a mano (`stage`), nessun servizio online. Scheda con copertina (prima foto dello spread 1), nome e riga «formato / spread / foto». Cerca, ordina, viste (colonne, lista, griglia, archivio). Nuovo album: schede Recenti / Preferiti / Formati comuni; larghezza, altezza, unità, dpi; sezioni Abbondanza, Zona sicura, Impaginazione; «Aggiungi ai preferiti». Nessuna specifica di laboratorio ufficiale.

## Verifica

Test puri su albero (inserimento, rimozione, scambio, rapporti, round trip), generazione (determinismo, ordine, nessuna deformazione, punteggio), divisioni, gesti di rilascio, preferiti, operazioni sullo spread e fuzz con invarianti; prestazioni (500 foto); storie complete e fuzz di oltre mille operazioni (`scenarios.test.ts`); prova visiva dell'interfaccia (vedi `AF-000-TEST-SYSTEM.md`), eseguita anche con anteprime di foto reali. L'interfaccia non ha test automatici di interazione (nessun runner DOM nel repository).

## Fuori da questa versione

Proofing online, specifiche ufficiali dei laboratori, copertina/dorso, profili colore e crocini, ritaglio basato sul contenuto, pacchetto installato e licenza.
