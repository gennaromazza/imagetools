# FileX Suite Desktop - Release Engineering Windows

## Pipeline Ufficiale

Workflow: `.github/workflows/windows-release.yml`

Input manuali:

- `channel`: `stable` o `beta`
- `version`: tag release (`vX.Y.Z`)

## Prerequisiti CI

Secrets richiesti:

- `FILEX_WINDOWS_CSC_LINK`
- `FILEX_WINDOWS_CSC_KEY_PASSWORD`
- `GITHUB_TOKEN` (default Actions)

Env principali:

- `FILEX_RELEASE_CHANNEL`
- `FILEX_CODE_SIGNING=1`

## Build/Dist

Comando suite all-in:

```bash
npm run dist:filex-desktop:all-tools:win
```

Include:

- installer singoli tool
- installer Suite (`suite-launcher`)

Il workflow deve costruire almeno FileX Suite e tutti i tool modificati dalla release. Per `v0.1.17` gli artefatti obbligatori sono Suite, Image Select Pro e Archivio Flow.

## Manifest Release

Il manifest stabile pubblico è l'unica fonte usata dal launcher per gli aggiornamenti dei tool:

`https://github.com/gennaromazza/imagetools/releases/latest/download/stable.json`

Ogni release deve pubblicare nello stesso tag:

- installer FileX Suite;
- installer di ogni tool costruito;
- `stable.json` o `beta.json` del canale;
- checksum e blockmap degli installer.

Il tag `vX.Y.Z` deve coincidere con la versione in `apps/filex-desktop/package.json`; la pipeline interrompe la pubblicazione in caso di disallineamento.

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

La definizione completa della richiesta "pubblica e builda" e' in `docs/18-publish-build-contract.md`.

Non aggiungere aggiornamenti tool-specifici nella barra dell'aggiornamento della Suite: Suite e tool sono distribuiti separatamente.
