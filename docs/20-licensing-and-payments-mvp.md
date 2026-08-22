# FileX licensing e pagamenti — MVP semplice

Stato al 22 agosto 2026: backend, Suite, attestazioni, PayPal sandbox e area cliente Firebase implementati. Il deploy dell'area cliente resta subordinato al collaudo esplicito.

## Decisione raccomandata

FileX vende un solo prodotto, **FileX All Access**, in due varianti:

- mensile: 12 EUR;
- annuale: 100 EUR;
- stesse funzioni e tutti i tool presenti e futuri;
- una licenza personale, massimo due dispositivi attivi;
- account FileX email/password con email verificata uguale a quella dell'abbonamento PayPal.

Il fornitore scelto e' **PayPal Subscriptions come gestore dei pagamenti**. PayPal gestisce checkout, addebiti ricorrenti e strumenti di pagamento; FileX resta il venditore e conserva lo stato tecnico necessario ad abilitare il prodotto. Imposte, documenti fiscali, rimborsi e obblighi del venditore restano in capo al titolare di FileX e devono essere validati con il commercialista.

Non costruire nell'MVP:

- un checkout proprietario;
- un sistema fiscale proprietario non revisionato dal commercialista;
- codici coupon gestiti da Firestore;
- piani distinti per singolo tool;
- un server licenze separato da Firebase;
- provider di login aggiuntivi oltre a email/password.

## Esperienza cliente

### Acquisto

1. Il cliente seleziona mensile o annuale sul sito.
2. Il sito apre il checkout PayPal ospitato.
3. Dopo l'approvazione il cliente accede o crea un account FileX con la stessa email PayPal e la verifica tramite Firebase Authentication.
4. FileX confronta server-side l'email verificata con i dati PayPal, collega l'abbonamento e mostra la chiave.
5. FileX riceve webhook firmati e mantiene aggiornato lo stato commerciale.
6. Il cliente apre FileX Suite, sceglie `Attiva FileX` e incolla la chiave.
7. L'area cliente mostra piano, scadenza e dispositivi attivi e consente di disattivarli.

### Uso quotidiano

- La Suite verifica la licenza all'avvio e poi al massimo una volta ogni 24 ore.
- Una verifica valida produce un'attestazione locale firmata utilizzabile offline per 14 giorni.
- I tool chiedono lo stato alla Suite/runtime condiviso; non chiamano direttamente il provider.
- Se internet non e' disponibile, FileX continua a funzionare durante la finestra offline.
- La chiave completa non viene mai mostrata nei log o inviata ai renderer dei tool.

### Cambio computer

- La pagina Licenza della Suite mostra `1 di 2` o `2 di 2` dispositivi.
- Il cliente puo' disattivare il PC corrente dalla Suite.
- Per rimuovere un vecchio PC non disponibile usa il portale cliente/provider o il supporto nell'MVP.
- Un reset manuale deve essere raro, auditabile e limitato per evitare abuso.

### Cancellazione e pagamento fallito

- `cancelled` con periodo ancora pagato: accesso attivo fino a `currentPeriodEnd`.
- pagamento fallito: periodo di cortesia di 7 giorni, con messaggio non bloccante.
- oltre il periodo di cortesia: stato `expired`; la Suite resta accessibile per gestione licenza e aggiornamento pagamento, i tool commerciali non si avviano.
- rimborso totale o chargeback: revoca immediata, salvo decisione manuale di supporto.

## Architettura minima

```text
Sito FileX -> Checkout ospitato
                    |
                    v
             Webhook firmati
                    |
                    v
Firebase Cloud Functions -> Firestore (customer, subscription, activation)
          ^                         |
          |                         v
     FileX Suite <----------- attestazione firmata
          |
          v
   tool installati
```

### Responsabilita'

**PayPal**

- checkout, pagamento e rinnovo automatico;
- ricevute PayPal e gestione dei pagamenti automatici;
- fonte degli eventi commerciali.

**Titolare FileX**

- venditore del servizio;
- imposte, documenti fiscali, termini, recesso e decisioni sui rimborsi;
- assistenza commerciale e riconciliazione con PayPal.

**Cloud Functions**

- verifica firma e idempotenza dei webhook;
- traduce gli stati provider nel modello FileX;
- attiva, valida e disattiva i dispositivi;
- emette attestazioni firmate a breve durata;
- non riceve dati carta.

**FileX Suite**

- unica UI di attivazione e gestione licenza;
- genera un identificatore installazione casuale, non un fingerprint hardware invasivo;
- conserva segreti con `safeStorage` di Electron;
- applica la finestra offline e comunica ai tool solo un entitlement normalizzato.

**Tool**

- ricevono `active`, `grace`, `expired` o `unlicensed` dal runtime FileX;
- non conoscono PayPal, prezzi, chiavi o webhook;
- non duplicano logica commerciale.

### Copertura dei tool presenti e futuri

La copertura non dipende da un elenco manuale dentro il servizio licenze:

- ogni tool con `licenseRuntime: "shared-runtime"` nel manifest passa dal controllo centrale di `apps/filex-desktop/src/main.ts` prima di registrare IPC o creare finestre;
- FileX Send, FileX Adobe Cleaner e FileX Backup Guard dichiarano `licenseRuntime: "standalone"` e applicano lo stesso entitlement anche nel proprio entry point Electron;
- FileX Suite dichiara `licenseRuntime: "management"` e rimane accessibile per attivare, aggiornare o disattivare la licenza;
- `npm run test:filex-license-coverage` verifica l'invariante. Un nuovo tool deve scegliere esplicitamente un runtime e, se autonomo, registrare il proprio entry point nel test. In caso contrario test e CI falliscono.

Questa garanzia copre il percorso applicativo ufficiale. Non sostituisce firma del codice o misure anti-tampering dell'eseguibile: prima dell'enforcement commerciale gli installer Windows devono essere firmati.

## API FileX proposta

Base: Cloud Functions esistenti, con route separate sotto `/licensing`.

| Metodo | Route | Autenticazione | Scopo |
| --- | --- | --- | --- |
| POST | `/licensing/webhooks/paypal` | firma verificata da PayPal | sincronizza eventi |
| POST | `/licensing/paypal/license` | token Firebase verificato + confronto email PayPal | collega l'acquisto e restituisce la chiave |
| POST | `/licensing/account/link` | token Firebase verificato + confronto email PayPal | alias esplicito per collegare un abbonamento |
| GET | `/licensing/account` | token Firebase con email verificata | restituisce licenze, stati e dispositivi dell'account |
| POST | `/licensing/account/devices/deactivate` | token Firebase e proprietà abbonamento | libera un dispositivo dall'area cliente |
| POST | `/licensing/activate` | chiave + installation id | attiva uno dei due dispositivi |
| POST | `/licensing/validate` | activation token | rinnova attestazione |
| POST | `/licensing/deactivate` | activation token | libera il dispositivo corrente |
| GET | `/licensing/status` | activation token | stato e scadenze normalizzate |

Risposta normalizzata, senza dati commerciali superflui:

```json
{
  "schemaVersion": 1,
  "entitlement": "filex-all-access",
  "status": "active",
  "validUntil": "2026-09-13T10:00:00.000Z",
  "offlineUntil": "2026-08-27T10:00:00.000Z",
  "activation": { "current": 1, "limit": 2 }
}
```

## Modello Firestore

Le collezioni restano server-only, coerenti con le regole attuali.

### `licenseSubscriptions/{providerSubscriptionId}`

- `providerSubscriptionId`, `providerCustomerId`;
- `planId`;
- `entitlement`: `filex-all-access`;
- `status`: `active | grace | expired | revoked`;
- `currentPeriodEnd`, `graceUntil`;
- `cancelAtPeriodEnd`;
- `licenseKeyHash` (mai la chiave in chiaro);
- `customerEmailHash` (HMAC normalizzato, mai email PayPal in chiaro);
- `ownerUid` (UID Firebase assegnato soltanto dopo verifica dell'email);
- `lastEventAt`, `updatedAt`.

### `licenseActivations/{activationId}`

- `subscriptionId`;
- `installationIdHash`;
- `deviceLabel` ripulita, per esempio `Studio principale`;
- `tokenHash`;
- `activatedAt`, `lastValidatedAt`, `deactivatedAt`;
- `appVersion`, senza inventario hardware.

### `licenseWebhookEvents/{eventId}`

- `provider`, `type`, `receivedAt`, `processedAt`;
- `payloadHash`, `status`, `errorCode`;
- TTL consigliato: 90 giorni.

Il payload webhook completo non deve essere conservato per default.

## Regole di sicurezza

- Verificare la firma sul corpo HTTP grezzo prima del parsing.
- Rifiutare timestamp vecchi e riutilizzo dello stesso event id.
- Tutti gli handler devono essere idempotenti e tollerare eventi fuori ordine.
- Mappare esplicitamente product e variant id ammessi; mai fidarsi del nome prodotto.
- Conservare webhook secret e chiave di firma in Firebase Secret Manager.
- Usare hash SHA-256/HMAC per chiavi, token e installation id nei documenti.
- Generare activation token casuali da almeno 256 bit e ruotarli alla riattivazione.
- Firmare le attestazioni con Ed25519; la chiave privata resta nel backend, la pubblica e' inclusa nella Suite.
- Rate limit per IP, chiave e installation id; errori pubblici generici, log interni strutturati.
- Nessun blocco distruttivo: una licenza scaduta non deve cancellare progetti, preferenze o file.

## Stati canonici

| Evento commerciale | Stato FileX | Comportamento |
| --- | --- | --- |
| ordine/abbonamento valido | `active` | accesso completo |
| cancellato, periodo pagato non terminato | `active` | accesso fino alla scadenza |
| pagamento fallito entro 7 giorni | `grace` | accesso completo con avviso |
| periodo e cortesia terminati | `expired` | tool bloccati, gestione licenza disponibile |
| rimborso totale/chargeback/frode | `revoked` | revoca immediata |
| mai attivato | `unlicensed` | schermata attivazione |

Gli eventi webhook sono la fonte di verita'. La chiamata di attivazione del provider e' un controllo aggiuntivo, non sostituisce la sincronizzazione webhook.

## Rollout in quattro tranche

### 1. Sandbox e backend

- creare prodotto e due piani PayPal in sandbox;
- configurare checkout di test e portale cliente;
- implementare webhook, modello dati, mapping stati e test fixture;
- implementare activate/validate/deactivate e attestazioni firmate;
- nessun blocco nei client.

### 2. Suite

- aggiungere pagina Licenza e flusso incolla-chiave;
- storage protetto, refresh, offline e disattivazione;
- contratto IPC condiviso e test dello state machine;
- modalita' `licensing_enforcement=observe` per rilevare problemi senza bloccare.

### 3. Sito e documenti

- sostituire i CTA prezzi con i due checkout reali;
- pagina successo con istruzioni di attivazione;
- aggiornare privacy, termini, EULA, rimborsi e cookie;
- indicare chiaramente venditore, ruolo di PayPal, rinnovo, imposte, prova e recesso;
- revisione commercialista/legale prima dell'apertura.

### 4. Lancio controllato

- acquisto reale a importo minimo o coupon interno;
- verifica fattura, webhook, attivazione di due PC, terzo PC rifiutato;
- cancellazione, pagamento fallito, rimborso e recupero offline;
- 7 giorni in `observe`, poi `warn`, infine `enforce` tramite configurazione remota;
- procedura di emergenza per disattivare l'enforcement senza nuova release desktop.

## Criteri di completamento

Il sistema e' pronto quando, in ambiente live:

- mensile e annuale acquistano lo stesso entitlement;
- nessun dato carta passa da FileX;
- ogni webhook viene verificato, deduplicato e processato idempotentemente;
- due PC si attivano e il terzo riceve un errore utile;
- l'uso offline funziona per 14 giorni dopo una verifica valida;
- cancellazione, mancato pagamento, rimborso e riattivazione producono lo stato atteso;
- il cliente puo' gestire pagamento e cancellazione senza contattare FileX;
- supporto puo' diagnosticare con id evento/abbonamento senza vedere chiavi o token;
- termini, privacy, rimborsi ed EULA corrispondono al comportamento reale;
- esiste un kill switch remoto testato per l'enforcement.

## Decisioni da confermare prima del codice live

1. Account PayPal Business verificato e applicazione REST abilitata per Subscriptions.
2. Prezzi finali 12 EUR/mese e 100 EUR/anno e loro trattamento fiscale mostrato nel checkout.
3. Nessuna prova gratuita al lancio. Si puo' aggiungere dopo senza cambiare architettura.
4. Cortesia di 7 giorni e offline di 14 giorni.
5. Blocco di tutti i tool commerciali alla scadenza, mantenendo sempre accessibili dati e gestione licenza.
6. Testo definitivo revisionato da commercialista/legale italiano.
