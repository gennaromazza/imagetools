# Changelog

## 2026-08-09 - FileX Suite 0.1.27

- corretta la verifica della versione dei tool installati: la Suite legge prima `package.json` tramite il filesystem ASAR virtuale di Electron
- mantenuto il reader ASAR esplicito come fallback per test, diagnostica e installazioni non eseguite dentro Electron
- eliminato il falso errore "il tool è stato installato ma non è stato possibile verificarne la versione" dopo un aggiornamento riuscito
- Image Select Pro e gli altri tool mantengono invariata la propria versione

## 2026-08-09 - Image Select Pro 0.1.26

### Image Select Pro
- la schermata Sfoglia permette ora di scorrere tutte le cartelle e i progetti recenti mantenendo fissa la testata
- la modalita Confronta usa da 2 a 4 foto selezionate e visibili nella griglia, conserva l'ordine corrente e resta accessibile anche nei pannelli stretti
- aggiunta la scorciatoia `Ctrl+B` per aprire e chiudere rapidamente il confronto
- durante lo scorrimento della griglia le ombre diffuse delle card vengono sospese, mantenendo visibili bordi di selezione ed etichette colore

### Release engineering
- prima release indipendente di Image Select Pro con tag `photo-selector-app-v0.1.26`, installer Windows x64, requisito minimo FileX Suite `0.1.26` e catalogo stabile dedicato
- FileX Suite e gli altri tool mantengono invariata la propria versione

## 2026-08-09 - FileX Suite 0.1.26

- versionamento separato per FileX Suite, Image Select Pro, Image Party Frame e Archivio Flow
- build Windows selettiva del solo componente pubblicato
- feed Suite e catalogo tool separati dagli alias GitHub `releases/latest`
- tag namespaced e controllo aggiornamenti distinto nell'interfaccia della Suite

## 2026-08-08 - FileX Suite 0.1.25

### Image Select Pro
- l'anteprima rapida ora copre correttamente la testata dell'applicazione, evitando comandi e contenuti nascosti sotto il layout principale
- aggiunto un interruttore visibile e accessibile `Avanza dopo classificazione`: in `OFF` stelle, Pick/Scarta, colori ed etichette restano sulla foto corrente, mentre le frecce continuano a navigare manualmente
- la preferenza di avanzamento automatico viene conservata tra le sessioni
- i conteggi distinguono chiaramente selezioni nella cartella, selezioni complessive del progetto e fotografie visibili con i filtri
- il filtro stelle mostra sia il numero minimo (`1 stella o piu`) sia il totale esatto della singola valutazione

### Release engineering
- FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow vengono riallineati alla versione `0.1.25` con installer per-user, blockmap, `latest.yml` e manifest stabile verificato

## 2026-08-08 - FileX Suite 0.1.24

### Aggiornamento dei tool
- corretto il lock di `resources/app.asar` causato dalla lettura della versione installata: FileX Suite non mantiene piu' aperti i file di Image Select Pro e degli altri tool
- l'installer silenzioso non resta piu' sospeso dietro una finestra di errore; restituisce alla Suite il codice di file occupato, che viene ritentato con attese progressive
- la chiusura della Suite ora attende i servizi nativi prima di terminare, riducendo i processi residui e i file ancora in uso
- aggiunto un test di regressione Windows che legge la versione dall'ASAR e verifica che l'archivio possa essere rinominato immediatamente

### Release engineering
- FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow vengono riallineati alla versione `0.1.24` con installer per-user, blockmap, `latest.yml` e manifest stabile verificato

## 2026-08-08 - FileX Suite 0.1.23

### Image Select Pro
- nuova area di lavoro modulare: pannelli Selezione, Vista, Filtri e Statistiche sono compatti, richiudibili e riposizionabili senza coprire la griglia
- barra superiore e comandi contestuali riorganizzati per ridurre ingombro e clic ripetuti; corretti contenuti tagliati, sovrapposizioni e livelli dei modali
- caricamento esplicito per servizi con migliaia di fotografie, rendering alleggerito e diagnostica reale dell'accelerazione hardware nel pannello impostazioni
- in anteprima rapida l'avanzamento dopo una classificazione e' ora disattivabile direttamente con `Avanza: ON/OFF`; eliminato il doppio salto causato dall'interazione con i filtri attivi
- navigazione manuale avanti/indietro preservata anche quando la classificazione corrente non soddisfa piu' il filtro visibile
- riconnessione Google Drive disponibile quando il refresh del token scade o viene revocato, con messaggio operativo al posto dell'errore generico 400
- sincronizzazione XMP resa piu' robusta e verificabile sulle varianti di metadati usate dai principali software fotografici

### FileX Suite e aggiornamenti
- FileX Suite e i tool Windows distribuiti vengono riallineati alla versione `0.1.23` tramite un'unica release stabile
- installer per-user, blockmap, `latest.yml` e manifest `stable.json` sono pubblicati insieme per consentire l'aggiornamento sia della Suite sia di Image Select Pro dalle installazioni precedenti
- rilevamento processi, chiusura ordinata e individuazione degli eseguibili installati resi piu' affidabili durante gli aggiornamenti

## 2026-08-07 - FileX Suite 0.1.22 (per-user)

### Aggiornamenti senza privilegi amministrativi
- gli installer dei tool passano a NSIS one-click per-user (`perMachine: false`): installazione in `%LOCALAPPDATA%\Programs\<ToolName>` senza UAC
- `packElevateHelper: false`: nessun helper di elevazione incorporato negli installer
- l'aggiornamento di un tool chiude SOLO quel tool, esegue l'installer con `/S` e riapre il tool se era in esecuzione; la Suite e gli altri tool restano aperti
- eliminato PowerShell dal flusso di aggiornamento: chiusura processi via `tasklist`/`taskkill`, lettura versione da `resources/app.asar/package.json`
- rimosse le funzioni NSIS di disinstallazione legacy HKLM/HKCU (`uninstallLegacyVersions`, `uninstallByDisplayName`, `loop_hkcu`, `loop_hklm`)
- `extraMetadata.name` impostato sull'`executableName` di ogni tool: con one-click per-user electron-builder deriva la cartella di installazione dal nome del package, che era condiviso tra tutti i tool e causava installazioni sovrapposte in `@photo-toolsfilex-desktop`
- ogni finestra mostra nel titolo il nome del tool e la versione installata, letta direttamente dal package Electron

### Migrazione
- le installazioni precedenti in `C:\Program Files\...` possono restare temporaneamente: la Suite cerca sia `%LOCALAPPDATA%\Programs` sia `Program Files` e sceglie la versione più recente
- dopo la verifica della nuova architettura, rimuovere manualmente le vecchie installazioni per-machine

## 2026-08-05 - FileX Suite 0.1.20

### FileX Suite
- corretto il completamento del download degli aggiornamenti: l'installer viene usato solo dopo la chiusura del file temporaneo e la rinomina effettiva in `.exe`
- gli errori transitori di lock di Windows vengono ritentati prima della verifica SHA-256, evitando riavvii o richieste UAC su installer non disponibili

### Release engineering
- FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow vengono ripubblicati alla versione `0.1.20` con manifest stabile, installer, blockmap e `latest.yml` coerenti

## 2026-08-05 - FileX Suite 0.1.19

### Image Select Pro
- anteprima rapida in modalita focus con filtri e dock richiudibili per dedicare piu spazio allo scatto
- controllo zoom diretto e pulsanti di spostamento disponibili quando l'immagine e' ingrandita

### Release engineering
- FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow vengono pubblicati insieme alla versione `0.1.19`
- manifest stabile, installer, blockmap e `latest.yml` sono distribuiti dalla stessa GitHub Release per gli aggiornamenti nel launcher

## 2026-08-04 - FileX Suite 0.1.18

### FileX Suite
- descrizioni operative complete per tutti i software presenti nel launcher
- dettagli della nuova versione mostrati direttamente nella scheda prima del pulsante `Aggiorna`
- note di rilascio obbligatorie per ogni tool: il manifest non viene generato se le novità non sono specificate

### Aggiornamenti coordinati
- chiusura dell'intera famiglia di processi FileX prima di aggiornare la Suite o un singolo tool
- tentativo di chiusura ordinata seguito dalla terminazione dei soli processi rimasti bloccati
- riavvio automatico di FileX Suite al termine dell'installer
- ripristino automatico dei tool che erano aperti prima dell'aggiornamento

### Release engineering
- Image Party Frame entra nella pipeline insieme a FileX Suite, Image Select Pro e Archivio Flow
- manifest stabile completo di versione, checksum, URL e novità per ciascun tool pubblicato
- chiusura processi già predisposta anche per Batch Print Layout, Image Converter e Trova Foto da Lista quando torneranno disponibili i relativi workspace applicativi

## 2026-08-04 - FileX Suite 0.1.17

### Archivio Flow
- mappatura persistente delle cartelle archivio create fuori da Archivio Flow
- nuovo modulo guidato per correggere nome e data e riallineare in sicurezza i nomi delle cartelle
- anteprima, selezione esplicita, controllo collisioni, rollback e scrollbar sempre visibile nel modulo di riallineamento
- import piu' sicuro: blocco destinazioni interne alla SD, gestione link, confronto contenuti e risultati parziali espliciti
- generazione BASSA_QUALITA piu' robusta e riutilizzabile anche sui file gia' importati
- icona Windows corretta al posto dell'icona Electron

### Integrazione FileX Suite e Image Select Pro
- rilevamento esteso delle installazioni attuali e legacy di Image Select Pro
- apertura automatica della cartella selezionata da Archivio Flow
- cambio cartella affidabile quando Image Select Pro e' gia' aperto, senza creare finestre duplicate
- forwarding Windows irrobustito tramite dati single-instance e argomento `--open-folder=...`

### Release engineering
- FileX Suite, Image Select Pro e Archivio Flow pubblicati insieme al manifest stabile aggiornato
- contratto permanente "pubblica e builda" documentato per versioni, changelog, sito, installer e verifica updater

## 2026-08-01 - FileX Suite 0.1.5

### Aggiornamento automatico della Suite
- controllo automatico della versione stabile all'avvio
- download in background con avanzamento e velocità visibili nel launcher
- verifica SHA-512 dell'installer tramite electron-updater
- installazione automatica con conto alla rovescia, possibilità di installare subito o rimandare
- gestione non bloccante delle connessioni lente o temporaneamente assenti
- pubblicazione obbligatoria di `latest.yml` e blockmap nelle release future

## 2026-08-01 - FileX Suite 0.1.4

### Dock adattiva
- avvio ridotto a icona anche per gli utenti provenienti dalle versioni precedenti
- tema chiaro o scuro sincronizzato automaticamente con Windows
- animazione di ingrandimento più fluida e progressiva in stile macOS
- riordino delle icone tramite trascinamento con ordine persistente
- finestra trasparente ridimensionata al contenuto per limitare l'area occupata e l'intercettazione del mouse
- riduzione automatica dopo l'avvio di un tool o un breve periodo di inattività

## 2026-08-01 - FileX Suite 0.1.3

### Pulizia strumenti dismessi
- rimossi definitivamente dal launcher ImageAlbumMaker, Ripara Disco Rete e Image ID Print
- la Suite distribuita mostra esclusivamente i sei strumenti supportati
- mantenuta la gestione degli installer tramite manifesto remoto con URL di release versionati

## 2026-03-27 - Desktop workflows, performance e branding

Commit: `01e61e7` - `feat: improve desktop workflows and suite branding`

### Image Select Pro
- migliorata in modo sostanziale la velocita' di browsing su griglie grandi e quick preview
- aggiunte pipeline piu' native per RAW, thumbnail e preview con cache piu' aggressive
- resa piu' coerente la navigazione tra griglia e preview `Space`
- aggiunti filtri label custom, scorciatoie, assegnazione piu' solida e drag/drop desktop
- aggiunto suggerimento smart per spostare la cache pesante su un disco piu' capiente con migrazione guidata

### Image ID Print
- introdotto editor di refine scontorno con pennello, undo/redo, hardness, zoom e pan
- migliorata la logica di recupero soggetto e refine dei bordi
- aggiunta stampa DNP RX1 con pipeline dedicata e fix di export/preview
- corretti bug su upload, export, crop reset, auto-align e preview ruotate

### Desktop shell e packaging
- branding unificato per le app della suite e uso corretto dei loghi nei bundle
- packaging Windows migliorato con icone, naming coerente e script multi-tool
- migliorata integrazione con editor esterni e rilevamento Photoshop
- rafforzata la cache desktop thumbnail/preview e la gestione dei percorsi

### Auto Layout e integrazioni
- preparata integrazione piu' stretta con `Image Select Pro` tramite etichette custom e metadati condivisi
- aggiornati storage/export per supportare meglio il flusso di selezione reale
