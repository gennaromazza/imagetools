# Image ID Print - Componente AI Opzionale

## Obiettivo

Separare il sidecar AI dal core installer per ridurre peso e rischio operativo.

## Modello v1

- Installer base `Image ID Print` sempre disponibile.
- Sidecar AI installabile opzionalmente post-install.
- Capability esposta in runtime:
  - `aiSidecarInstalled`
  - health check dedicato via IPC.

## Requisiti Sidecar

- script `rembg_server.py`
- `requirements.txt`
- runtime Python disponibile (`python` o `py`)

## Stati Runtime

- `ok`: script + runtime presenti.
- `missing-script`: payload AI assente.
- `missing-runtime`: script presente ma Python non disponibile.

## Fallback UX

- Tool utilizzabile anche senza AI.
- Funzioni AI mostrano callout con guida installazione componente.
- Nessun blocco hard del flusso core.
