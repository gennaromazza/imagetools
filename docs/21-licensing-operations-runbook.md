# FileX licensing — runbook operativo

## Relazione con il Modello architetturale dei Tool
Le regole di licensing descritte in questo documento operano in base alla configurazione della proprietà `licenseRuntime` all'interno del manifesto del desktop (`tool-manifest.ts`). Per i dettagli sulla configurazione lato sorgente e sulla creazione di un nuovo pacchetto soggetto o meno a queste licenze, fare riferimento al **[Runbook Creazione e Rilascio di un Nuovo Tool (22-new-tool-creation-runbook.md)](./22-new-tool-creation-runbook.md)**.

## Stato sicuro pre-lancio

- `FILEX_LICENSE_ENFORCEMENT` assente o `observe`: nessun tool viene bloccato.
- `paypalClientId`, `paypalWebhookId` o uno dei due plan ID assenti: PayPal non viene caricato nel sito.
- `PAYPAL_CLIENT_SECRET` o `PAYPAL_LICENSE_KEY_SECRET` assente: webhook e recupero chiave rispondono 503.
- i pulsanti acquisto restano in modalita' pre-lancio finche' la configurazione PayPal non e' completa.
- gestione cliente: `https://www.paypal.com/myaccount/autopay/`.
- area cliente FileX: `/account/`; richiede Firebase Authentication email/password e dominio hosting autorizzato.

## Bootstrap PayPal

1. Creare un'app REST sandbox dal PayPal Developer Dashboard.
2. Impostare nella sessione terminale `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` e `PAYPAL_ENVIRONMENT=sandbox`.
3. Eseguire `npm run license:bootstrap-paypal` dalla radice. Lo script crea o riusa prodotto, piani e webhook, configura i secret Firebase e aggiorna solo gli identificatori pubblici generati.
4. Revisionare `apps/filex-cloud-functions/src/commerce-config.generated.ts` e lanciare `npm run test:filex-cloud` e `npm run build:filex-cloud`.
5. Eseguire il deploy soltanto dopo il collaudo sandbox esplicito.

Non sostituire `PAYPAL_LICENSE_KEY_SECRET` dopo il lancio: la sua rotazione cambierebbe le chiavi derivate dagli abbonamenti esistenti.

## Area cliente e recupero licenza

- Firebase Authentication deve avere Email/Password attivo, password obbligatoria e protezione anti-enumerazione email.
- `filex-suite.web.app` deve essere presente tra i domini autorizzati.
- Il browser invia il token Firebase; il backend accetta solo token con `email_verified=true`.
- Il primo collegamento recupera l'abbonamento dalla API PayPal e confronta l'email normalizzata. L'abbonamento non puo' essere assegnato a un UID differente.
- Firestore conserva solo l'HMAC dell'email PayPal sotto `customerEmailHash`; non salvare l'indirizzo PayPal in chiaro.
- `/licensing/account` restituisce la chiave derivata, lo stato e i dispositivi soltanto al proprietario autenticato.
- Per un acquisto precedente non ancora indicizzato, il cliente puo' inserire una volta l'ID abbonamento PayPal nella propria area; l'email verificata deve comunque coincidere.

Gli account PayPal Sandbox generati con dominio `personal.example.com` o `business.example.com` non ricevono posta reale. Solo durante il collaudo sandbox si puo' creare o aggiornare il corrispondente account Firebase gia' verificato impostando `FILEX_TEST_EMAIL` e `FILEX_TEST_PASSWORD`, poi eseguendo `npm run license:create-sandbox-account`. Lo script rifiuta ambienti PayPal live e indirizzi diversi dai domini sandbox PayPal; non deve essere usato per clienti reali.

## Attività pianificata: audit enforcement per tutti i tool

Questo audit va gestito come task separato prima della prossima release commerciale. Non è considerato risolto dalla licenza automatica delle build di sviluppo.

Ambito minimo:

1. Inventariare ogni voce di `tool-manifest.ts` e confermare con il proprietario del prodotto se la policy corretta è `shared-runtime`, `standalone` o `management`.
2. Verificare l'entry point Electron effettivamente contenuto in ciascun installer, evitando controlli presenti soltanto nella Suite o nel renderer web.
3. Installare ogni artefatto e provarlo con stati `unlicensed`, `active`, `grace`, `expired` e `revoked` secondo la policy dichiarata.
4. Eseguire disinstallazione e reinstallazione, verificando che non restino bypass di sviluppo o stati locali incoerenti.
5. Decidere esplicitamente se la disinstallazione debba liberare lo slot dispositivo. Se prevista, la chiamata deve essere best-effort e la rimozione locale deve riuscire anche offline.
6. Automatizzare la matrice nel gate di release e produrre un report per componente.

Quest'attività deve anche risolvere l'ambiguità attuale dei tool `standalone`: il manifest consente l'avvio senza controllo centrale, mentre ogni eventuale entitlement autonomo deve essere verificato nel relativo processo Electron e documentato per prodotto.

## Secret

