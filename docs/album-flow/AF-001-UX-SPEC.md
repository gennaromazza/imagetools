# AF-001 — Specifica UX di Album Flow

> **Nota (1 ottobre 2026).** Questo documento descrive la prima versione dell'interfaccia (v1) e resta come confronto con i programmi di riferimento. La versione corrente è descritta in `AF-002-ENGINE-V2-SPEC.md`; dove i due documenti differiscono (Spazio = foto in grande e F5 = anteprima cliente, strisce di controllo per pagina, libreria in basso con capitoli colorati, Home a colonne, layout dinamici) **vale AF-002**.


Data: 30 settembre 2026. Stato: implementata nel workspace `apps/album-flow` (vedi sezione «Cosa c'è» e «Cosa manca»).

## Riferimenti studiati

Ricerca web su Pixellu SmartAlbums, Fundy Designer (l'utente scrive «Find the Designer»), AlbumTeller e Zno Designer. Le pagine di aiuto ufficiali erano in parte non leggibili (errori SSL/403), quindi ciò che segue si basa su pagine e riassunti di ricerca effettivamente letti; i punti senza fonte sono segnati come ipotesi. AlbumTeller è installato sul PC dell'utente ma **non è stato aperto né fotografato**: questo ambiente non permette di guidare o catturare applicazioni desktop native. Da completare confrontando a mano le sue schermate.

| Tema | Cosa fanno i concorrenti (fonte) | Cosa abbiamo adottato |
|---|---|---|
| Area di lavoro | Image browser/«bins», timeline e spread al centro (SmartAlbums); image well, storyboard, Design Library, Drop Zones (Fundy); temi chiaro/scuro, capitoli, stato progetto pending/editing/proofing/complete (AlbumTeller) | Libreria foto a sinistra, spread al centro, filmstrip in basso, pannello proprietà a destra; stati progetto «Senza foto / Da impaginare / In modifica» |
| Navigazione | Frecce ←/→ cambiano spread, ↑/↓ scorrono i template, Spazio = anteprima (SmartAlbums) | Stesse scorciatoie: ←/→ spread, ↑/↓ layout, Spazio anteprima cliente |
| Gesture | Trascinare un'immagine su un'altra la scambia; trascinare lo spazio tra le foto ridimensiona (Fundy) | Trascinamento libreria→slot, slot→slot (scambio), slot→libreria (rimuove); doppio clic per spostare/zoomare nello slot. Ridimensionamento del gutter **non ancora implementato** |
| Tag sulle foto | `C` copertina, `P` panorama, `G` gruppo, `M` principale (Fundy) | `K` copertina, `P` panorama, `M` principale (pagina dedicata in Auto Build); `C` è usato altrove, `G` non implementato |
| Auto Build | Numero di foto per spread, raggruppamento intelligente, tag che guidano il risultato, completamento parziale (SmartAlbums, Fundy Design Wizard) | Foto per pagina 1-8, capitoli che iniziano su nuovo spread, alternanza layout, «aggiungi solo foto non usate» (completamento parziale) |
| Capitoli / storyboard | Timeline con tagli (SmartAlbums); storyboard (Fundy); limiti per capitolo (AlbumTeller) | Capitoli dal Selector (etichette) o manuali, riordinabili, filtro libreria, etichetta nel filmstrip |
| Template | Scelta per numero di foto, salvataggio preferiti (SmartAlbums); tasti numerici del Quick Design Picker (Fundy) | Griglia di layout con lo stesso numero di foto, compatibili con orientamento e lato pagina; ciclo con ↑/↓; tasti 1–9 (o stepper) per cambiare il numero di foto della pagina. Salvataggio di template propri **non implementato** |
| Export | JPG per spread per altri laboratori (Zno), PSD/PDF/IDML (SmartAlbums) | JPG per spread (dpi del progetto, max 300), SVG per spread, file progetto `.filex-album.json`. PDF escluso su richiesta dell'utente |
| Proofing cliente | Proofing cloud (SmartAlbums, AlbumTeller, Zno) | Anteprima a tutto schermo locale; nessun cloud |

Non trovati nei concorrenti (quindi non attribuiti a loro): indicatori di risoluzione, foto usate/non usate, duplicati. Sono stati aggiunti perché utili (vedi sotto).

## Flusso utente

1. **Home**: «Nuovo album», «Apri progetto…», elenco album con miniatura del primo spread, stato, conteggi; «Crea album di prova».
2. **Arrivo dal Selector**: l'app riceve l'handoff, crea/aggiorna l'album e lo apre. Un reinvio conserva impaginazione e formato e toglie le foto scartate.
3. **Editor**: Auto Build (Ctrl/⌘+B) o impaginazione a mano da «Impagina a mano».
4. **Rifinitura**: scambio per trascinamento, layout, zoom/spostamento, blocco, tag, capitoli, formato/margini/sfondo/bordo dalla scheda Album.
5. **Controllo**: avvisi di slot vuoti, foto non usate, duplicati e risoluzione effettiva sotto 150 dpi (bordo giallo sullo slot).
6. **Cliente**: anteprima a tutto schermo (Spazio).
7. **Consegna**: Esporta (Ctrl/⌘+E).

## Scorciatoie (riepilogo completo nell'app, tasto `?`)

←/→ spread · Home/Fine primo/ultimo · ↑/↓ layout · 1–9 numero di foto nella pagina · Spazio anteprima · Invio o doppio clic = ritaglio · rotella = zoom nello slot · `0` reimposta · `L` blocca · Canc rimuove · `K`/`P`/`M` tag · `G` guide · +/− zoom vista · Ctrl/⌘+Z annulla · Ctrl/⌘+Maiusc+Z o Ctrl/⌘+Y ripeti · Ctrl/⌘+D duplica spread · Ctrl/⌘+B Auto Build · Ctrl/⌘+E esporta.

## Modello

- Pagina = `GeneratedPageLayout`; spread = due pagine consecutive. Numerazione, lato e `spreadId` sono sempre derivati dalla posizione (`normalizeAlbumPages`).
- Gli slot dei template sono frazioni dell'area utile; l'interspazio riduce ogni slot di metà spazio per lato quando la pagina ha più slot.
- L'inquadratura è `zoom` + centro, ricalcolata sull'aspetto reale dello slot: cambiare formato non deforma le foto.
- Tag editoriali: `AlbumAsset.albumTags` (campo aggiuntivo opzionale in `@photo-tools/shared-types`); percorso assoluto: `AlbumAsset.absolutePath`.

## Cosa c'è / cosa manca

Per la versione 1 era coperto da test oggi sostituiti: la versione corrente è coperta da `test:album-flow-engine`, `-model`, `-flow` e `-scenarios` (vedi `AF-000-TEST-SYSTEM.md`). L'interfaccia **non ha test automatici di interazione** e non è stata provata nella finestra Electron né su macOS.

Manca (v1; nella v2 il ridimensionamento dei separatori, i layout preferiti e l'ordine per ora di scatto sono presenti): copertina/dorso, profili colore e crocini, salvataggio nativo su disco con migrazioni, invio diretto agli strumenti Suite dopo l'esportazione, pacchetto installato (Windows/macOS) e verifica di licenza.
