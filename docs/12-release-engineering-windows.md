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

## Manifest Release

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
