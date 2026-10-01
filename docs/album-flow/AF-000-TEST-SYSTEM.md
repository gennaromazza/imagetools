# AF-000 — Sistema di test Album Flow

Aggiornato il 1 ottobre 2026 per la versione 2 (motore dinamico, editor a strisce, libreria in basso). Il gate aggregato `npm run test:album-flow-all` esegue l'intera suite in sequenza e va lanciato prima di ogni integrazione di nuove schermate. Ogni script è raggiungibile anche dalla FileX Dev Console (categoria «Album Flow», con descrizione di cosa cerca e cosa **non** prova).

## Test automatici

| Script | Cosa verifica | Test |
|---|---|---|
| `test:album-flow-system` | Presenza e coerenza: funzioni dichiarate nel codice, contratti desktop allineati (`index.ts` e `index.d.ts`), nessuna dipendenza PDF, ogni file di test raggiungibile da uno script e dalla Dev Console, documentazione | controlli statici |
| `test:album-flow-handoff` | Passaggio Selector → Album Flow: manifest Unicode, traversal, ordine di selezione, chiusura degli import del main process | 2 |
| `test:album-flow-engine` | Motore dei layout: alberi (inserimento, rimozione, scambio, specchio, preferiti), geometria (aree, spazio tra le foto, piega), generazione ordinata e deterministica, casi limite, regole di rilascio (anche su disposizioni libere), inserimento accanto a un intero ramo | 21 |
| `test:album-flow-model` | Operazioni sull'album: spread, divisione, rilascio, scambio, inquadratura, blocco, Shuffle, stile collegato, separatori, preferiti, allineamento, rilasci intelligenti (bordo e tra due foto), foto su spread nuovi o esistenti, modo foto intera, **template dell'utente** (ad albero e liberi con sovrapposizioni: abbinamento foto-celle, decadimento, specchio, cornici, archivio locale, uso in Auto Build, template dentro Mescola/frecce/1-9) | 34 |
| `test:album-flow-flow` | Auto Build, capitoli, libreria (ordini, filtri, stelle, tag), importazione con duplicati e cartelle escluse, riempimento degli spread, spread finiti, salvataggio e file danneggiati, controlli pre-export, reinvio dal Selector, formati | 33 |
| `test:album-flow-scenarios` | Storie complete di un fotografo (matrimonio da 140 foto, foto difficili, reportage da 320 foto, capitoli rimaneggiati, cambio formato) e oltre mille operazioni casuali (fuzz) con controllo di tutti gli invarianti dopo ogni passo | 11 |
| `test:album-flow-render` | Posizionamento delle foto nelle celle (riempi/adatta, zoom, rotazione, dpi), geometria degli slot, SVG di stampa | 16 |
| `test:album-flow-exif` | Ora di scatto e orientamento dal JPEG (entrambe le codifiche), ripiego sulla data del file, file troncati | 4 |
| `test:album-flow-history` | Annulla/ripeti | 3 |
| `test:album-flow-freshness` | Foto modificata sul disco: impronta del file, cache scartata, immagine rigenerata | 1 |
| `test:album-flow-license` | Avvisi di licenza nell'app (errore, tolleranza, prova gratuita) | 4 |
| `test:album-flow-relink` | Percorsi Windows, UNC, macOS/Linux; rifiuto di traversal | 4 |
| `test:photo-metadata-xmp` | Pacchetto XMP condiviso con Image Select Pro: stelle, etichette, colori, campi di altri programmi, file illeggibili | 8 |

Gli invarianti controllati dopo ogni operazione dei test d'uso (`assertProjectInvariants`): id unici, albero valido, ordine delle foto uguale all'ordine di lettura delle foglie, nessuna cella fuori dall'area o sovrapposta, nessuna foto deformata (zoom e centro entro i limiti), riferimenti esistenti, ogni foto in un solo capitolo, salvataggio che restituisce lo stesso progetto.

Il fuzz è deterministico (semi fissi) e fallisce se meno della metà delle operazioni cambia davvero l'album o se provano meno di 28 tipi di operazione: non può «girare a vuoto».

## Cosa NON è coperto dai test automatici

- Clic, trascinamenti, scorciatoie e aspetto: l'interfaccia è stata provata a mano in Chrome (anteprima a piena risoluzione) ma non esiste un runner DOM nel repository.
- La finestra Electron, il pacchetto installato, macOS, la scrittura delle stelle nei file XMP con l'app desktop.
- Qualità di stampa e fedeltà dei colori.

## Prova visiva ripetibile (non fa parte del gate)

`npm --workspace @photo-tools/album-flow run dev -- --host 127.0.0.1 --port 4265`, poi aprire `http://127.0.0.1:4265/`. Finestre di riferimento: **1540×980** (predefinita), **1366×768** (portatile) e **1100×740** (minima). Con foto reali si usano solo anteprime ridotte fuori dal repository.

### Matrice manuale dell'editor (da ripetere su Windows e macOS)

| Caso | Risultato atteso |
|---|---|
| Home → «Album di prova» → Auto Build | 10 spread; ogni capitolo (colore) comincia su uno spread nuovo; la libreria mostra la spunta su ogni foto usata e «0 da usare» |
| Clic su una foto | Anello dorato, nome del file e barra (ritaglia, guarda, info, blocca, togli) |
| Tasto B / pulsante layout | Pannello con tutte le disposizioni possibili per la pagina attiva (a sinistra se la pagina attiva è la destra); un clic le applica |
| Trascina un separatore | Le due foto cambiano proporzione in tempo reale; doppio clic ripristina; Ctrl/⌘+Z annulla |
| DIVIDI → «Un terzo + due terzi» | L'area sinistra occupa un terzo, le foto si ridistribuiscono per posizione |
| Trascina una foto dalla libreria su: area vuota / centro di una foto / bordo di una foto | Aggiunge / sostituisce / inserisce accanto e ridisegna; l'anteprima del rilascio mostra dove andrà |
| Trascina una foto dello spread su un'altra / sulla libreria | Si scambiano / la foto viene tolta dallo spread |
| Doppio clic + rotella + trascinamento | Ritaglio dentro la cella; Esc chiude; `0` ripristina |
| Ctrl/⌘+L | Lo stesso stile a sinistra e a destra; modificare un lato aggiorna l'altro |
| Spazio su una miniatura | Foto in grande con frecce, stelle, capitolo, tag; Invio la aggiunge all'area attiva e ridisegna il layout |
| Stelle su una miniatura | Si aggiornano; con l'app desktop sono scritte nel file XMP accanto alla foto |
| Clic destro su una miniatura | Guarda in grande, Aggiungi, Mostra nello spread, Modifica, Apri la cartella, Copia il nome, Sposta nel capitolo, Valuta, Segna come, Rimuovi dall'album |
| Importa foto (file mescolati, alcune già presenti) | Riepilogo «N nuove / M già presenti», scelta del capitolo, scelta sui duplicati; l'ordine è per ora di scatto |
| Trascina una cartella con sottocartelle sulla finestra (Electron) | Elenco delle cartelle con il numero di foto; togliendo la spunta a una sottocartella (es. «NON METTERE») le sue foto non vengono importate |
| Ctrl/⌘+J o doppio clic sul separatore della libreria | La libreria si nasconde e lo spread cresce; di nuovo per riaprirla |
| B → «Disegna» → Libero: aggiungi 3 foto (3:2, 2:3, 2:3), trascinale e ruotane una, salva | Il template compare in «I tuoi template» per le pagine con 3 foto; un clic lo applica con foto sovrapposte e ruotate |
| Foto di un layout libero: trascina, trascina l'angolo, ↺ ↻, frecce davanti/dietro | Si sposta, si ridimensiona senza deformare, ruota e cambia livello; Ctrl+Z annulla |
| Finestra 1100×740 | Strisce a due colonne, nessun controllo fuori vista, spread leggibile |
| F5 | Anteprima cliente a tutto schermo; Esc per uscire |
| Ctrl/⌘+E | Controlli (con «Vai»), risoluzione, qualità; JPG, SVG e progetto FileX |
| Home: trascina un album in un'altra colonna | La fase cambia e resta; vista elenco e griglia disponibili |

### Registro delle verifiche del 1 ottobre 2026

Eseguite in Chrome con l'app in sviluppo e 70 anteprime di foto reali di un matrimonio (originali mai toccati): importazione in disordine con ordinamento per ora di scatto, secondo import con 20 duplicati su 30, Auto Build di 70 foto in circa 1,4 s (12 spread), tutti i gesti della matrice qui sopra. Trovato e corretto durante la prova: (1) `commit` eseguiva l'aggiornamento dentro uno stato React con effetti collaterali (in StrictMode vengono eseguiti due volte): il messaggio dopo l'importazione e la scheda attiva risultavano sbagliati; ora `commit` è sincrono; (2) i pannelli a comparsa venivano tagliati dalle strisce laterali: ora sono disegnati in un portale; (3) con le dimensioni predefinite della finestra le azioni sullo spread uscivano dalla vista: ora stanno nella barra inferiore, le strisce passano a due colonne sotto 880 px di altezza e la libreria si adatta o si nasconde.
