# StudioFlow — Macchina a stati dell’importazione

`CREATED → ANALYZING → READY → IMPORTING → VERIFYING → COMPLETED`

Transizioni alternative:

- qualsiasi fase operativa → `CANCELLED` su richiesta utente;
- errore recuperabile/non recuperabile → `FAILED` con codice e messaggio;
- chiusura del processo durante una fase operativa → `INTERRUPTED` al riavvio;
- pausa esplicita → `PAUSED`.

`COMPLETED` richiede copertura deterministica di tutti i file pianificati. `verified_at` viene valorizzato soltanto dopo la verifica; non è ammesso derivarlo dal solo successo della chiamata di copia. Le sessioni `PAUSED`, `INTERRUPTED` e `FAILED` sono elencabili per il recupero. Il resume riparte dai record non terminali e riconferma l’esistenza dei record già verificati.
