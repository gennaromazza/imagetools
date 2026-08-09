# FileX Suite Desktop - Release Engineering Windows

## Pipeline Ufficiale

Workflow: `.github/workflows/windows-release.yml`

Input manuali:

- `channel`: `stable` o `beta`
- `component`: `suite` oppure il `toolId` da pubblicare
- `version`: versione del componente senza prefisso

## Prerequisiti CI

Secrets richiesti:

- `FILEX_WINDOWS_CSC_LINK`
- `FILEX_WINDOWS_CSC_KEY_PASSWORD`
- `GITHUB_TOKEN` (default Actions)

Env principali:

- `FILEX_RELEASE_CHANNEL`
- `FILEX_CODE_SIGNING=1`

## Build/Dist

Il workflow usa una build selettiva. Il comando all-in rimane disponibile soltanto per manutenzione o regressione completa:

```bash
npm run dist:filex-desktop:all-tools:win
```

Include:

- installer singoli tool
- installer Suite (`suite-launcher`)

FileX Adobe Cleaner è pubblicato come componente `cache-sweep`, tag `cache-sweep-vX.Y.Z` e installer `FileX-Adobe-Cleaner-X.Y.Z-stable-x64-setup.exe`.

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
