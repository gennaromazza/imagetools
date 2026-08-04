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
6. FileX registra i tool aperti, chiude tutti i processi della Suite e applica l'aggiornamento.
7. Al termine FileX Suite riparte automaticamente e riapre i tool che erano in esecuzione.

La chiusura viene richiesta prima in modo ordinato. Solo i processi che non rispondono vengono terminati, così l'installer non trova file bloccati. Salvare sempre il lavoro prima di confermare un aggiornamento.

Il pulsante `Aggiorna` non appartiene all'aggiornamento della Suite: compare solo nella scheda del singolo tool quando la versione pubblicata è più recente.

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
- Suite riavviata e tool precedentemente aperti ripristinati dopo l'aggiornamento.

## Chiusura di una pubblicazione

Una pubblicazione e' conclusa solo dopo aver verificato GitHub Release, GitHub Pages e il manifest remoto. Seguire `docs/18-publish-build-contract.md` per la checklist completa.
