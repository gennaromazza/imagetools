# FileX Suite Desktop - Installer & Updater Runbook

## SOP Installazione Nuovo Studio

1. Installare `FileX Suite` (launcher).
2. Avviare wizard iniziale.
3. Selezionare tool richiesti dallo studio.
4. Eseguire install on-demand da launcher.
5. Verificare apertura tool e runtime desktop.

## SOP Aggiornamento per ogni tool

FileX Suite si aggiorna separatamente dai tool. Ogni tool installato usa lo stesso flusso:

1. Aprire FileX Suite.
2. Premere il refresh nella barra laterale per rileggere il manifest remoto `stable.json`.
3. Nella scheda del tool verificare la versione installata e quella disponibile.
4. Quando compare `Aggiorna`, premere quel pulsante nella scheda del tool interessato.
5. Attendere download, verifica SHA-256 e avvio dell'installer Windows.
6. FileX chiude SOLO il tool da aggiornare, poi esegue l'installer NSIS per-user con `/S`.
7. La Suite e gli altri tool FileX restano aperti durante l'intero aggiornamento.
8. Al termine il tool aggiornato viene riaperto automaticamente se era in esecuzione.

L'installer NSIS installa in `%LOCALAPPDATA%\Programs\<ToolName>`: nessun privilegio amministratore, nessun UAC e nessun riavvio della Suite. La chiusura del tool viene richiesta prima in modo ordinato; solo i processi che non rispondono vengono terminati, così l'installer non trova file bloccati. Salvare sempre il lavoro prima di confermare un aggiornamento.

La versione installata è sempre visibile nel titolo della finestra di ogni tool (`Nome tool — Versione X.Y.Z`) ed è ricavata dal package Electron, la stessa sorgente usata dagli installer e dalla Suite.

Il pulsante `Aggiorna` non appartiene all'aggiornamento della Suite: compare solo nella scheda del singolo tool quando la versione pubblicata è più recente.

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

## Checklist Post-Install

- Runtime info disponibile da tool.
- Apertura cartelle native funzionante.
- Build/versione coerente con release manifest.
- Ogni tool installato mostra `Aggiorna` quando la release remota è più recente.
- Nessun crash all'avvio nei primi 2 minuti.
- Dopo l'aggiornamento: Suite ancora aperta, altri tool ancora aperti e tool aggiornato riaperto se era in esecuzione.
- L'installazione del tool è in `%LOCALAPPDATA%\Programs\<ToolName>` e l'uninstall è visibile in `Impostazioni > App`.

## Chiusura di una pubblicazione

Una pubblicazione e' conclusa solo dopo aver verificato GitHub Release, GitHub Pages e il manifest remoto. Seguire `docs/18-publish-build-contract.md` per la checklist completa.

## Verifica release 0.1.24

La release stabile `v0.1.24` deve esporre gli installer Windows di FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow, oltre a blockmap e `latest.yml` della Suite. Per ogni tool il manifest stabile deve indicare versione `0.1.24`, URL riferito al tag e checksum SHA-256 valido.

Da una vecchia installazione verificare due percorsi distinti: l'aggiornamento automatico di FileX Suite tramite `latest.yml` e il pulsante `Aggiorna` nella scheda Image Select Pro tramite `stable.json`. Dopo il secondo aggiornamento il titolo della finestra deve mostrare `Image Select Pro — Versione 0.1.24`.

Con FileX Suite aperta, verificare inoltre che la lettura della versione installata non mantenga un lock su `resources/app.asar`. L'aggiornamento silenzioso di Image Select Pro deve completarsi senza la finestra "Impossibile disinstallare i vecchi file"; un lock transitorio deve produrre codice `2`, essere ritentato dalla Suite e terminare entro il timeout previsto.
