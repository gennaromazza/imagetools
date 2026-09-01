# Architettura, persistenza e sicurezza

## Stato dell'architettura esistente

Il tool è implementato nel workspace **apps/id-photo** ed è distribuito come componente indipendente della FileX Suite. La versione 0.1.2 usa:

- renderer React/Vite e host Electron FileX;
- contratti IPC centralizzati in **@photo-tools/desktop-contracts**;
- selezione di una foto o cartella, drag & drop, anteprime native, editor esterno, cartella output e stampa tramite bridge desktop;
- dominio e profili versionati in **apps/id-photo/src/domain.ts**;
- persistenza locale delle commesse in **apps/id-photo/src/job-store.ts**;
- motore fisico ed export riusati dagli export pubblici di **@photo-tools/batch-print-layout**;
- API desktop dedicate per creare e pulire copie di lavoro Photoshop sotto l'area dati FileX.

Non fanno parte della versione 0.1.2 la calibrazione automatica e le Azioni Photoshop automatiche.

Queste capacità restano evoluzioni future e non devono essere presentate come già disponibili.

## Struttura attuale ed evoluzione

    apps/id-photo
      renderer React/Vite, dominio, profili e job store

    apps/batch-print-layout
      motore di stampa ed export riusato tramite export pubblici

    apps/filex-desktop
      IPC tipizzato, filesystem, copie di lavoro ed editor esterno

    packages/desktop-contracts
      tipi condivisi tra renderer e processo desktop

Un'eventuale estrazione futura in `packages/id-photo-domain` o `packages/id-photo-print` richiederà una decisione architetturale separata. Questi package non esistono oggi.

## Regole di dipendenza

1. Il dominio non dipende da React, DOM, Electron o filesystem.
2. Il renderer non riceve primitive arbitrarie per leggere, scrivere, eseguire processi o stampare.
3. Le mutazioni filesystem, il lancio Photoshop e l'eventuale stampa nativa risiedono nel processo desktop e passano da contratti tipizzati.
4. I tipi IPC comuni sono importati da **@photo-tools/desktop-contracts**; non sono duplicati nell'app.
5. L'estrazione del motore da Batch Print Layout deve mantenere i suoi test e la compatibilità del tool esistente.

## Modello dati persistito nel MVP

### Commessa

    id
    schemaVersion
    customer opzionale
    jobName
    createdAt
    updatedAt
    profileId
    folderPath
    selectedAssetId
    assets
    crops
    manualChecks
    technicalWarningsAccepted
    sheetId, copies, format, cutGuides
    outputDirectoryPath
    lastExport
    pendingExport
    status

Lo schema corrente è `filex-id-photo.jobs.v1` e non richiede il nome cliente per importare una foto. Ogni commessa accetta al massimo 500 foto: l'import desktop e il fallback browser applicano lo stesso limite, dichiarano i file eccedenti e decodificano in sequenza. La rail conserva thumbnail ridotte e lazy; una sola preview di dettaglio, limitata a 1600 px e revocata al cambio selezione, alimenta analisi e crop. Nel fallback browser l'Object URL della sorgente resta separato dalla thumbnail per non degradare l'export, ma l'originale non viene montato nella lista. La prima release non espelle commesse automaticamente: metadati e copie gestite restano disponibili finché l'operatore non conferma la cancellazione.

### Foto sorgente

    id
    fileName
    relativePath opzionale
    absolutePath opzionale
    originalAbsolutePath opzionale
    workingCopyPath opzionale
    size
    lastModified
    width
    height
    revisions

### Revisione

    kind: original | photoshop
    absolutePath
    createdAt
    size opzionale
    lastModified opzionale

Il riferimento alla foto non equivale alla copia dei byte nella persistenza. Le immagini restano nella cartella sorgente o nella cartella di lavoro gestita da FileX.

### Impostazioni di impaginazione ed export

    sheetId: 10x15 | 15x20
    copyCount
    crop
    format: PDF | JPG
    cutGuides
    outputDirectoryPath
    lastExport
    pendingExport

### Output pubblicato con verifica in attesa

La pubblicazione dei file e la verifica SHA-256 sono fasi distinte. Dopo che la transazione filesystem ha pubblicato i nomi finali ma **prima del finalize**, FileX salva sincronicamente `pendingExport` nel job store:

    completedAt
    contextFingerprint
    format
    files
    expectedFiles[]
        fileName
        size
        sha256
    outputDirectoryPath
    sheetId
    copies

`expectedFiles` viene calcolato sui byte già codificati nel renderer **prima** della pubblicazione e poi associato, nello stesso ordine, ai nomi finali restituiti dalla transazione, inclusi gli eventuali suffissi no-overwrite. Se questa scrittura locale fallisce, il renderer non invia il finalize e la shell esegue il rollback usando gli hard link e il journal ancora disponibili. Soltanto dopo il salvataggio del pending viene scritto il marker di acknowledgement e lo staging può essere eliminato. Il pending non adotta mai come baseline la prima lettura tardiva del disco: un file sostituito tra pubblicazione e retry viene rifiutato anche se nome e dimensione coincidono.

Il record non contiene ancora `verifiedFiles` e non abilita mai lo stato **Pronta alla stampa**. Se il reader SHA-256 fallisce, supera il timeout o l'app viene riaperta, FileX conserva i percorsi già pubblicati, mostra **File creati, verifica in attesa** e riprova esclusivamente la fingerprint sugli stessi file. Il pulsante di export viene sostituito da **Riprova verifica**, evitando una nuova pubblicazione e i conseguenti nomi con suffisso.

Solo una fingerprint completa di tutti i percorsi promuove `pendingExport` a `lastExport`. Un file mancante elimina il pending; una modifica a foto, crop, approvazioni, profilo, foglio, copie, formato, indicatori, nome commessa o cartella output lo scollega esplicitamente dal contesto corrente. I file già creati non vengono cancellati, ma non sono considerati pronti.

### Ultimo export verificato

`lastExport` non è un semplice elenco di nomi file: esiste soltanto dopo la promozione SHA-256 completa. Il record persistito contiene:

    completedAt
    contextFingerprint
    format
    files
    verifiedFiles[]
        absolutePath
        size
        lastModified
        sha256
    outputDirectoryPath
    sheetId
    copies

`contextFingerprint` lega lo stato pronto alla configurazione effettivamente approvata: commessa, foto selezionata e relativa versione, profilo, crop, controlli, foglio, numero di copie, formato, indicatori di taglio e cartella di destinazione. Non è una firma crittografica del documento; serve a impedire che un export precedente resti marcato come corrente dopo una modifica del lavoro.

`verifiedFiles` conserva, per ogni file creato, percorso assoluto, dimensione, data di modifica e impronta SHA-256. L'impronta viene calcolata dal processo desktop dopo il commit transazionale: ogni file completo viene pubblicato con un'operazione atomica no-overwrite, non scritto direttamente sul nome finale.

Alla riapertura della commessa FileX ricalcola le impronte dei file registrati. Finché l'ultimo export coincide con il contesto corrente, la verifica viene ripetuta ogni 10 secondi durante la sessione. Gli esiti sono distinti:

- **valido:** tutti i percorsi, metadati e SHA-256 coincidono; lo stato **Pronta alla stampa** può essere mostrato;
- **invalido:** un file è mancante oppure percorso, metadati o SHA-256 dimostrano che è stato sostituito o modificato; FileX elimina il riferimento all'ultimo export verificato e richiede un nuovo export;
- **temporaneamente indisponibile:** il reader non è disponibile, restituisce un errore o supera il timeout; FileX conserva `lastExport` e `verifiedFiles`, sospende lo stato pronto e riprova automaticamente.

Il processo desktop usa API asincrone e limita a 10 secondi l'intero batch di lettura, interrompendo anche lo stream SHA-256 corrente; il renderer mantiene un limite esterno di 12 secondi per coprire anche un'IPC che non risponde. La lettura confronta prima e dopo hash dimensione, mtime, ctime e identità filesystem `dev/ino`, così una sostituzione concorrente del path non può associare lo SHA del vecchio file al nuovo. Monitor periodico, promozione del pending e verifica post-export attraversano lo stesso coordinatore **single-flight**: la stessa richiesta viene condivisa, richieste diverse vengono accodate e, allo scadere del limite, il lock viene liberato per consentire un vero retry. Un timeout o un errore di lettura, da solo, non prova che il file sia cambiato e quindi non cancella né `pendingExport` né un `lastExport` già verificato.

La verifica prova l'identità dei byte esportati; non certifica l'accettazione della fotografia da parte dell'ente né la misura fisica della stampa.

## Persistenza locale

L'MVP salva preferenze e commesse versionate nel `localStorage` del renderer. Conserva riferimenti ai file, profilo, crop, verifiche manuali, impostazioni di impaginazione, revisioni Photoshop, output in attesa e ultimo export con le impronte SHA-256; non incorpora i byte delle fotografie o degli output nel record.

Il registro è limitato a 250 commesse e a 2.000.000 di caratteri serializzati, così da conservare margine rispetto alla quota dello storage. Raggiunto uno dei limiti, FileX non espelle né tronca commesse esistenti: rifiuta la nuova scrittura, mantiene i dati già salvati, mostra uno stato persistente **Non salvato** e chiede di liberare spazio prima della chiusura. Anche un errore quota restituito dal browser segue lo stesso percorso esplicito; il salvataggio preferenze è gestito separatamente e non può interrompere l'autosave della commessa.

Se il renderer blocca la chiusura perché commessa o preferenze non sono ancora al sicuro, la shell desktop rispetta il blocco e mostra un dialogo nativo con **Resta e salva** come scelta predefinita. La finestra viene distrutta soltanto dopo la scelta esplicita **Chiudi comunque**; richieste ripetute durante il dialogo non aprono conferme sovrapposte.

Una richiesta di uscita non avvia in anticipo il rollback globale o lo spegnimento dei servizi nativi: la shell tenta prima la chiusura della finestra. Se l'utente resta, servizi e transazioni continuano a funzionare; lo shutdown nativo parte soltanto dopo che la finestra è stata realmente chiusa perché il salvataggio è riuscito o perché l'utente ha confermato la chiusura.

Alla riapertura FileX controlla i percorsi registrati, rigenera le anteprime disponibili, segnala separatamente le sorgenti mancanti e verifica nuovamente gli output persistiti. I record corrotti o incompatibili vengono scartati in sicurezza dai parser del job store.

Un database locale con migrazioni, ad esempio SQLite, resta una possibile evoluzione e non è una dipendenza della prima release. Prima di alzare i limiti o aggiungere archiviazione automatica serve una policy prodotto esplicita: nessuna commessa viene cancellata silenziosamente.

## Gestione dei file

Su Windows le copie Photoshop sono create direttamente nel profilo locale dell'utente, fuori da Immagini, Documenti e Desktop che possono essere reindirizzati automaticamente da OneDrive. Il percorso è stato verificato con la policy di accesso file di Photoshop 2026:

    <Home>/FileX-ID-Photo-Data/id-photo/working/job-<id-commessa>/

Sugli altri sistemi la radice resta `<userData>/id-photo-data/`. Il percorso effettivo è deciso dal processo desktop e non dal renderer.

Le regole sono:

- l'originale non viene mai aperto in scrittura dal tool;
- Photoshop riceve una copia byte per byte creata atomicamente con nome univoco;
- ogni ricarica da Photoshop archivia uno snapshot separato, che resta selezionabile per il rollback finché l'operatore non pulisce esplicitamente le copie della commessa;
- il rollback parte dallo snapshot scelto e crea una nuova copia modificabile, senza alterare la revisione archiviata;
- un output non sovrascrive mai un file esistente senza scelta esplicita;
- i nomi sono sanificati per Windows;
- la pulizia ricorsiva è confinata alla sola cartella della commessa e rifiuta traversal, file inattesi e collegamenti pericolosi;
- la rimozione della commessa richiede conferma e non elimina originali o output esportati;
- l'operatore può pulire soltanto copie e snapshot Photoshop, dopo conferma, mantenendo la commessa e tornando ai file originali disponibili;
- un “Salva con nome” da Photoshop viene accettato solo tramite selezione esplicita di JPG, PNG o TIFF flattenato diverso dall'originale.

## Privacy e dati facciali

Le fotografie dei clienti sono dati personali e richiedono una progettazione prudente. La definizione europea di dato biometrico riguarda dati ottenuti con trattamento tecnico specifico che consentano o confermino l'identificazione univoca. Il progetto non deve costruire questa capacità.

Fonti di riferimento:

- [Regolamento UE 2016/679, definizione di dati biometrici](https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng);
- [Provvedimento del Garante del 10 aprile 2025](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10140338).

Requisiti di progetto:

- nessun upload o telemetria delle immagini;
- nessun database di volti o confronto con identità;
- informativa del negozio e cancellazione esplicita delle copie gestite; un'eventuale retention temporale configurabile richiederà una fase successiva;
- controllo per eliminare temporanei e versioni di lavoro;
- audit tecnico minimo senza registrare l'immagine o dati superflui;
- valutazione privacy e legale prima della distribuzione commerciale.

Questo documento non sostituisce una valutazione legale o una DPIA, se applicabile.

## Sicurezza del bridge desktop

Ogni API nuova deve:

- validare tipo, dimensione e percorso degli input;
- normalizzare i path e rifiutare uscite dalla radice autorizzata;
- non esporre accesso shell generico al renderer;
- non accettare comandi arbitrari da una pagina web;
- ritornare errori utili ma privi di dati non necessari;
- trattare il file Photoshop rientrato come input non fidato e decodificarlo di nuovo;
- invalidare anteprime e cache quando file, dimensione o timestamp cambiano.

## Recupero da interruzioni

Un crash, una chiusura di Photoshop o un errore durante l'export non deve lasciare la commessa in uno stato ambiguo. All'apertura successiva l'app deve:

1. verificare le sorgenti riferite;
2. indicare le versioni mancanti;
3. rendere visibile l'ultima revisione valida;
4. permettere di ricollegare una versione Photoshop;
5. richiedere una nuova generazione dell'output se il piano o il profilo è cambiato;
6. riprendere la sola fingerprint di un `pendingExport` già pubblicato, senza generare duplicati;
7. non dedurre che un export o una futura stampa siano riusciti soltanto perché il processo è stato avviato.
