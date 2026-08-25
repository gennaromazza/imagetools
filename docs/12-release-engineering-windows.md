# FileX Suite Desktop - Release Engineering Windows

## Pipeline Ufficiale

Workflow: `.github/workflows/windows-release.yml`

Input manuali:

- `channel`: `stable` o `beta`
- `component`: `suite` oppure il `toolId` da pubblicare
- `version`: versione del componente senza prefisso

### Avvio dalla FileX Dev Console

La dashboard locale espone `release-filex-suite.bat` in due modalità non interattive:

- `release-filex-suite.bat X.Y.Z --preflight`: controlla strumenti, branch, sincronizzazione, versione, CHANGELOG, tag, dipendenze, test e build; non crea commit, tag, release o deploy.
- `release-filex-suite.bat X.Y.Z --publish PUBBLICA-suite-vX.Y.Z`: esegue il workflow completo, inclusi commit, push, tag, attesa GitHub Actions, verifica del feed e deploy del sito.

La pubblicazione dalla dashboard richiede `main`, working tree pulita e conferma testuale esatta. I log sono visibili nel pannello e il server non accetta comandi shell arbitrari.

## Prerequisiti CI

Secrets richiesti:

- `FILEX_WINDOWS_CSC_LINK`
- `FILEX_WINDOWS_CSC_KEY_PASSWORD`
- `GITHUB_TOKEN` (default Actions)

Env principali:

- `FILEX_RELEASE_CHANNEL`
- `FILEX_CODE_SIGNING=1`

## Build/Dist

Il workflow usa una build selettiva e dipende strettamente dai descrittori nel manifest del desktop e dalle voci nel workflow stesso.
Per la registrazione di nuovi applicativi, fare riferimento a **[Runbook Creazione e Rilascio di un Nuovo Tool (22-new-tool-creation-runbook.md)](./22-new-tool-creation-runbook.md)**.

Il comando all-in rimane disponibile soltanto per manutenzione o regressione completa:

```bash
npm run dist:filex-desktop:all-tools:win
```

Include:

- installer singoli tool
- installer Suite (`suite-launcher`)

FileX Adobe Cleaner è pubblicato come componente `cache-sweep`, tag `cache-sweep-vX.Y.Z` e installer `FileX-Adobe-Cleaner-X.Y.Z-stable-x64-setup.exe`.

FileX Send è pubblicato come componente `filex-send`, tag `filex-send-vX.Y.Z` e installer `FileX-Send-X.Y.Z-stable-x64-setup.exe`. La prima release richiede FileX Suite 0.1.31 o successiva.

Una release ordinaria deve costruire un solo componente. Batch Print Layout, Image Converter e Trova Foto da Lista restano nel manifest storico, ma non sono pubblicabili finche' i relativi workspace non vengono ripristinati.

## Manifest Release

Il manifest stabile pubblico è l'unica fonte usata dal launcher per gli aggiornamenti dei tool:

`https://github.com/gennaromazza/imagetools/releases/download/update-catalog-stable/stable.json`

Ogni release tool deve pubblicare nel proprio tag:

- installer del solo tool;
- `stable.json` o `beta.json` del canale;
- checksum e blockmap dell'installer.
- un elenco `highlights` non vuoto che spiega miglioramenti e funzionalità della versione per ogni tool.

Il tag `<tool-id>-vX.Y.Z` deve coincidere con la versione nel `package.json` del tool. Per la Suite il tag `suite-vX.Y.Z` coincide con `apps/filex-desktop/package.json`.

Il workflow rifiuta tag che non puntano a un commit gia' integrato in `main`; anche l'avvio manuale e' consentito soltanto dal branch `main`.

Il launcher segue i redirect GitHub verso `release-assets.githubusercontent.com`, verifica l'integrità del manifest e poi confronta la versione di ogni tool installato con la versione più recente del manifest.

Generazione:

```bash
cd apps/filex-desktop
node ./scripts/generate-release-manifest.mjs --channel=stable --base-url=https://github.com/<owner>/<repo>/releases/download/<tag>
```

Validazione:

```bash
node ./scripts/validate-release-manifest.mjs --channel=stable
```

Firma opzionale (hardening):

- impostare `FILEX_MANIFEST_HMAC_KEY` in CI
- il manifest includera' `payloadSha256` e `payloadSignature`
- il runtime updater rifiuta manifest firmati non verificabili

## Canali

- `stable`: produzione clienti studio.
- `beta`: test pilot interno/prerelease.

Policy:

- `stable` solo build verificate QA/UAT.
- `beta` per smoke estesi e feedback pre-rollout.

## Contratto UX degli aggiornamenti

Tutti i tool devono rispettare lo stesso contratto:

- `Installa` se il tool non è presente;
- `Apri` se il tool è installato e aggiornato;
- `Aggiorna` se esiste una versione remota più recente;
- refresh globale della Suite per rileggere lo stato di tutti i tool.
- dettagli delle novità visibili nella scheda prima di avviare l'aggiornamento;
- chiusura coordinata di Suite e tool, seguita dal ripristino automatico delle applicazioni aperte.

La definizione completa della richiesta "pubblica e builda" e' in `docs/18-publish-build-contract.md`.

Non aggiungere aggiornamenti tool-specifici nella barra dell'aggiornamento della Suite: Suite e tool sono distribuiti separatamente.
### Sito ufficiale e link Suite

La homepage usa il link stabile dell'installer Suite. Dopo una release `suite-vX.Y.Z`, il workflow `website-suite-sync.yml` aggiorna automaticamente il fallback della versione e pubblica il sito Firebase. Prima di considerare conclusa la release verificare il run del workflow, la secret `FIREBASE_TOKEN` e la versione mostrata su `https://filex-suite.web.app/`.

### Smoke test obbligatorio del pacchetto Electron

Prima del tag eseguire la build NSIS reale, non soltanto TypeScript. Verificare nell'ASAR/output che tutti gli import del main process siano presenti e avviare il main process impacchettato. L'aggiunta di un file in `src/` richiede anche l'aggiornamento della whitelist `files` di `electron-builder.config.mjs` quando la Suite usa una lista esplicita. Se lo smoke test produce `ERR_MODULE_NOT_FOUND`, la release è bloccata.
