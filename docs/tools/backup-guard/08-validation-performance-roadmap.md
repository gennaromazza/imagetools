# Test, prestazioni e roadmap

## Matrice minima di validazione

- nuovo file master, nuovo file clone e file invariato;
- modifica master, modifica clone e modifica simultanea;
- cancellazione master, cancellazione clone e cancellazione simultanea;
- cartella cancellata con migliaia di discendenti;
- master non montato o parzialmente leggibile;
- clone errato con stessa lettera unita';
- disconnessione durante copia, verifica, commit e cancellazione;
- spazio esaurito e filesystem in sola lettura;
- file aperti, rinominati o modificati durante il piano;
- percorsi lunghi, Unicode, case collision e reparse point;
- catalogo Lightroom aperto, chiuso e modificato su entrambi;
- riavvio app e sistema con journal incompleto;
- evento Archivio Flow duplicato, fuori ordine o ricevuto offline.

Ogni caso distruttivo deve provare che il master non venga cancellato o sovrascritto.

## Budget iniziali

- avvio UI utile entro 3 secondi su macchina di riferimento;
- scansione incrementale senza hash completo come modalita' ordinaria;
- memoria del renderer sotto 300 MB durante scansioni estese;
- enumerazione streaming, senza conservare milioni di entry nel renderer;
- UI reattiva, aggiornamenti progresso limitati e annullamento sicuro;
- throughput vicino ai limiti del volume senza saturare stabilmente il sistema.

I numeri di throughput non diventano requisiti finche' non viene creata una macchina e un dataset di benchmark riproducibili.

## Milestone

### M0 - Specifica e identita'

Documentazione, logo, contratti e prototipo del piano.

### M1 - Scanner read-only

Associazione volumi, scansione, baseline iniziale e piano senza mutazioni. Gate: nessun falso positivo di cancellazione nei dataset di prova.

### M2 - Copia verificata

Master verso clone, staging, SHA-256, journal e ripresa.

### M3 - Cancellazioni e recupero

Propagazione master verso clone, cestino, soglie e cronologia.

### M4 - Lavoro fuori studio

Importazione di nuovi elementi dal clone e gestione completa dei conflitti.

### M5 - Lightroom e Archivio Flow

Pacchetti coerenti, lock, eventi nuovo lavoro e stato protezione.

### M6 - Suite e release

Scheda FileX, installer indipendente, catalogo remoto, sito download e monitoraggio release.

## Gate prima della prima release

- audit distruttivo completato;
- test crash/power-loss superati;
- verifica su archivio campione multi-terabyte;
- migrazioni database e rollback applicativo testati;
- installer, icone e aggiornamento indipendente verificati;
- contratto Archivio Flow idempotente;
- documentazione utente e runbook assistenza pronti.

