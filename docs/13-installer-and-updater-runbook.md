# FileX Suite Desktop - Installer & Updater Runbook

## SOP Installazione Nuovo Studio

1. Installare `FileX Suite` (launcher).
2. Avviare wizard iniziale.
3. Selezionare tool richiesti dallo studio.
4. Eseguire install on-demand da launcher.
5. Verificare apertura tool e runtime desktop.

## SOP Aggiornamento

1. Aprire launcher.
2. `Controlla update` per tool.
3. `Installa/Aggiorna`.
4. Verificare checksum e avvio installer.
5. Riavviare tool interessato.

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
- Nessun crash all'avvio nei primi 2 minuti.
