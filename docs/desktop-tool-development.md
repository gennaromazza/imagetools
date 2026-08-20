# Sviluppo dei tool desktop

## Modello unico

Ogni tool presente in `apps/filex-desktop/src/tool-manifest.ts` è un prodotto desktop Electron. La sua interfaccia può essere sviluppata con tecnologie web (React e Vite), ma il test funzionale avviene tramite Electron, con main process, preload e IPC attivi.

Il browser è ammesso solo per il debug veloce del renderer: non sostituisce il test dell'applicazione desktop né la verifica dell'installer.

## Fonti di verità

- Tool, workspace, URL dev e packaging: `apps/filex-desktop/src/tool-manifest.ts`.
- Avvio desktop in sviluppo: script `dev:<tool-id>` di `apps/filex-desktop/package.json`.
- Build e installer: script `build:<tool-id>` e `dist:<tool-id>:<piattaforma>` della shell.
- Contratti IPC: `@photo-tools/desktop-contracts`.

Non duplicare questo catalogo in altri tool. I consumer, inclusa FileX Dev Console, lo importano dalla shell.

## Avvio in sviluppo

| Tool ID | Porta renderer | Comando canonico |
|---|---:|---|
| `image-party-frame` | 4170 | `npm --workspace @photo-tools/filex-desktop run dev:image-party-frame` |
| `archivio-flow` | 4175 | `npm --workspace @photo-tools/filex-desktop run dev:archivio-flow` |
| `image-converter` | 4185 | `npm --workspace @photo-tools/filex-desktop run dev:image-converter` |
| `batch-print-layout` | 4205 | `npm --workspace @photo-tools/filex-desktop run dev:batch-print-layout` |
| `image-file-finder` | 4215 | `npm --workspace @photo-tools/filex-desktop run dev:image-file-finder` |
| `cache-sweep` | 4235 | `npm --workspace @photo-tools/filex-desktop run dev:cache-sweep` |
| `filex-send` | 4245 | `npm --workspace @photo-tools/filex-desktop run dev:filex-send` |
| `backup-guard` | 4255 | `npm --workspace @photo-tools/filex-desktop run dev:backup-guard` |
| `photo-selector-app` | 5000 | `npm --workspace @photo-tools/filex-desktop run dev:photo-selector-app` |

Gli script avviano il renderer e poi Electron; chiudere il processo avvia anche la chiusura dei processi coordinati. Gli script storici possono restare come alias, ma le nuove integrazioni usano sempre il nome canonico.

## Licenza in sviluppo

Le build Electron non pacchettizzate ricevono automaticamente uno stato `active` per FileX All Access. La licenza di sviluppo non legge né modifica l'attivazione reale e non può essere usata dagli installer o dalle build distribuite.

Per collaudare intenzionalmente il percorso reale delle licenze in locale, avviare Electron con `FILEX_LICENSE_ENFORCEMENT=enforce`: questo disabilita l'autorizzazione automatica e ripristina validazione, cache offline e blocchi di produzione.

## Google Drive in sviluppo

Tutti i tool FileX riutilizzano lo stesso client OAuth desktop e lo stesso account Google collegato dall'utente. La release riceve `IMAGE_SELECT_GOOGLE_CLIENT_ID` e `IMAGE_SELECT_GOOGLE_CLIENT_SECRET` dai secret CI; ogni cliente sceglie poi il proprio account nella normale schermata Google.

Per il collaudo locale, copiare `apps/filex-desktop/.env.local.example` come `apps/filex-desktop/.env.local` e valorizzare entrambe le credenziali del client OAuth ufficiale FileX di tipo **Desktop app**. Il file locale è ignorato da Git. PKCE protegge lo scambio del codice, ma il token endpoint del client FileX richiede anche il Client Secret ricevuto da Google.

Il callback deve essere un loopback dinamico nel formato `http://127.0.0.1:<porta>`, senza registrare una porta fissa. Un client creato come `Web application` produce `redirect_uri_mismatch` e non deve essere usato dal software desktop.

Il token utente viene cifrato con `safeStorage` e salvato nell'area condivisa FileX del profilo del sistema operativo. Non salvare password Google, access token o refresh token nel repository.

Lo scope richiesto è `drive.file`: FileX può gestire i file creati dal proprio workflow, non l'intero contenuto del Drive personale.

## FileX Dev Console

Avviare la dashboard con `npm run dev:console`. La console usa gli script canonici della shell Electron, mostra stato e log di ogni processo e permette di avviare, riaprire o arrestare i tool. Il link al renderer serve per la diagnostica; il collaudo funzionale resta quello della finestra Electron.

## Checklist minima

1. Verifica che l'ID sia presente nel manifest e che `devUrl` coincida con la porta reale.
2. Avvia il tool con lo script Electron canonico.
3. Verifica le funzioni che dipendono da preload, IPC, filesystem o servizi locali nell'app Electron.
4. Esegui il typecheck o il test più circoscritto disponibile per il componente modificato.
