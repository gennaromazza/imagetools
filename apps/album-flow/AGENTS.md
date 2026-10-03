# FileX Album Flow — istruzioni di sviluppo

Workspace `@photo-tools/album-flow` (React 19 + Vite, nessuna libreria di stato esterna). Regole generali e Git sono nell'`AGENTS.md` della radice; qui solo ciò che riguarda questo tool. La documentazione di prodotto è in `docs/album-flow/`: leggi `AF-001-UX-SPEC.md` (interfaccia) e `AF-002-ENGINE-V2-SPEC.md` (modello, motore, gesti) prima di toccare editor o motore.

## Obiettivo di prodotto

Chiudere il flusso **Archivio Flow → Image Select Pro → Album Flow**: le foto scelte nel Selector (ordine, stelle, etichette) arrivano già in ordine, diventano capitoli, poi una bozza automatica che il fotografo rifinisce a mano, come in AlbumTeller / SmartAlbums / Fundy Designer. Il Selector **non** è incorporato: Album Flow riusa i servizi desktop condivisi (miniature, anteprime, cartelle, XMP). Ciò che non serve a questo flusso va discusso prima di essere aggiunto (esempio: **il PDF non è richiesto** dall'utente, non reintrodurlo senza una richiesta esplicita).

## Struttura reale (v2)

- `packages/shared-types/src/album-flow-v2.ts` — tipi del progetto: `AlbumProjectV2`, `AlbumSpread` (`split`: foglio intero, metà, un terzo, due terzi), `AlbumArea` (stile, albero del layout, elementi), `LayoutNode` (albero a divisioni con rapporti), `AlbumItem` (foto + inquadratura), `AreaStyle`. Lo schema è `schemaVersion: 2`.
- `src/engine/` — motore **puro** (niente DOM, niente progetto): `geometry.ts` (aree dello spread, celle, separatori, piega), `tree.ts` (inserimento accanto, rimozione, scambio, specchio, forma dei preferiti), `generate.ts` (elenco ordinato dei layout per una lista di proporzioni, con punteggio sul ritaglio perso), `drop.ts` (centro = sostituisce o scambia, bordo = inserisce accanto, area vuota = aggiunge), `rng.ts`.
- `src/model/` — **unica** porta per modificare un progetto: funzioni pure `(project, …) => project` in `areas.ts` (layout, Shuffle, stile, separatori, preferiti), `items.ts` (foto negli spread, rilascio, inquadratura, blocco), `templates.ts` (template dell'utente: archivio locale, abbinamento foto-celle, applicazione, cornici libere), `spreads.ts`, `chapters.ts`, `library.ts` (ordini, filtri, stelle, tag, usate/non usate), `autobuild.ts`, `import.ts` (duplicati, RAW+JPG), `portability.ts` (file `.filex-album.json`), `preflight.ts`, `store.ts` (salvataggio locale, fasi, passaggio dal Selector, album di prova), `formats.ts`, `exif.ts`, `placement.ts` (foto dentro una cella: riempi/adatta, zoom, dpi).
- `src/render/` — `spread-svg.ts` (SVG per l'esportazione, stessa geometria dello schermo) ed `export.ts` (scrittura JPG/SVG/progetto con writer browser o desktop).
- `src/desktop/` — `api.ts` incapsula `window.filexDesktop` con un ripiego per il browser; `importer.ts` legge cartelle, file trascinati e dati delle foto.
- `src/components/` — `Workspace.tsx` (cronologia, `commit`, scorciatoie, finestre), `Stage.tsx` + `AreaStrip.tsx` (spread, strisce di controllo, barra inferiore), `SpreadView.tsx` (celle, separatori, trascinamento, ritaglio), `LayoutBrowser.tsx`, `LibraryDock.tsx` (schede dei capitoli, miniature, menu contestuale), `Filmstrip.tsx`, `PhotoViewer.tsx`, `ClientPreview.tsx`, finestre (`ImportDialog`, `AutoBuildDialog`, `ExportDialog`, `ChapterManager`, `NewAlbumDialog`, `ShortcutsDialog`), `TemplateEditor.tsx` (disegno dei template), `Home.tsx` (colonne per fase), `ui.tsx` (Modal, Popover a portale, menu, campi), `icons.tsx`, `dnd.ts`.
- `src/history.ts` (annulla/ripeti), `src/relink.ts` (percorsi Windows/UNC/macOS), `src/slot-geometry.ts` (calcolo del ritaglio).
- `packages/photo-metadata` — XMP condiviso con il Selector (stelle, etichette, colori). Il Selector lo usa tramite un file di rimando: non duplicare il codice.

## Regole di modifica

1. **Nessuna logica di layout nei componenti.** Una nuova azione = funzione pura in `model/` (o `engine/`) con test, poi collegata alla UI.
2. **Il layout è derivato.** Si salvano alberi con rapporti e foto, mai rettangoli assoluti; l'inquadratura (zoom e centro) si ricalcola sulla proporzione reale della cella e una foto non si deforma mai.
3. `commit(updater, coalesceKey)` in `Workspace.tsx` è **sincrono** (usa una ref alla cronologia): l'`updater` deve essere puro, e ciò che serve dopo (conteggi, messaggi) si legge subito dopo la chiamata. Non mettere effetti collaterali dentro un setter di React (in StrictMode verrebbero eseguiti due volte). Le modifiche continue (slider, rotella, separatori) usano `coalesceKey` e fanno commit al rilascio.
4. Ogni operazione deve mantenere gli invarianti di `assertProjectInvariants` (`model/fixtures.ts`): id unici, albero valido, ordine delle foto = ordine delle foglie, celle dentro l'area e senza sovrapposizioni, riferimenti esistenti, salvataggio fedele. **Aggiungi la nuova operazione al fuzz** (`OPERATIONS` in `model/scenarios.test.ts`).
5. Il formato del progetto è versionato: non cambiare lo schema v2 senza decisione dell'utente. I progetti v1 non si migrano (era solo una prova): vengono rifiutati con un messaggio chiaro e **mai cancellati** dal salvataggio locale.
6. Desktop: tipi IPC solo da `@photo-tools/desktop-contracts`; `index.ts` e `index.d.ts` si aggiornano insieme; `main.ts`, `preload.ts` e i contratti usano CRLF. Non aggiungere canali IPC senza richiesta; le foto si leggono con `getThumbnails`/`getPreview` (mai RAW nel renderer). `window.filexDesktop` può mancare: ogni chiamata ha un ripiego.
7. Multipiattaforma: nessun percorso Windows cablato nel codice dell'interfaccia, font con ripiego macOS (`-apple-system`), scorciatoie `Ctrl` **e** `⌘`. Il prodotto è pensato anche per macOS.
8. Stile: solo i token di `styles.css` (`--bg #1f2421`, `--bg-panel #2b312d`, `--accent #b89a63`, raggi 26/18/12). Tema scuro come Image Select Pro; niente colori nuovi senza motivo. Testi in italiano, frasi brevi, niente gergo.
9. **Spazio dell'editor.** Finestra minima 1100×740 (`tool-manifest.ts`): sotto 880 px di altezza le strisce passano a due colonne (`--strip-w`), la libreria ha altezza automatica (`clamp`) ed è comprimibile con `Ctrl/⌘+J`, le azioni sullo spread stanno nella barra inferiore. Un controllo nuovo non deve spingere fuori vista nessuna azione a 1100×740, 1366×768 e 1540×980.
10. **Prestazioni con album grandi** (626 foto in libreria e 105 spread, provati): la libreria è `memo` e riceve gestori stabili da `useStableCallbacks` (`hooks/`), così cambiare spread non ridisegna le miniature; lo stesso vale per le miniature dentro la libreria. Un componente con centinaia di figli non deve ricevere funzioni create a ogni render.
11. **Disposizioni libere** (`AlbumArea.free`): sono un'eccezione ai layout ad albero. `hasFreeLayout` decide se valgono; l'albero resta sempre coerente come riserva e **chi assegna un nuovo albero deve azzerare `free`** (`free: undefined` prima di `normalizeArea`). Solo lì le celle possono sovrapporsi: non rilassare altrove il controllo di sovrapposizione.
12. Popover e menu: usa `Popover` (portale a posizione fissa, mai tagliato dalle strisce); scala dei livelli: menu 120, finestre 100, visualizzatore 110, popover 135, anteprima cliente 130, toast 140.

## Verifica (dalla radice)

```powershell
npx tsc --noEmit -p apps/album-flow/tsconfig.json
npm run test:album-flow-all
npm --workspace @photo-tools/filex-dev-console run typecheck
npm --workspace @photo-tools/album-flow run build
```

`test:album-flow-all` raccoglie: sistema (presenza e coerenza), handoff, motore, modello, flussi, casi d'uso con fuzz, rendering, EXIF, cronologia, relink e XMP condiviso. Se serve un controllo in un'area, lancia lo script mirato (`test:album-flow-engine`, `-model`, `-flow`, `-scenarios`, `-render`, `-exif`, `-history`, `-relink`, `test:photo-metadata-xmp`).

**Prova visiva**: `npm --workspace @photo-tools/album-flow run dev -- --host 127.0.0.1 --port 4265`, poi `http://127.0.0.1:4265/` («Album di prova» crea 36 foto sintetiche in 4 capitoli). Per verificare a risoluzione piena senza il pannello del browser integrato si può pilotare Chrome via DevTools Protocol da uno script nella cartella di lavoro dell'agente (finestre di riferimento: 1540×980, 1366×768, 1100×740). Per le foto reali usa **solo anteprime ridotte** copiate fuori dal repository: gli originali dell'utente non si spostano, modificano o copiano nel progetto. Dalla Dev Console l'avvio Electron richiede circa 30-40 s (build della shell + Vite): attendi, non rilanciare.

## Novità e file statici

- Ogni release aggiunge in `src/model/whatsNew.ts` la voce della nuova versione (titolo e spiegazione per ogni miglioramento, e in `where` i nomi esatti dei pulsanti, schede o scorciatoie dove trovarli). Gli utenti la vedono dopo l'aggiornamento e dal pulsante «Novità» della Home. Un pulsante nuovo porta l'etichetta «Nuovo» con `useNewFeature`. `npm run test:album-flow-whatsnew` fallisce se manca la voce della versione del `package.json`.
- I file di `public/` si citano con `import.meta.env.BASE_URL`, mai con `/nome.png`: nel pacchetto la pagina si carica da file e il percorso assoluto non funziona (lo controlla `npm run test:album-flow-system`).

## Nuovi test

Ogni test nuovo: script `test:album-flow-*` in `package.json` radice, dentro `test:album-flow-all`, descrizione in `apps/filex-dev-console/server/index.ts` (la categoria `album-flow` è automatica dal prefisso) e verifica del typecheck della Dev Console. `scripts/test-album-flow-system.mjs` fallisce se un file di test non è raggiungibile da uno script o se manca la descrizione nella Dev Console.

## Cosa NON è ancora fatto (non dichiararlo come fatto)

Prova dell'interfaccia dentro Electron e sul pacchetto installato (Windows e macOS); scrittura delle stelle nei file XMP provata su file reali con l'app desktop; copertina e dorso; profili colore, crocini di taglio e formati ufficiali dei laboratori; revisione con il cliente online; migrazione degli album v1; voce nei release manifest; decisione finale sulla licenza (`shared-runtime` è provvisoria). Gli spread «un terzo + due terzi» hanno il confine fuori dalla piega e l'esportazione resta una sola immagine per spread: da confermare con il prodotto.
