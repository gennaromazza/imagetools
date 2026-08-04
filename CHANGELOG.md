# Changelog

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
