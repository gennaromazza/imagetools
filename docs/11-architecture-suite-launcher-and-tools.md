# FileX Suite Desktop - Architettura Launcher e Tool

## Panorama

Architettura a shell unica (`apps/filex-desktop`) con esecuzione dinamica per tool:

- `FILEX_TOOL=<tool-id>` seleziona renderer/tool runtime.
- `suite-launcher` e' il nuovo hub di orchestrazione install/update/open.
- ogni tool mantiene il proprio packaging installer dedicato.

## Componenti Principali

- `apps/filex-desktop/src/main.ts`
  - lifecycle Electron
  - IPC contracts
  - runtime info esteso (channel, tool installati, AI capability)
  - crash telemetry anonima
- `apps/filex-desktop/src/preload.ts`
  - bridge sicuro API `filexDesktop`
- `apps/filex-desktop/src/updater.ts`
  - load release manifest
  - check/download/apply update
  - checksum validation SHA-256
  - endpoint allowlist
- `apps/filex-desktop/src/tool-manifest.ts`
  - descrittori tool, incluso `suite-launcher`
  - metadata di release e visibilita' suite

## Data Flow Update

1. Launcher/tool invoca `filex:list-available-tools`.
2. Main process carica manifest release (`stable|beta`).
3. Rileva installazione locale dei tool.
4. Espone stato installazione/aggiornamento.
5. Per update:
   - `filex:download-tool-update`
   - verifica checksum
   - `filex:apply-tool-update` (handoff installer)

## AI Sidecar Capability

- `filex:get-image-id-print-ai-status` verifica:
  - presenza script sidecar
  - presenza runtime Python
  - health sintetico (`ok`, `missing-script`, `missing-runtime`)

## Sicurezza

- manifest/update URL solo da host autorizzati
- fallback manifest locale in `release-manifests/`
- checksum SHA-256 obbligatoria prima dell'apply
- eventi update/crash loggati in log locale
