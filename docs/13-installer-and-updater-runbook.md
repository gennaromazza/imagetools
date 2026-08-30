# FileX Suite Desktop - Installer & Updater Runbook

## SOP Installazione Nuovo Studio

1. Installare `FileX Suite` (launcher).
2. Avviare wizard iniziale.
3. Inserire la licenza FileX All Access per sbloccare l'ambiente condiviso, se necessaria per i tool desiderati.
4. Selezionare i tool richiesti dallo studio.
5. Eseguire install on-demand da launcher.
6. Verificare apertura tool e runtime desktop.

*(N.B: Per sapere come creare e distribuire un nuovo tool su questo catalogo, consultare il **[Runbook Creazione e Rilascio di un Nuovo Tool (22-new-tool-creation-runbook.md)](./22-new-tool-creation-runbook.md)**)*

## SOP Aggiornamento per ogni tool

FileX Suite si aggiorna separatamente dai tool. Ogni tool installato usa lo stesso flusso:

1. Aprire FileX Suite.
2. Premere il refresh nella barra laterale per rileggere il catalogo remoto dei tool.
3. Nella scheda del tool verificare la versione installata e quella disponibile.
4. Quando compare `Aggiorna`, premere quel pulsante nella scheda del tool interessato.
5. Attendere download, verifica SHA-256 e avvio dell'installer Windows.
6. FileX chiude SOLO il tool da aggiornare, poi esegue l'installer NSIS per-user con `/S`.
7. La Suite e gli altri tool FileX restano aperti durante l'intero aggiornamento.
8. Al termine il tool aggiornato viene riaperto automaticamente se era in esecuzione.

L'installer NSIS installa in `%LOCALAPPDATA%\Programs\<ToolName>`: nessun privilegio amministratore, nessun UAC e nessun riavvio della Suite. La chiusura del tool viene richiesta prima in modo ordinato; solo i processi che non rispondono vengono terminati, così l'installer non trova file bloccati. Salvare sempre il lavoro prima di confermare un aggiornamento.

La versione installata è sempre visibile nel titolo della finestra di ogni tool (`Nome tool — Versione X.Y.Z`) ed è ricavata dal package Electron, la stessa sorgente usata dagli installer e dalla Suite.

Il pulsante `Aggiorna` non appartiene all'aggiornamento della Suite: compare solo nella scheda del singolo tool quando la versione pubblicata è più recente. Il comando `Aggiorna FileX Suite` interroga invece soltanto il feed dedicato `suite-channel-stable`.

### Migrazione da installazioni per-machine

Le versioni precedenti al passaggio per-user sono installate in `C:\Program Files\...` e richiedono privilegi amministrativi. La Suite `detectInstalledExecutable()` cerca sia `%LOCALAPPDATA%\Programs` sia `Program Files` e sceglie la versione più recente, quindi per la prima versione per-user può rimanere temporaneamente anche la vecchia installazione per-machine. Dopo aver verificato il corretto funzionamento della nuova architettura, è possibile rimuovere manualmente le vecchie installazioni per-machine.

### Risoluzione problemi

- Se compare `Pronto` ma è disponibile una release più recente, chiudere e riaprire FileX Suite e premere il refresh.
- Se un tool viene installato con una versione vecchia, aggiornare prima FileX Suite: la Suite deve poter leggere il manifest remoto della release corrente.
- Verificare che il computer possa raggiungere `github.com` e `release-assets.githubusercontent.com` tramite HTTPS.
- Se il problema persiste, controllare il percorso dell'eseguibile installato e la versione mostrata nella scheda del tool.

## Rollback Operativo

- Se update fallisce:
  - consultare log update locale
  - reinstallare versione precedente da asset release
  - congelare canale su `stable` fino a fix

## Uninstall Sicuro

- Tool disinstallabili separatamente.
- Launcher non deve rimuovere tool non selezionati esplicitamente.
- Disinstallazione launcher non tocca dati operativi tool (cache/progetti) salvo scelta utente.
- Nessuno stato licenza (`unlicensed`, `expired` o `revoked`) può impedire la disinstallazione.
- Dopo disinstallazione e reinstallazione, il tool deve ripetere il controllo previsto dalla propria policy e non deve ereditare bypass di sviluppo.
- L'eventuale chiamata di disattivazione per liberare uno slot dispositivo è best-effort: un PC offline o un backend non disponibile non devono bloccare l'uninstaller.

## Checklist Post-Install

- Runtime info disponibile da tool.
- Apertura cartelle native funzionante.
- Build/versione coerente con release manifest.
- Ogni tool installato mostra `Aggiorna` quando la release remota è più recente.
- Nessun crash all'avvio nei primi 2 minuti.
- Dopo l'aggiornamento: Suite ancora aperta, altri tool ancora aperti e tool aggiornato riaperto se era in esecuzione.
- L'installazione del tool è in `%LOCALAPPDATA%\Programs\<ToolName>` e l'uninstall è visibile in `Impostazioni > App`.
- Con enforcement reale, ogni tool soggetto a licenza è bloccato senza entitlement e si apre con licenza `active` o `grace`.
- Dopo un ciclo disinstallazione/reinstallazione, la policy licenze resta applicata e la rimozione completa non dipende dalla raggiungibilità del servizio licenze.
- Per FileX Send verificare entrambe le modalità: doppio QR sulla rete locale e link remoto con scadenza impostata dal fotografo.
- Chiudere FileX Send durante un upload remoto di prova, completare l'invio dal telefono e riaprire il tool: il file deve essere scaricato automaticamente nella cartella della sessione e deve comparire la notifica Windows.
- Dopo la conferma del download il file non deve più comparire nella coda desktop; la risposta API deve indicare una retention residua di circa 60 minuti.

## Chiusura di una pubblicazione

Una pubblicazione e' conclusa solo dopo aver verificato GitHub Release, Firebase Hosting e il manifest remoto. Seguire `docs/18-publish-build-contract.md` per la checklist completa.

## Migrazione ai canali indipendenti

La prima pubblicazione della nuova architettura deve essere `suite-v0.1.26`. Va installata e verificata prima di pubblicare nuovi tag dei tool: questa versione sposta l'updater Suite su `suite-channel-stable` e il catalogo tool su `update-catalog-stable`. Solo dopo la verifica remota della Suite 0.1.26 si possono creare release tool namespaced.

## Verifica release 0.1.25

La release stabile `v0.1.25` deve esporre gli installer Windows di FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow, oltre a blockmap e `latest.yml` della Suite. Per ogni tool il manifest stabile deve indicare versione `0.1.25`, URL riferito al tag e checksum SHA-256 valido.

Da una vecchia installazione verificare due percorsi distinti: l'aggiornamento automatico di FileX Suite tramite `latest.yml` e il pulsante `Aggiorna` nella scheda Image Select Pro tramite `stable.json`. Dopo il secondo aggiornamento il titolo della finestra deve mostrare `Image Select Pro — Versione 0.1.25`.

Con FileX Suite aperta, verificare inoltre che la lettura della versione installata non mantenga un lock su `resources/app.asar`. L'aggiornamento silenzioso di Image Select Pro deve completarsi senza la finestra "Impossibile disinstallare i vecchi file"; un lock transitorio deve produrre codice `2`, essere ritentato dalla Suite e terminare entro il timeout previsto.

In Quick Preview verificare che il controllo `Avanza dopo classificazione` sia visibile sopra la testata. Con il controllo in `OFF`, assegnare una stella, Pick/Scarta, un colore e un'etichetta: la foto deve restare corrente e la navigazione manuale con le frecce deve continuare a funzionare. Riavviando il tool, la preferenza deve restare invariata.

Con un filtro stelle attivo, verificare che pannello Filtri, pannello Selezione e barra inferiore distinguano senza ambiguita il totale nella cartella, il totale nel progetto e le foto visibili con i filtri.

## Verifica Image Select Pro 0.1.26

La release `photo-selector-app-v0.1.26` deve contenere esclusivamente l'installer Windows x64 di Image Select Pro, la relativa blockmap e `stable.json`. Non deve produrre installer della Suite o di altri tool.

Nel catalogo `update-catalog-stable`, la voce `photo-selector-app` deve indicare versione `0.1.26`, URL riferito al tag namespaced e checksum SHA-256 valido; le versioni degli altri tool devono restare invariate.

Prima della pubblicazione verificare gli scenari `BROWSE-01` e `SELECT-03`–`SELECT-05` in `docs/tools/photo-selector-audit.md`. Dopo l'aggiornamento, il titolo deve mostrare `Image Select Pro — Versione 0.1.26` e FileX Suite deve restare aperta.

## Verifica Image Select Pro 0.1.27

La release `photo-selector-app-v0.1.27` deve contenere esclusivamente l'installer Windows x64 di Image Select Pro, la relativa blockmap e `stable.json`. FileX Suite e gli altri tool devono rimanere invariati.

Nel catalogo `update-catalog-stable`, la sola voce `photo-selector-app` deve passare da 0.1.26 a 0.1.27, mantenere `minLauncherVersion` 0.1.26 e puntare all'installer della release namespaced con checksum SHA-256 valido.

Aprire un progetto, selezionare rapidamente foto diverse mentre e' attivo il rilevamento delle modifiche esterne, quindi chiudere la vista. Non devono comparire aggiornamenti tardivi o errori dopo la chiusura. Dopo l'installazione il titolo deve mostrare `Image Select Pro — Versione 0.1.27`, la Suite deve restare aperta e la scheda deve passare a `Pronto`.

## Verifica FileX Suite 0.1.27

La release `suite-v0.1.27` deve contenere esclusivamente l'installer Windows x64 della Suite, la relativa blockmap e `latest.yml`. Il feed `suite-channel-stable` deve inoltre esporre `latest.yml`, l'installer versionato e l'alias stabile della Suite.

Dopo l'aggiornamento della Suite, installare o aggiornare Image Select Pro 0.1.26 dalla relativa scheda. La verifica post-installazione deve leggere la versione dall'ASAR virtuale di Electron, non deve mostrare l'errore "non è stato possibile verificarne la versione" e la scheda deve passare a `Pronto` senza riproporre lo stesso aggiornamento.

## Verifica FileX Suite 0.1.28 e Adobe Cleaner 0.1.0

Pubblicare prima `suite-v0.1.28`: la release e il feed `suite-channel-stable` devono contenere esclusivamente installer Suite x64, blockmap e `latest.yml`. Dopo l'aggiornamento, la Suite deve mostrare la nuova scheda **FileX Adobe Cleaner**.

Pubblicare quindi `cache-sweep-v0.1.0`: la release deve contenere esclusivamente `FileX-Adobe-Cleaner-0.1.0-stable-x64-setup.exe`, blockmap e `stable.json`. La voce `cache-sweep` del catalogo deve avere `minLauncherVersion` 0.1.28, URL sul tag namespaced e checksum SHA-256 valido; tutte le altre voci devono restare invariate.

Dalla Suite 0.1.28 verificare `Installa`, apertura del tool e stato `Pronto`. Su un PC con due versioni principali dello stesso programma Adobe verificare che venga proposta solo la versione precedente e che la versione corrente sia esclusa. La disinstallazione deve usare Adobe HDBox, conservare le preferenze e mostrare UAC; in assenza di HDBox deve fermarsi senza cancellare cartelle manualmente.

## Verifica FileX Suite 0.1.29

La release `suite-v0.1.29` deve contenere esclusivamente l'installer Windows x64 della Suite, la relativa blockmap e `latest.yml`. Il feed `suite-channel-stable` deve proporre la versione 0.1.29 senza modificare le versioni presenti nel catalogo dei tool.

Dopo l'aggiornamento verificare che FileX Adobe Cleaner compaia in `Utility` e che `Utility Adobe` non sia più presente. Creare due sezioni personali, assegnare lo stesso tool a entrambe sia dal comando `Sezioni` sia tramite trascinamento, quindi riavviare la Suite e verificare la persistenza. Rinomina, riordino, eliminazione e ripristino predefinito non devono disinstallare tool né rimuovere dati applicativi.

## Verifica FileX Suite 0.1.30

La release `suite-v0.1.30` deve contenere esclusivamente l'installer Windows x64 della Suite, la blockmap e `latest.yml`. Creare una sezione personale, premere la matita e verificare che il nome diventi modificabile direttamente nella finestra. Confermare una rinomina con `Invio` e con il pulsante di conferma; verificare inoltre l'annullamento con `Esc`. Il nuovo nome e le assegnazioni dei tool devono restare invariati dopo il riavvio della Suite.

## Verifica FileX Suite 0.1.31 e FileX Send 0.1.0

Pubblicare prima `suite-v0.1.31`: release e feed Suite devono contenere soltanto installer Suite x64, blockmap e `latest.yml`. Dopo l'aggiornamento, la scheda **FileX Send** deve comparire nella sezione `Consegna` senza modificare le sezioni personali esistenti.

Pubblicare quindi `filex-send-v0.1.0`: la release deve contenere soltanto `FileX-Send-0.1.0-stable-x64-setup.exe`, blockmap e `stable.json`. Nel catalogo dedicato la voce `filex-send` deve avere `minLauncherVersion` 0.1.31, URL sul tag namespaced e checksum SHA-256 valido; tutte le altre voci devono restare invariate.

Dalla Suite 0.1.31 verificare `Installa`, apertura e stato `Pronto`. Provare il doppio QR locale e un invio remoto a FileX Send chiuso: alla riapertura il file deve essere scaricato automaticamente, la coda cloud deve svuotarsi e la retention restituita dal server deve essere di circa 60 minuti.

## Verifica FileX Send 0.1.1

La release `filex-send-v0.1.1` deve contenere esclusivamente installer FileX Send x64, blockmap e `stable.json`; Suite e altri tool non devono essere ricostruiti. Il catalogo deve aggiornare soltanto `filex-send` da 0.1.0 a 0.1.1, conservando `minLauncherVersion` 0.1.31.

Creare un link remoto, completare un primo gruppo di file e verificare che la pagina mostri **Invia altri file**. Senza riaprire FileX Send sul PC, inviare un secondo gruppo dallo stesso link: entrambi devono comparire e scaricarsi alla riapertura. Soltanto la scadenza o **Archivia invio** devono produrre `Sessione chiusa o scaduta`.

## Verifica FileX Send 0.1.2

La release `filex-send-v0.1.2` deve contenere esclusivamente installer FileX Send x64, blockmap e `stable.json`; Suite e altri tool devono restare invariati. Il catalogo deve aggiornare soltanto `filex-send` da 0.1.1 a 0.1.2 e conservare `minLauncherVersion` 0.1.31.

Installare la 0.1.1, quindi applicare la 0.1.2 dalla Suite. L'installer silenzioso deve terminare con codice `0`, preservare dati e impostazioni e non richiedere una disinstallazione manuale. Dopo l'avvio, il titolo della finestra deve mostrare `FileX Send — Versione 0.1.2` e la scheda della Suite deve passare a `Pronto`.

## Verifica FileX Send 0.1.3

La release `filex-send-v0.1.3` deve contenere esclusivamente `FileX-Send-0.1.3-stable-x64-setup.exe`, blockmap e `stable.json`. Il catalogo deve aggiornare soltanto `filex-send`, conservando `minLauncherVersion` 0.1.31; FileX Suite e gli altri tool devono restare invariati.

Verificare i quattro percorsi: ricezione e invio, sia locale sia remoto. Nell'invio locale il QR deve mostrare soltanto i file selezionati e ogni download deve conservare nome e contenuto. Nell'invio remoto il desktop deve completare il caricamento prima di mostrare il link; il telefono deve vedere la lista di download fino alla scadenza e **Termina condivisione** deve revocare immediatamente il link. Per la ricezione mobile verificare i pulsanti distinti **Scegli dalla galleria** e **Sfoglia altri file**, la selezione multipla e le anteprime.

## Verifica FileX Suite 0.1.32 — licenze prova

La release `suite-v0.1.32` deve contenere esclusivamente l'installer Windows x64 della Suite, la relativa blockmap e `latest.yml`. Il feed `suite-channel-stable` deve proporre 0.1.32 senza cambiare le versioni del catalogo tool.

Dopo l'aggiornamento, aprire la gestione licenza, attivare una chiave generata con `Crea licenza prova FileX.cmd` e verificare lo stato `active`, il conteggio `1 di 2` e la persistenza dopo il riavvio. Ripetere su un secondo PC e verificare che il terzo venga rifiutato. Disattivare il PC corrente e controllare che lo slot venga liberato. Durante questa fase `enforcement` deve restare `observe`: un problema di licenza non deve bloccare i tool.

## Verifica FileX Suite 0.1.33 — licenze e Backup Guard

La release `suite-v0.1.33` deve contenere esclusivamente l'installer Windows x64 della Suite, la relativa blockmap e `latest.yml`. Il feed `suite-channel-stable` deve proporre 0.1.33 senza cambiare le versioni del catalogo tool.

Con una licenza attiva, aprire **Gestisci licenza** e premere **Verifica ora**: il pulsante deve mostrare `Verifica...`, poi tornare cliccabile e visualizzare una conferma con l'orario. La scheda **FileX Backup Guard** deve mostrare il logo dedicato, la categoria `Utility` e la descrizione completa. Con enforcement remoto `enforce`, un PC privo di licenza attiva o prova manuale non deve poter aprire i tool; la gestione licenza e gli aggiornamenti della Suite devono restare accessibili.

## Verifica FileX Suite 0.1.34 — dock Windows

La release `suite-v0.1.34` deve contenere esclusivamente l'installer Windows x64 della Suite, la relativa blockmap e `latest.yml`. Il feed `suite-channel-stable` deve proporre 0.1.34 senza cambiare le versioni del catalogo tool.

Con la dock ridotta verificare che non compaia alcuna ombra rettangolare appartenente alla finestra trasparente. Nei temi chiaro e scuro il bordo e l'ombra devono seguire la sagoma arrotondata. Espandere la dock e verificare il separatore tra Suite e strumenti, l'ingresso morbido delle icone, la magnification contenuta, il riordino tramite trascinamento e il focus visibile da tastiera. Riduzione automatica, impostazioni e apertura dei tool devono restare operative.

## Verifica FileX Backup Guard 0.2.0-beta.1

La prerelease `backup-guard-v0.2.0-beta.1` deve contenere esclusivamente `FileX-Backup-Guard-0.2.0-beta.1-beta-x64-setup.exe`, blockmap e `beta.json`. FileX Suite e gli altri tool devono rimanere invariati.

Nel catalogo `update-catalog-beta`, la voce `backup-guard` deve indicare versione `0.2.0-beta.1`, `minLauncherVersion` 0.1.33, URL sul tag namespaced e checksum SHA-256 valido. Su FileX Suite 0.1.33 o successiva, selezionare il canale beta e verificare che la scheda proponga l'installazione.

Eseguire un collaudo con volumi fisici distinti: copia iniziale, file nuovo sul clone, modifica master, cancellazione master confermata, ripristino dal cestino, conflitto, catalogo Lightroom aperto, pausa e annullamento. Il master non deve essere cancellato o sovrascritto automaticamente in nessuno scenario.

## Verifica FileX Backup Guard 0.2.0

La release stabile `backup-guard-v0.2.0` deve contenere esclusivamente `FileX-Backup-Guard-0.2.0-stable-x64-setup.exe`, la relativa blockmap e `stable.json`. FileX Suite e gli altri tool devono rimanere invariati.

Nel catalogo `update-catalog-stable`, la voce `backup-guard` deve indicare versione `0.2.0`, `minLauncherVersion` 0.1.33, URL sul tag namespaced e checksum SHA-256 valido. FileX Suite 0.1.33 o successiva deve proporre l'installazione dalla normale scheda del tool, senza selezionare un canale beta.

Ripetere il collaudo della beta con volumi fisici distinti e verificare inoltre l'aggiornamento da `0.2.0-beta.1`: configurazione, associazione master-clone, cronologia e cestino devono restare disponibili. Il master non deve essere cancellato o sovrascritto automaticamente in nessuno scenario.

## Verifica FileX Suite 0.1.35 — dock ridotta trasparente

La release `suite-v0.1.35` deve contenere esclusivamente l'installer Windows x64 della Suite, la relativa blockmap e `latest.yml`. Il feed `suite-channel-stable` deve proporre 0.1.35 senza cambiare le versioni del catalogo tool.

Ridurre la dock sopra una superficie chiara e verificare che attorno all'icona non compaiano rettangoli grigi o aree sfocate corrispondenti ai limiti della finestra Electron. In stato ridotto devono essere disattivati sfondo, bordo, ombra e `backdrop-filter` del contenitore; l'espansione deve ripristinare normalmente l'effetto vetro e tutti i controlli.

## Verifica hotfix FileX Suite successiva alla 0.1.57 — avvio Dock opzionale

Partire da FileX Suite 0.1.57 installata e mantenere attiva la Dock Station. Chiudere completamente la Suite, quindi avviarla con `--filex-background` come avviene all'accesso di Windows: la finestra principale deve restare nascosta e la Dock deve comparire. Aprire poi normalmente la Suite e verificare che venga mostrata una sola Dock, senza duplicati.

Dalle impostazioni della Dock scegliere **Disattiva Dock** e confermare. La finestra Dock deve chiudersi e non deve ricomparire né all'avvio automatico né aprendo manualmente la Suite. Dal menu dell'icona FileX vicino all'orologio riattivare **Dock Station** e verificare che la finestra venga ricreata immediatamente, conservando posizione, opacità, ordine e riduzione automatica. La preferenza deve persistere dopo riavvio, aggiornamento e reinstallazione della sola Suite; licenza, profilo e tool installati devono restare invariati.
