# Prova gratuita FileX All Access

Implementazione locale: 7 settembre 2026. Richiede pubblicazione coordinata di backend, sito, Suite e tool; il sito da solo non abilita gli installer distribuiti.

## Flusso

La Suite Windows crea una sessione di 20 minuti e apre `/account/#trial=...`. L'account deve avere email verificata e accettare termini e licenza. Il main process riceve automaticamente token protetto DPAPI e attestazione Ed25519; il segreto di polling resta nella Suite, le credenziali Firebase nel browser.

30 giorni esatti dalla prima approvazione server, un PC e tutte le funzioni All Access. Nessuna carta, addebito o rinnovo automatico. L'acquisto resta separato: 12 EUR/mese o 100 EUR/anno su due PC. La prova usa stato commerciale `cancelled` con scadenza fissa, senza cortesia; l'entitlement contiene `trial: true`.

`licenseTrialClaims` conserva hash di UID, email e MachineGuid Windows. La transazione Firestore impedisce di ripetere la prova con lo stesso account/email/PC; reinstallare la Suite recupera solo il tempo residuo. Il MachineGuid originale non lascia il PC. L'hash è incluso nell'attestazione e controllato anche nei tool autonomi. Non impedisce in assoluto la manomissione del client o di Windows.

Offline: massimo 24 ore per la prova, entro i 30 giorni; resta il limite di 14 giorni per abbonamenti. Anche la cache richiede firma e scadenze valide. Un orologio precedente all'emissione oltre 5 minuti richiede verifica. Un ambiente locale deliberatamente congelato o modificato resta un limite delle protezioni offline.

La disattivazione resta disponibile e non cancella i riferimenti di prova. La disinstallazione non dipende dalla licenza e non è modificata da questo intervento.

Durante l'esecuzione, tutti i tool controllano periodicamente il diritto di utilizzo. Quando non è più valido mostrano un avviso e concedono 60 secondi per salvare, poi si chiudono; non attendono il completamento delle elaborazioni. La riattivazione rilevata prima della chiusura annulla il conto alla rovescia. La Suite resta aperta per gestire la licenza. Il controllo locale avviene ogni 15 secondi, rispettando le finestre offline firmate; una revoca remota diventa osservabile alla successiva verifica online.

## API e archivi

- `POST /licensing/trial/session`: identità installazione, hash dispositivo, segreto di polling. Rate limit del servizio attivazioni.
- `POST /licensing/trial/approve`: token Firebase verificato, codice e accettazione termini. Transazione atomica su account/email/PC, abbonamento e attivazione.
- `POST /licensing/trial/poll`: codice e segreto; credenziali non accessibili al solo browser. Ripetibile fino alla scadenza; il replay dell'approvazione non riattiva un dispositivo disattivato.
- `licenseTrialSessions`: sessioni temporanee con scadenza applicativa e campo `cleanupAt` per TTL Firestore, dichiarato in `firestore.indexes.json`. Pubblicare anche la configurazione Firestore; l'assenza di TTL non rende valide le sessioni scadute.
- `licenseTrialClaims`: riferimenti persistenti anti-ripetizione. Non applicare TTL; includerli nelle procedure di revisione/cancellazione dati del titolare.
- `licenseSubscriptions` e `licenseActivations`: stessi percorsi di validazione/disattivazione delle licenze esistenti. Le prove non hanno chiavi PayPal.

## Verifica e pubblicazione

`npm run test:filex-trial`, categoria Licenze della Dev Console, verifica firme, scadenza, cache alterata, PC differente, reinstallazione, richieste concorrenti, replay dopo disattivazione e accesso anonimo rifiutato. Firestore è simulato con transazioni atomiche: non sostituisce la verifica sull'infrastruttura reale.

`npm run test:filex-trial-ui`, nella stessa categoria, verifica le schermate reali in Electron nascosto con servizi simulati: primo avvio, ricezione prova, inserimento di una chiave acquistata durante la prova e consenso nell'area account. Usa un profilo temporaneo separato e salva anteprime nella cartella ignorata `.codex-remote-attachments/`.

`npm run test:filex-license-emulator` usa i veri emulatori locali Firebase Auth e Firestore con progetto isolato `demo-filex-license-audit`: verifica anche transazioni concorrenti, identità, scadenza, limite dispositivi e rimborso. Richiede Java 21 disponibile in JAVA_HOME o nel runtime portatile locale. Non accede a dati di produzione. Il rapporto dell'audit è in `23-license-audit-2026-09-07.md`.

Prima della release seguire AGENTS.md: backend con chiave di firma configurata, sito aggiornato, build reali e smoke test degli installer Suite e tool autonomi. Provare email reale, attivazione automatica, acquisto durante/dopo la prova, offline, scadenza, disattivazione, disinstallazione e reinstallazione senza nuovi giorni. Non usare la licenza sviluppo come evidenza. Pubblicare la promessa commerciale insieme agli installer che supportano il flusso.
