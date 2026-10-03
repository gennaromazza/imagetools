# Canale assistenza «Scrivici»

Stato al 3 ottobre 2026: backend, Suite, Dev Console, sito e test implementati. La pubblicazione della funzione e dell'app Suite segue la procedura di release.

## Cosa fa

L'utente apre **Assistenza** nella barra laterale di FileX Suite, sceglie tipo (problema, suggerimento, domanda) e strumento, indica l'email per la risposta e scrive il messaggio. Riceve un numero richiesta `SUP-XXXXXXXX`. Il messaggio arriva nella Dev Console, non per email.

Funziona anche senza licenza (chi deve ancora provare o acquistare può scrivere). Se il PC ha una licenza attiva il messaggio è marcato «licenza verificata» e collegato all'abbonamento.

## Flusso

```text
Suite (support.js) -> IPC filex:send-support-message -> support-message.ts
  -> POST /api/licensing/support/message (Cloud Function `api`) -> Firestore supportMessages/{SUP-...}
Dev Console (scheda Assistenza) -> scripts/filex-support-admin.mjs -> Firestore (login `firebase login`)
```

La route sta sotto `/licensing` perché il rewrite `/api/licensing/**` esiste già sul sito e sul dominio usato dalla Suite.

## Dati e privacy

Salvati: tipo, strumento, email, nome facoltativo, messaggio, informazioni tecniche solo se l'utente lascia spuntata la casella (versione Suite, sistema, stato licenza, lingua), `verifiedActivation` e `subscriptionId` se la licenza è valida. **Non** salvati: token di attivazione, chiave di licenza, id installazione, indirizzo IP in chiaro, foto, nomi di file o cartelle.

Conservazione: 12 mesi (`retentionExpiresAt`). La funzione pianificata `cleanupExpiredSessions` (ogni 15 minuti) elimina i messaggi scaduti con `purgeExpiredSupportMessages`; non si usa la TTL di Firestore perché l'account gcloud usato per la verifica non ha il permesso di configurarla. `node scripts/filex-support-admin.mjs purge` fa la stessa pulizia a mano.

Limiti anti-abuso (`licenseRateLimits`, chiavi in hash): 5 messaggi ogni 10 minuti per rete, 10 al giorno per installazione.

## Lettura (Dev Console)

Scheda **Assistenza**: elenco con badge dei nuovi, dettaglio, **Copia per Claude** (testo dell'utente in blocco recintato e dichiarato come dato, mai come istruzioni), cambio stato letto/risolto/riapri. Le rotte `/api/support/*` rispondono solo alla pagina della console (controllo di `Origin` e `Host`) perché la console ha CORS aperto e qui passano email di clienti. Da terminale: `npm run support:list`.

## Sviluppo

In una build non impacchettata la Suite **non scrive** al servizio di produzione, salvo `FILEX_LICENSE_API_URL`; il modulo mostra il ripiego «Scrivi con la tua email».

## Test

- `npm run test:filex-support`: validazione, limiti, Suite, interfaccia, chiusura dei moduli nel pacchetto, formato e sicurezza della Dev Console.
- `npm run test:filex-support-emulator`: scenario completo sul Firestore dell'emulatore (richiede Java 21).
- Prima di una release della Suite resta da eseguire lo smoke test del pacchetto reale (`test:filex-suite-package-imports`).
