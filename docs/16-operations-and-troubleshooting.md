# FileX Suite Desktop - Operations & Troubleshooting

## Log Operativi

Log desktop: `%APPDATA%/../Local/<App>/logs/` (userData Electron).

Canali principali:

- `update`
- `crash`
- `renderer`
- `folder-open`

## Incident Playbook

### Update non applicato

1. Verificare stato job (`failed`, `error`).
2. Controllare manifest URL/canale.
3. Verificare checksum nel manifest.
4. Rieseguire update.

### Tool non avviabile dal launcher

1. Verificare `installed=true` e `executablePath`.
2. Verificare presenza file `.exe`.
3. Reinstallare tool da launcher.

### Crash all'avvio

1. Consultare crash telemetry anonima in log locale.
2. Verificare mismatch versione launcher/tool.
3. Provare rollback installer precedente.

### Image ID Print AI non disponibile

1. Verificare `getImageIdPrintAiStatus`.
2. Se `missing-runtime`, installare Python.
3. Se `missing-script`, reinstallare componente AI opzionale.

## Recovery Rapido

- Forzare canale `stable`.
- Reinstallare tool critico.
- Aprire issue tecnica con:
  - versione tool
  - canale
  - errore update/install
  - estratto log (senza dati sensibili cliente).
