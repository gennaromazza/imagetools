# Archivio Flow — audit importazione, 7 settembre 2026

## Correzioni verificate

- Il server azzerava il progresso soltanto dopo identificazione/fingerprint della scheda e campionamento. Ora riserva subito l’operazione e pubblica preparazione con un identificatore; il renderer scarta snapshot di altre operazioni e non sovrappone richieste di polling. Un secondo import concorrente riceve un errore senza alterare il primo. Anche gli errori di preparazione liberano l’operazione.
- La selezione per data passa alla seconda schermata, resta modificabile e non richiede una risposta sul numero di lavori. Il pannello conserva il lavoro mentre origine, filtri e risultati vengono rinnovati al cambio scheda, usando anche l’identità del volume e non solo la lettera. Durante una copia il cambio viene elaborato al termine dell’operazione.
- Nuovo lavoro/Lavoro esistente e dati essenziali precedono origine e opzioni, ora espandibili. Un nuovo lavoro esplicitamente richiesto dall’archivio azzera la bozza; la semplice navigazione la conserva.
- Il selettore visuale legge i file oltre il giorno inizialmente scelto. La selezione non riscrive la data del lavoro. Corretto il troncamento al minuto dei confini visuali e l’esclusione dell’ultimo minuto del giorno nel calendario. La validazione dei filtri server precede la creazione delle cartelle.
- Gli intervalli storici sono descritti come selezioni usate nella sessione, senza contrassegnare singole foto come archiviate per sola appartenenza temporale. Il controllo di sicurezza continua a confrontare il contenuto con le copie reali.

## Verifiche

- `npm run test:archivio-flow-bug-hunt`: 10 test superati nella prima verifica, compreso il nuovo test d’integrazione.
- `npm run test:archivio-flow-import-workflow`: prova reale su file temporanei di matrimonio oltre mezzanotte, timestamp uguali, ultimo secondo del giorno, import concorrenti, due copie consecutive e rilascio dopo errore. Raggiungibile dalla categoria Archivio Flow della Dev Console.
- `npx tsx --test apps/archivio-flow/server/safe-to-format.test.ts`: verifica effettiva con file extra, contenuto modificato e copia di destinazione rimossa.
- Typecheck Archivio Flow e Dev Console, build web/server e compilazione della shell con `npx tsc -p apps/filex-desktop/tsconfig.json --noEmit`.
- Prova interfaccia con API simulate: passaggio del 6 settembre dall’anteprima, selezione 21:15:32.125–02:30:42.500 mantenendo data lavoro 6 settembre, esclusione dei file delle 09:00; cambio seriale sulla stessa I:/, scelta Tutto e conservazione della bozza.

## Limiti e proposte

- Gli orari sono `mtime`, nel fuso locale, non orari EXIF di scatto. Il filtro include entrambi i confini; timestamp identici vengono selezionati insieme. I confini visuali vengono estesi al millisecondo esterno per includere timestamp filesystem frazionari.
- La prima griglia carica pagine cronologiche contigue di 500 file, continuando oltre 5000. Una firma dell’inventario impedisce di unire pagine di una scheda cambiata. Il selettore modale dell’intervallo mostra solo le anteprime caricate e lo dichiara. Selezione esplicita: fino a 50000 file per importazione.
- Non è stata eseguita una prova su schede fisiche né su installer. La correzione elimina il vecchio progresso visualizzato; non elimina il tempo necessario per identificare e leggere la scheda.
- Se due schede risultano indistinguibili nei metadati del volume e lo scambio avviene interamente tra due controlli, il polling non può dimostrare il cambio. Nessuna euristica basata sulla data viene usata come prova di identità.
- Implementati gruppi suggeriti per pause modificabili, calcolati sull’intera scansione mtime, senza attribuzione automatica degli eventi. La selezione clic/Shift direttamente nella prima griglia resta prioritaria.
- Nessuna release o pubblicazione del sito. La verifica `check:git-hygiene` richiede un commit pulito: con la patch ancora da revisionare segnala le modifiche del task.

## Completamento della prima schermata e associazione al lavoro

- Clic aggiunge/toglie un file, Shift+clic aggiunge l’intervallo nell’ordine corrente. L’ancora viene azzerata cambiando filtro; le selezioni precedenti restano conteggiate anche fuori dalle anteprime attuali. Il cambio scheda o Aggiorna scheda azzera la selezione. La selezione per inviare immagini agli altri tool mantiene la propria checkbox e il limite precedente di 500.
- Importa foto selezionate trasferisce `selectedFilePaths`, senza tradurle in intervalli temporali. Il server valida elenco, esistenza, formato, confinamento lessicale e realpath; rifiuta link fuori origine, liste vuote e filtri combinati. La pianificazione itera solo i file richiesti. Nessuna foto non selezionata viene aggiunta perché ha lo stesso timestamp.
- I gruppi per pausa non usano campioni: il server raccoglie i metadati completi, ordina per mtime e percorso, poi separa quando la pausa raggiunge la soglia indicata. La mezzanotte non è un confine. La griglia e il filtro gruppo hanno conteggi distinti dalla selezione esplicita.
- I suggerimenti usano solo lavori disponibili e sessioni completate. Gli intervalli sono aggregati dai timestamp sorgente registrati per i file importati. Si valuta quanti file selezionati ricadono in tali intervalli, poi recenza delle importazioni e data del lavoro. Più candidati e Nuovo lavoro restano disponibili; la scelta passa l’ID, che il server verifica nuovamente. Nessun servizio esterno, riconoscimento visivo o lettura EXIF.
- Test aggiuntivi: `test:archivio-flow-selection` (3 casi), integrazione estesa per pagine senza duplicati, gruppi completi anche con una sola miniatura, copia esatta tra timestamp uguali, percorso esterno e junction, seconda scheda nel lavoro esistente. Entrambi gli script sono in Dev Console / Archivio Flow.
- Prova browser end-to-end su JPEG sintetici e archivio isolato: selezionati 01–04 con Shift; 05 ha lo stesso timestamp di 04 ma non viene importata. Suggerito e scelto Matrimonio Anna e Luca; il payload contiene soltanto 01–04, senza filtri, e il risultato copia 4 file mantenendo data lavoro 6 settembre. Shift inverso su 07–06 seleziona due file e suggerisce prima Comunioni domenica. Con pausa di 6 ore il gruppo notturno ha 5 file e quello mattutino 2: il gruppo temporale non sostituisce la selezione esplicita di 4.
- Runtime utente osservato: processo installato in `AppData/Local/Programs/Archivio-Flow`, renderer da `resources/app.asar`, nessun server dev su 4175/3003 prima della prova. Le modifiche al checkout non sostituiscono quell’ASAR. L’istanza installata non è stata arrestata né aggiornata; nessuna foto utente è stata importata dai test.

- Test di paginazione esteso a 5001 file reali temporanei: 5000 nella prima pagina e 1 nella successiva, nessun duplicato/omissione. Una modifica mtime a parità di conteggio cambia la firma inventario. La selezione esatta è bloccata nel renderer se il server non restituisce tale capacità, per evitare l’uso accidentale di un backend precedente che ignori l’elenco file.
- La soglia di pausa scelta viene ricordata sul computer. Suggerimenti e gruppi sono compatti/espandibili per non spostare la griglia al primo clic durante una selezione con Shift.


## Schermata SD e anteprime — 8 settembre 2026

- Date sempre visibili, gruppi giornalieri aperti e una sola selezione per importazione e tool. I tool rimangono visibili con limiti e compatibilità espliciti.
- Inventario progressivo per sessione: prima risposta parziale, pagine di metadati senza nuove letture della SD, refresh esplicito con nuova sessione. Nessun inventario viene usato come prova di archiviazione.
- Griglia e selettore intervalli virtualizzati; priorità alle righe raggiunte scorrendo, richieste abbandonate saltate, cache Blob limitata anche in byte. La cache desktop conserva il controllo di identità della sorgente.
- Selezione completa per data/gruppo disponibile al termine della lettura. Singoli clic disponibili durante la scansione; selezione esatta limitata a 50.000 file per importazione, importazione intera SD ancora disponibile.
- Suggerimenti lavoro nel secondo passaggio; riepilogo SD riutilizzato senza scansione duplicata nel pannello nascosto. Unione e divisione manuale dei gruppi nella sezione avanzata.
- Verifiche: modello con 20.000 file, backend con oltre 5.000 file reali di prova, UI isolata con 12.000 metadati sintetici (selezione di 6.001 file, handoff simulato, filtri senza nuove richieste, DOM limitato, refresh, intervallo visuale e larghezza 390px). Nessuna misura prestazionale su una SD fisica o sul pacchetto installato.
- Typecheck, build web/server, routing e bug hunt verificati. Patch locale non pubblicata; check:git-hygiene segnala le modifiche non committate.


## Debug aggiuntivo della schermata SD

- Riprodotto e corretto: quattro richieste simultanee di una miniatura non disponibile provocavano quattro tentativi. La coda distingue ora il lavoro saltato perché fuori vista dall’errore di decodifica condiviso.
- Identità della sorgente propagata a ingrandimento e selettore intervallo, oltre alla griglia; conservata anche la precisione sub-millisecondo del timestamp nella chiave cache.
- Al cambio sorgente il selettore si chiude. Se il suo elenco cambia, indici e scorrimento vengono azzerati e gli indici non più validi non causano errori di rendering.
- Il filtro del pannello importazione segue la selezione esatta effettivamente attiva, evitando di restare disabilitato dopo un cambio sorgente manuale.
- Nuovo script test:archivio-flow-preview-queue disponibile nella categoria Archivio Flow della Dev Console. Test coda e selezione, typecheck e build superati. Prova UI isolata con StrictMode, due identità sulla stessa lettera, ingrandimento e riduzione dell’elenco mentre un intervallo è selezionato: nessun errore JavaScript.


## Verifica delle incongruenze logiche

- Giorni e foto erano ordinati in direzioni opposte: Maiusc attraverso mezzanotte poteva includere gli eventi prima/dopo il matrimonio. Griglia e lightbox ora seguono un ordine globale dal più recente; il selettore temporale conserva il proprio ordine cronologico crescente. Test con quattro scatti di eventi distinti: vengono selezionati soltanto i due notturni.
- Passando da un lavoro esistente a Nuovo lavoro venivano conservati data, contratto e sottocartella del precedente. Ora il nuovo lavoro riparte dalla data suggerita della selezione e dai campi specifici vuoti. Un clic sul pulsante già attivo non cancella una bozza.
- Senza sovrapposizioni temporali, il suggerimento della stessa giornata ora precede lavori con importazioni storiche non pertinenti; la motivazione visualizzata segue il criterio effettivo.
- Verifiche superate: sette test selezione/logica, typecheck Archivio Flow/Dev Console, build e prova UI isolata del passaggio lavoro esistente → nuovo. Nessuna modifica alla versione installata.


## Prova del flusso completo e valutazione d’uso

Eseguita sul codice di sviluppo, con App React completa collegata ai servizi reali e profilo/SD/archivio isolati. Il collegamento IPC è sostituito da un bridge locale di prova; l’apertura dei tool esterni è simulata.

| Caso | Risultato verificato |
|---|---|
| Matrimonio oltre mezzanotte | Dalla griglia alla copia reale: soltanto evening e night; twin con timestamp identico escluso. Data lavoro 6 settembre. |
| Secondo evento sulla stessa SD | Nuovo lavoro distinto, data 7 settembre, soltanto morning copiato. Operation ID diverso. |
| Integrità delle copie | Hash delle 7 copie JPEG prodotte durante le prove uguali agli originali isolati. |
| Invio ai tool | La selezione trasmessa contiene esattamente i due file scelti; esecuzione del programma esterno simulata. Limiti e compatibilità coperti dai test routing. |
| Molte foto | Test del modello con 20.000 file e inventario reale con 5.001 file; conteggi, pagine, cache e refresh passano. Non è un benchmark di una SD fisica. |
| Errori e sorgenti | Test del backend coprono file mancanti, percorsi esterni, seconda SD nello stesso lavoro e progresso indipendente. |

Quattordici test automatici del gruppo selezione, coda, routing e importazione superati. Nessun errore JavaScript nel percorso UI completato. Le prove precedenti coprono cambio identità a stessa lettera e 12.000 metadati nell’interfaccia.

Miglioramenti proposti, non implementati in questo giro:

1. Fine importazione: mostrare il risultato vicino alla selezione e offrire Prossimo evento, che svuota solo la selezione. Oggi tornando alla SD le foto appena copiate sono ancora selezionate. Non dedurre lo stato archiviato dalle date.
2. Selezioni miste RAW/JPEG/video: azione esplicita Seleziona solo foto compatibili per rendere immediato l’invio ai tool senza inviare silenziosamente un sottoinsieme.
3. Scelta di un gruppo: richiudere le opzioni e riportare l’attenzione sulla griglia, indicando il gruppo attivo anche a pannello chiuso.
4. Riepilogo prima della copia: rendere immediatamente leggibili nome lavoro, intervallo effettivo delle foto, quantità e destinazione quando si mantiene il lavoro precedente tra più SD.

Restano da verificare sul pacchetto installato: lettore/SD fisici lenti, rimozione durante la copia, ripresa conseguente e apertura reale dei tre tool. Nessuna pubblicazione o aggiornamento dell’app installata.


## Prova autorizzata sulla SD fisica I: — 8 settembre 2026

Eseguito il motore di importazione aggiornato con selezione esplicita di quattro JPEG (DSCF2213–DSCF2216), senza rinomina o conversione, usando destinazione D:/FileX-Prove/SD-2026-09-08T09-39-47-962Z e profilo separato. Non è stata usata né modificata l’installazione corrente.

- Copiati esattamente 4 file, 66.435.519 byte. Hash SHA-256 delle copie uguali agli originali; hash, dimensione e mtime dei quattro originali invariati dopo la prova.
- Inventario DCIM di 2.758 file identico prima/dopo (percorsi, dimensioni e mtime). Nessuna cancellazione o scrittura applicativa sulla SD.
- Durata importService: 21,836 s. Telemetria copyMs/scanMs: 746 ms; sampleMs: 4 ms. Per almeno i primi 20 s il progresso indicava idle con planned=0/copied=0 durante la preparazione.
- Miglioramento concreto da valutare: evitare di ricalcolare l’impronta dell’intera SD prima di ogni piccola selezione, conservando le garanzie sull’identità; esporre inoltre l’avanzamento della preparazione invece di lasciare il contatore a zero. Nessuna ottimizzazione introdotta durante questa prova.
- Copie e rapporto verifica.json conservati nella destinazione indicata; script temporaneo rimosso.

## Finestra vuota in sviluppo — 8 settembre 2026

I log e i processi identificano la finestra segnalata come Electron di sviluppo (titolo della shell 0.1.62, renderer Archivio Flow 0.1.41), non come eseguibile installato. Il log iniziale mostrava rootChildren=0 senza eccezioni registrate: la causa originaria non è stata isolata con certezza. Dopo il riavvio controllato l’interfaccia funziona anche con il bridge Electron reale.

Aggiunti caricamento iniziale visibile, gestione degli errori di importazione dei moduli e degli errori React non intercettati, con messaggio e pulsante di ricarica. Verificati separatamente modulo indisponibile, errore React simulato e avvio normale; typecheck e build web superati. Smoke Electron reale: SD I: letta, 2.762 file e date visibili, nessun pageerror, nessuna copia aggiuntiva. Screenshot in .runtime-test-data/avvio-ripristinato.png. Ripristinato l’avvio tramite Dev Console. Igiene Git ancora bloccata dalle modifiche pregresse e correnti non committate; main e origin/main allineati al controllo locale.
