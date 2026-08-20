# StudioFlow — Registro Google Drive

## Scopo

Il registro remoto conserva versioni compatte di archivio, sessioni completate, snapshot e fingerprint necessari alla ricerca. Non carica fotografie, anteprime o file di lavoro.

## Outbox

Il commit locale inserisce nella stessa base un evento `IMPORT_COMPLETED`. Il sincronizzatore legge eventi `PENDING`/`FAILED_RETRYABLE`, usa il client Drive già autenticato dalla Suite, applica retry con backoff e rende l’operazione idempotente tramite aggregate ID ed event type.

## Formato remoto

Il manifest contiene `schemaVersion`, `updatedAt`, identificatore archivio, snapshot, sessioni e checksum del payload. Gli aggiornamenti usano file temporaneo/versione e sostituzione, così un’interruzione non lascia un registro parziale.

## Sicurezza

Drive può suggerire una corrispondenza remota ma non produce da solo lo stato locale `SAFE`. La verifica finale richiede sempre che la copia nell’archivio configurato esista e coincida byte-per-byte con il file corrente.

## OAuth per la distribuzione

- FileX utilizza un unico client OAuth di tipo **Desktop app** configurato nel progetto Google Cloud ufficiale.
- Client ID e Client Secret vengono inseriti dalla CI nelle build distribuite tramite `IMAGE_SELECT_GOOGLE_CLIENT_ID` e `IMAGE_SELECT_GOOGLE_CLIENT_SECRET`; il cliente non configura credenziali tecniche.
- Ogni cliente sceglie e autorizza il proprio account Google tramite la pagina Google aperta dal pulsante **Collega Google Drive**.
- Il flusso usa Authorization Code + PKCE e callback locale dinamico `http://127.0.0.1:<porta>`.
- Lo scope è `https://www.googleapis.com/auth/drive.file`: FileX gestisce i file del proprio workflow senza accesso generale al Drive personale.
- Il refresh token è cifrato con Electron `safeStorage` nell'area condivisa FileX del profilo del sistema operativo. Nessun token viene salvato in chiaro.
- Scollegare l'account revoca il refresh token presso Google e rimuove la copia locale.

Il token condiviso consente ai tool FileX installati nello stesso profilo di riutilizzare l'account autorizzato. Una modifica dello scope invalida intenzionalmente i token precedenti e richiede una nuova autorizzazione.

## Configurazione e diagnosi

In locale le credenziali risiedono in `apps/filex-desktop/.env.local`, escluso da Git. Per le release devono esistere gli omonimi secret GitHub Actions. `generate-google-drive-config.mjs` interrompe una build di release se una credenziale manca.

- `redirect_uri_mismatch`: verificare che il client Google sia realmente di tipo **Desktop app**, non soltanto chiamato “Desktop”.
- `client_secret is missing`: configurare il Client Secret appartenente allo stesso client del Client ID.
- la pagina locale “Autorizzazione Google ricevuta” conferma soltanto il callback; il collegamento è concluso quando anche lo scambio token riesce e la UI mostra l'account.
- dopo una modifica alle credenziali è necessario ricompilare e riavviare il processo Electron.
