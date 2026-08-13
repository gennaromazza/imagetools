# FileX licensing — runbook operativo

## Stato sicuro pre-lancio

- `FILEX_LICENSE_ENFORCEMENT` assente o `observe`: nessun tool viene bloccato.
- `FILEX_ALLOWED_VARIANT_IDS` assente: i webhook commerciali rispondono 503 e non creano abbonamenti.
- `LEMONSQUEEZY_WEBHOOK_SECRET` assente: il webhook risponde 503.
- i pulsanti acquisto puntano alla sezione prezzi finche' non vengono configurati gli URL checkout.
- storefront ufficiale: `https://xsuite.lemonsqueezy.com/`; portale cliente: `https://xsuite.lemonsqueezy.com/billing`.

## Secret e configurazione

Configurare da terminale, senza inserire valori nel repository:

```powershell
firebase.cmd functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET --project gen-lang-client-0321087169
```

Configurazione pubblica generata in `commerce-config.generated.ts` e distribuibile dal bootstrap:

- `allowedVariantIds`: id delle varianti mensile e annuale;
- `checkoutMonthlyUrl`, `checkoutAnnualUrl`: checkout HTTPS ospitati;
- `enforcement`: inizialmente `observe`, poi `warn`, infine `enforce`;

Il documento remoto `licenseConfiguration/public` puo' sovrascrivere l'enforcement soltanto con `enforcementOverride: true`; questo evita che vecchi valori accidentali prevalgano sul deploy e conserva un kill switch esplicito. Le modifiche operative avvengono direttamente tramite Firebase Admin SDK e credenziali Google ADC: per scelta di sicurezza non esiste alcuna route HTTP amministrativa nel backend pubblico.

Secret runtime:

- `LEMONSQUEEZY_WEBHOOK_SECRET`: secret HMAC del webhook;
- `FILEX_LICENSE_SIGNING_PRIVATE_KEY`: chiave privata Ed25519 generata una sola volta; la pubblica e' compilata nella Suite;

Il comando `create-support-license`, usato dal collegamento cliccabile, riusa automaticamente il login locale della Firebase CLI. Gli altri comandi amministrativi richiedono ancora le Application Default Credentials Google. Non usare service-account JSON permanenti nel repository.

### Licenza prova con doppio clic

Su Windows l'amministratore puo' aprire `Crea licenza prova FileX.cmd` dalla cartella principale del progetto. La procedura chiede il nome della persona e la durata (30 giorni per default), crea una licenza `FileX All Access`, mostra la chiave una sola volta e la copia negli appunti. Non richiede una nuova build o distribuzione di FileX.

Il collegamento usa lo stesso comando amministrativo sicuro e riusa il login Firebase gia' presente sul PC. Per verificare la procedura senza scrivere nel backend:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-filex-trial-license.ps1 -Name "Mario Rossi" -Days 30 -DryRun
```

### Lemon Squeezy test mode (13 agosto 2026)

- store `ImageXtool`, ID `451565`, dominio richiesto `xsuite.lemonsqueezy.com`;
- richiesta di attivazione live inviata e in revisione;
- prodotto test pubblicato: `FileX All Access`, ID `1288616`;
- variante annuale test: ID `2015970`, EUR 100/anno;
- variante mensile test: ID `2015999`, EUR 12/mese;
- categoria fiscale Lemon Squeezy: `Software`;
- entrambe le varianti generano chiavi con limite di due attivazioni;
- webhook test ID `126566`, callback `https://api-2lxiitfa2a-ew.a.run.app/webhooks/lemonsqueezy`, firmato con `LEMONSQUEEZY_WEBHOOK_SECRET` e sottoscritto agli eventi subscription/payment/license necessari.

Gli ID test non devono essere inseriti nel catalogo live né usati dal bootstrap commerciale, che rifiuta esplicitamente risorse `test_mode`. Dopo l'approvazione dello store, ricreare o copiare il prodotto in live mode, eseguire il bootstrap con una API key live temporanea e verificare checkout, webhook e acquisto reale prima di passare da `observe` a `warn`.

`FILEX_LICENSE_API_URL` serve solo per test o ambienti alternativi. Suite e sito leggono checkout ed enforcement dal backend, senza nuova build.

## Deploy

```powershell
npm.cmd --workspace @photo-tools/filex-cloud-functions test
npm.cmd --workspace @photo-tools/filex-cloud-functions run typecheck
npm.cmd --workspace @photo-tools/filex-desktop run build:suite
firebase.cmd deploy --project gen-lang-client-0321087169 --only functions:filex-cloud,firestore
```

Non impostare `enforce` durante il primo deploy.

## Bootstrap commerciale da terminale

Dopo che lo store Lemon Squeezy e' stato approvato con identita', dati fiscali e conto bancario:

```powershell
$env:LEMONSQUEEZY_API_KEY='...'
$env:LEMONSQUEEZY_STORE_ID='...'
$env:LEMONSQUEEZY_PRODUCT_ID='...'
$env:LEMONSQUEEZY_MONTHLY_VARIANT_ID='...'
$env:LEMONSQUEEZY_ANNUAL_VARIANT_ID='...'
node scripts/bootstrap-filex-commerce.mjs
```

Lemon Squeezy espone prodotti e varianti come risorse API di sola lettura: `FileX All Access`, mensile 12 EUR e annuale 100 EUR devono quindi esistere nello store approvato. Il comando rifiuta varianti non pubblicate, di test, senza chiavi, con limite diverso da 2, con intervallo o prezzo errati; poi genera i checkout ospitati, crea o riallinea il webhook, salva il secret in Firebase Secret Manager, genera la configurazione pubblica, distribuisce Function e sito e verifica l'health endpoint. Non richiede Google ADC: riusa il login Firebase CLI gia' attivo.

## Smoke test

1. `GET /api/licensing/health` restituisce `ok: true`.
2. Firma webhook errata restituisce 401.
3. Evento di variante estranea e' ignorato.
4. Evento valido crea/aggiorna `licenseSubscriptions` senza chiave in chiaro.
5. Prima e seconda installazione si attivano; la terza restituisce 409.
6. Disattivazione libera immediatamente uno slot.
7. Client senza rete usa solo un'attestazione ancora entro `offlineUntil`.
8. Una modifica manuale a stato o scadenza nella cache locale invalida la firma e non abilita l'uso offline.
9. Un rimborso totale revoca la licenza; un rimborso parziale non cambia da solo lo stato dell'abbonamento.
10. L'attivazione registra versione di termini, EULA e privacy accettate; i log webhook scadono tramite TTL dopo 90 giorni.

## Incidenti e kill switch

Se il servizio licenze produce falsi negativi:

1. distribuire/configurare `FILEX_LICENSE_ENFORCEMENT=observe`;
2. non cancellare attivazioni o abbonamenti;
3. conservare event id e timestamp, mai chiavi o activation token;
4. riprocessare gli eventi solo dopo aver corretto l'idempotenza;
5. tornare a `warn` e poi `enforce` dopo almeno sette giorni senza anomalie.

Una licenza scaduta o revocata non deve mai eliminare file, progetti o preferenze.
