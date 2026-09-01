# Stampa, calibrazione e operazioni

## Obiettivo

Un file visivamente corretto sul monitor non prova che la fototessera misuri correttamente sulla carta. FileX ID Photo deve trattare la calibrazione come requisito di prodotto.

## Pipeline output

    foto finale approvata
    profilo documento con misure fisiche
    numero copie
    foglio e margini
    render a DPI di output
    verifica limiti memoria
    export o job di stampa
    prova fisica e calibrazione

La preview usa una risoluzione limitata per restare fluida. L'export usa la risoluzione necessaria alle misure fisiche. I due percorsi devono condividere la stessa geometria, non lo stesso canvas.

## Formati iniziali

| Voce | Stato richiesto |
|---|---|
| Foglio 10×15 | Priorità prima versione |
| Foglio 15×20 | Priorità prima versione |
| A4 | Priorità successiva, se coperto da test reale |
| PDF | Primo formato consegna consigliato per dimensioni fisiche |
| JPG | Supportato con metadati DPI; la foto singola viene sempre consegnata in JPG |
| TIFF | Supportato solo con metadati e decoder verificati |
| PNG | Non deve essere promesso come output a DPI affidabile senza contratto e test specifici |

Batch Print Layout produce PDF, JPG, PNG e TIFF, ma oggi imposta in modo esplicito le dimensioni PDF e il DPI JPG. Per PNG e TIFF i metadati DPI non sono una capacità verificata del motore attuale. FileX ID Photo deve stabilire test per ogni output prima di promuoverlo.

## Integrità persistente dell'output

Durante l'export desktop ogni foglio viene codificato, trasferito e scritto subito in una sottocartella di staging sul filesystem di destinazione; il canvas viene poi rilasciato prima del foglio successivo. Prima di ogni pubblicazione FileX registra nel journal nome staged, nome finale e identità filesystem. Ogni file completo viene quindi pubblicato mediante hard link atomico no-overwrite: una collisione anche successiva al precheck non sostituisce mai il file concorrente. Se il volume non supporta hard link, FileX interrompe l'export e completa il rollback invece di usare una rinomina che potrebbe sovrascrivere.

I link di staging restano disponibili anche dopo la pubblicazione: il renderer riceve i nomi finali, salva sincronicamente `pendingExport` e soltanto allora chiama il finalize. Il finalize scrive un marker di acknowledgement prima di pulire lo staging; un errore di sola pulizia non trasforma quindi un batch già confermato in un falso fallimento. Se renderer o processo terminano prima dell'acknowledgement, il recovery usa il journal per rimuovere esclusivamente i nomi finali che hanno ancora la stessa identità dello staged; un file sostituito da terzi viene sempre preservato. Se il marker esiste, il recovery conserva invece i finali e rimuove soltanto lo staging residuo.

Ogni staging contiene inoltre identificativo, PID e data di creazione. All'apertura di una nuova transazione, FileX interviene soltanto sugli staging oltre la soglia di sicurezza il cui processo risulta certamente terminato; staging recenti, processi attivi, record non validi e link simbolici vengono preservati. La procedura copre crash del renderer e arresti del processo osservabili dal recovery. La durabilità durante un'interruzione fisica dell'alimentazione dipende comunque dalle garanzie del filesystem e viene sempre completata dalla verifica SHA-256 alla riapertura.

Dopo il commit transazionale, FileX ID Photo registra il contesto dell'export (`contextFingerprint`) e, per ogni file, percorso, dimensione, data di modifica e SHA-256 (`verifiedFiles`). Lo stato **Pronta alla stampa** viene assegnato soltanto se tutti i file appena creati possono essere riletti e verificati dal bridge desktop.

Il riferimento ai nomi finali viene messo al sicuro prima del finalize e prima di attendere la rilettura dal disco: sui byte codificati FileX calcola già size e SHA-256, associa tali valori ai nomi finali restituiti dalla pubblicazione e scrive sincronicamente un `pendingExport` con contesto, cartella, file, digest attesi e impostazioni. Se la scrittura del pending fallisce, il finalize non avviene e i finali vengono ritirati; se fallisce soltanto la prima fingerprint, l'operatore vede **File creati, verifica in attesa** e può riprovare la sola verifica. Una nuova esportazione dello stesso contesto resta bloccata, quindi il retry non crea copie con suffissi. Alla riapertura il pending viene recuperato; solo file con percorso, size e SHA uguali ai byte preparati vengono promossi, mentre file mancanti, sostituiti o una modifica del contesto lo invalidano senza dichiararlo pronto.

La stessa verifica viene eseguita quando la commessa viene riaperta e, per l'ultimo output ancora coerente con il contesto corrente, ogni 10 secondi durante la sessione. Un file assente o una differenza dimostrata di percorso, metadati o SHA-256 invalida il record e richiede un nuovo output.

Un reader non disponibile, un errore di accesso o un timeout producono invece uno stato temporaneo: `pendingExport` o il `lastExport` già verificato restano persistiti, **Pronta alla stampa** non viene concessa o viene sospesa e FileX riprova automaticamente. Il processo desktop interrompe l'intero batch dopo 10 secondi; il renderer applica un limite esterno di 12 secondi anche all'IPC. Monitor periodico, retry del pending e verifica finale post-export condividono lo stesso coordinatore single-flight: le operazioni vengono riusate o accodate e un timeout libera il lock per il tentativo successivo.

SHA-256 conferma che i byte sono gli stessi registrati dopo l'export. Non verifica da solo profilo documentale, resa del driver, scala 100%, carta o misura fisica: questi controlli restano separati e obbligatori.

## Calibrazione stampante e carta

Ogni profilo di calibrazione deve contenere:

    id
    nome stampante
    driver o coda rilevata
    carta e finitura
    formato foglio
    orientamento
    scala richiesta
    margini effettivi
    data della prova
    operatore
    misure rilevate
    stato

La calibrazione va invalidata quando cambiano stampante, driver, carta, formato o impostazioni di scala.

## Procedura di prova

1. Generare una pagina di calibrazione con rettangoli e righello misurabili.
2. Stampare tramite il driver reale con impostazione dimensione effettiva.
3. Misurare in millimetri più punti del foglio e della fototessera.
4. Registrare scostamenti, eventuale scala driver e margini.
5. Approvare il profilo solo entro la tolleranza definita per il documento.
6. Ripetere la prova per ogni combinazione stampante/carta supportata.

La tolleranza non va inventata in UI: dipende dal profilo documento, dalla stampante e dall'uso professionale; deve essere approvata e testata.

## Stampa nativa

Il bridge FileX espone un comando tipizzato che prepara i fogli alla risoluzione del profilo e apre il pannello nativo di Windows o macOS tramite Electron. Il percorso standard usa sempre `silent: false`, imposta foglio e margini fisici e distingue consegna al driver, annullamento del dialogo ed errore.

La consegna al driver non viene presentata come prova dell'avvenuta stampa. L'operatore deve controllare nel pannello scala 100% e assenza di adattamento pagina. I profili automatici stampante/carta e la compensazione basata su calibrazione fisica restano una funzione successiva; non bloccano l'apertura del dialogo manuale.

## Sicurezza di rendering

Il motore deve:

- calcolare pixel da millimetri e DPI;
- limitare lato canvas e memoria prima dell'allocazione;
- liberare canvas, blob e preview temporanee;
- evitare sovrascritture tramite nomi sicuri e progressivi;
- disegnare guide di taglio dalla geometria fisica;
- verificare quantità, orientamento, margini e crop prima dell'export.

## Flusso operativo al banco

1. L'operatore verifica la foto e il profilo.
2. FileX mostra il riepilogo: documento, copie, foglio, DPI e output.
3. L'operatore esporta foto singola e foglio oppure apre il pannello di stampa nativo.
4. Nel driver conferma formato carta, scala 100% e nessun adattamento pagina.
5. Dopo l'export, la commessa conserva data, profilo e file creati per la ristampa.

La ristampa deve riutilizzare l'output già approvato oppure generare nuovamente il piano con avviso se profilo, revisione o calibrazione sono cambiati.
