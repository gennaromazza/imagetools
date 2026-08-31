# FileX Suite (ex ImageTools)

Repository principale della suite **FileX** (ex ImageTools): strumenti professionali per workflow fotografici, progettati per lavorare insieme come un ecosistema modulare.

## Struttura

- `apps/`: applicazioni finali della suite
- `packages/`: moduli condivisi
- `docs/`: documentazione di suite e dei singoli tool
- `website/`: sito pubblico e landing page di FileX, pubblicati sul target Firebase Hosting `filex-website`

Il sito viene sincronizzato automaticamente dopo ogni release `suite-vX.Y.Z` dal workflow `Sync FileX website after Suite release`. Il workflow aggiorna il fallback della versione nella homepage, mantiene il link stabile dell'installer Suite e fa il deploy su Firebase Hosting. È necessaria la secret GitHub Actions `FIREBASE_TOKEN` autorizzata al progetto Firebase `gen-lang-client-0321087169`.

## Tool principali

- `apps/image-party-frame` — Batch framing, crop live, export eventi
- `apps/archivio-flow` — StudioFlow local-first: import SD verificato, archivio SQLite, mapping lavori e replica opzionale dei manifest su Google Drive
- `apps/photo-selector-app` — Image Select Pro: selezione e classificazione foto avanzata
- `apps/cache-sweep` — FileX Adobe Cleaner: utility esclusivamente Adobe per pulire cache supportate e rimuovere vecchie versioni affiancate a quella corrente su Windows
- `apps/filex-send` — Ricezione locale tramite Wi-Fi/QR e consegna remota con link configurabile, upload a PC spento e recupero automatico
- `apps/filex-cloud-functions` — API europea, storage dei file in attesa e cancellazione automatica un'ora dopo la consegna verificata
- `apps/filex-send-web` — Pagina mobile HTTPS di FileX Send, senza app o account cliente

## Launcher Windows

FileX Suite gestisce ogni tool separatamente. La Suite usa un feed di aggiornamento dedicato; ogni tool mostra `Installa`, `Apri` oppure `Aggiorna` in base al catalogo remoto dei tool. Una release tool non costruisce o aggiorna la Suite.

Il launcher consente di organizzare i tool in sezioni personali persistenti. Lo stesso tool può comparire in più sezioni, essere aggiunto tramite trascinamento e tornare in qualsiasi momento all'organizzazione predefinita senza modificare l'installazione.
Le sezioni personali possono essere rinominate direttamente nell'interfaccia, confermando con `Invio` o annullando con `Esc`.

## Licenze e pagamenti

FileX usa un solo entitlement, `filex-all-access`, valido per tutti gli strumenti presenti e futuri. La Suite gestisce attivazione, disattivazione, verifica online e attestazione firmata per l'uso offline; il piano prevede due dispositivi e 14 giorni offline dopo una verifica valida. Il backend Firebase non riceve dati carta e traduce esclusivamente gli eventi firmati del gestore dei pagamenti nello stato tecnico della licenza.

La copertura e' obbligatoria nel manifest desktop: i tool sul runtime condiviso ereditano automaticamente il gate centrale, mentre un'app con entry point Electron autonomo deve dichiarare `licenseRuntime: "standalone"` e invocare il gate prima di creare la finestra. `npm run test:filex-license-coverage` impedisce di aggiungere o pubblicare un tool futuro privo di questo collegamento.

Stato commerciale al 22 agosto 2026: PayPal Subscriptions e' configurato in sandbox. Backend, pulsanti, webhook e area cliente Firebase email/password sono implementati; il collegamento della licenza richiede che l'email verificata coincida con quella PayPal. L'enforcement remoto resta attivo e le licenze prova amministrative continuano a funzionare.

Per aggiornare:

1. aggiornare FileX Suite quando richiesto;
2. riaprire la Suite e premere il refresh;
3. premere `Aggiorna` nella scheda del tool interessato.

Download ufficiale Suite: [installer stabile](https://github.com/gennaromazza/imagetools/releases/download/suite-channel-stable/FileX-Suite-stable-x64-setup.exe). Le release dei singoli componenti sono disponibili nell'[archivio release](https://github.com/gennaromazza/imagetools/releases).

- `avvia-progetto.bat`: schermata di scelta tool (da estendere per includere tutti i tool FileX)
- `avvia-image-party-frame.bat`: avvia direttamente Image Party Frame
- `avvia-archivio-flow.bat`: avvia Archivio Flow
- `avvia-photo-selector.bat`: avvia Image Select Pro

## Visione Suite FileX

L’obiettivo è una suite integrata, con:
- UI e UX coerenti
- tecnologie allineate (React, Vite, TypeScript, Node)
- launcher e documentazione unificati
- moduli condivisi per storage, preset, tipi, orchestrazione

## Roadmap Unificazione

1. Allineamento documentazione e naming (FileX branding)
2. Aggiornamento launcher principale per includere tutti i tool
3. Uniformazione stack tecnologico (React 18/19, dipendenze, pattern UI)
4. Refactor moduli condivisi e servizi
5. Packaging desktop e distribuzione facilitata

## Documentazione

- `docs/GIT_WORKFLOW.md`: policy Git operativa (branch, sync, conflitti, recovery)
- `docs/desktop-tool-development.md`: modello e comandi di sviluppo Electron per tutti i tool desktop
- `docs/STUDIOFLOW_ARCHITECTURE.md`: architettura local-first e confini di Archivio Flow
- `docs/STUDIOFLOW_DRIVE_REGISTRY.md`: contratto della replica manifest e configurazione OAuth Google Drive
- `docs/archivio-flow-desktop-checklist.md`: stato e gate della release Archivio Flow corrente
- `docs/18-publish-build-contract.md`: contratto completo per build, pubblicazione, sito e updater
- `docs/20-licensing-and-payments-mvp.md`: architettura, sicurezza e rollout di licenze e pagamenti
- `docs/21-licensing-operations-runbook.md`: configurazione e operazioni PayPal/Firebase
- `docs/tools/filex-id-photo/README.md`: specifica ufficiale di FileX ID Photo, workflow professionale, Photoshop, stampa e gate di release
- `docs/tools/`: documenti specifici dei singoli tool
