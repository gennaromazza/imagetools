# FileX: architettura per aggiornamenti indipendenti di Suite e tool

## Stato del documento

- Tipo: studio architetturale e piano di refactoring.
- Ambito: versionamento, build, installer, pubblicazione e aggiornamento di FileX Suite e dei tool Windows.
- Obiettivo: una modifica a un tool deve richiedere la build e la pubblicazione del solo tool; una modifica alla Suite deve richiedere la build e la pubblicazione della sola Suite.
- Pubblicazione remota esclusa: l'implementazione va integrata e verificata prima del rollout.

## Avanzamento implementazione

Implementato sul branch `codex/independent-component-releases`:

- versioni indipendenti dei tre tool attivi e FileX Suite 0.1.26;
- versione Electron risolta dal package del componente selezionato;
- build Suite senza compilazione di Image Select Pro;
- feed Suite `suite-channel-stable`/`suite-channel-beta` separato dal catalogo tool;
- cataloghi `update-catalog-stable`/`update-catalog-beta` aggiornati per singola voce;
- workflow Windows selettivo, tag namespaced e verifica remota dei checksum;
- controllo UI Suite distinto dal refresh automatico delle schede tool;
- applicazione di `minLauncherVersion` prima del download di un tool;
- test di regressione per il contratto di release indipendente.

Rimane come fase successiva la separazione fisica degli host Electron descritta nella Fase 4.

## Risultato atteso

FileX deve trattare la Suite e ogni tool come componenti distribuibili indipendenti:

```text
FileX Suite                    suite-vX.Y.Z
  |-- Image Select Pro        photo-selector-app-vA.B.C
  |-- Image Party Frame       image-party-frame-vD.E.F
  |-- Archivio Flow           archivio-flow-vG.H.I
  |-- altri tool              <tool-id>-vJ.K.L
```

Ogni componente deve avere:

- una versione propria;
- un comando di build proprio;
- un installer proprio;
- un tag e una GitHub Release propri;
- note di rilascio proprie;
- una voce indipendente nel catalogo remoto;
- test e controlli di pubblicazione limitati al componente interessato.

Una release di un tool non deve cambiare la versione della Suite, produrre l'installer della Suite o rendere disponibile un falso aggiornamento della Suite.

## Analisi dello stato attuale

### 1. Versione unica incorporata in tutti gli installer

`apps/filex-desktop/electron-builder.config.mjs` legge una sola versione da `apps/filex-desktop/package.json` e la usa per qualunque valore di `FILEX_TOOL`. Lo stesso `package.json` viene poi incluso nell'ASAR di Suite e tool.

Conseguenze:

- Suite, Image Select Pro, Image Party Frame e Archivio Flow ricevono la stessa versione, anche se cambia un solo componente;
- `app.getVersion()` e la versione letta da `resources/app.asar/package.json` non rappresentano la versione reale del singolo tool;
- il tag Git viene validato soltanto contro la versione del package desktop;
- le versioni presenti nei `package.json` dei tool (`0.1.0` allo stato attuale) non sono la sorgente usata dagli installer.

### 2. Un solo host Electron contiene le responsabilita' di tutti i prodotti

`apps/filex-desktop/src/main.ts` seleziona il prodotto tramite `FILEX_TOOL`, ma importa staticamente servizi della Suite e dei diversi tool. `tsc` compila l'intera cartella `src` in `.output/electron` ed Electron Builder include `.output/electron/**/*` in ogni installer.

Conseguenze:

- ogni installer contiene codice desktop non necessario al componente selezionato;
- una modifica a servizi condivisi o tool-specifici passa dallo stesso package desktop;
- il confine fra Suite, runtime condiviso e adattatori dei tool e' logico, non fisico;
- test e dipendenze sono difficili da attribuire a un solo prodotto.

### 3. La build della Suite compila inutilmente Image Select Pro

Lo script `build:suite` esegue:

```text
build:shell -> build photo-selector-app -> build:suite-launcher
```

L'installer Suite, pero', copia come renderer soltanto `.output/suite-launcher`. La build del renderer di Image Select Pro non e' una risorsa della Suite ed e' quindi un costo evitabile.

### 4. Il workflow pubblica sempre Suite e tre tool

`.github/workflows/windows-release.yml` viene attivato da ogni tag `vX.Y.Z` e costruisce sempre:

- FileX Suite;
- Image Select Pro;
- Image Party Frame;
- Archivio Flow.

Il workflow richiede inoltre che tutti e tre i tool abbiano la stessa versione del tag. Questo e' l'accoppiamento che rende pesante ogni pubblicazione.

### 5. L'updater Suite usa la release GitHub globale piu' recente

`apps/filex-desktop/src/suite-updater.ts` interroga `repos/gennaromazza/imagetools/releases/latest` e interpreta il relativo `tag_name` come versione della Suite. `electron-updater` usa a sua volta il provider GitHub configurato nel builder.

Questo modello funziona soltanto se ogni GitHub Release contiene sempre una nuova Suite. Con release indipendenti, la release piu' recente potrebbe essere quella di un tool e verrebbe scambiata per una release della Suite.

Anche il link permanente del sito (`releases/latest/download/FileX-Suite-stable-x64-setup.exe`) diventerebbe inaffidabile appena l'ultima release non contenesse l'installer della Suite.

### 6. Il catalogo dei tool e' gia' concettualmente indipendente, ma la sua posizione non lo e'

`stable.json`/`beta.json` contengono una versione per ciascun `toolId` e il generatore conserva le voci dei tool non ricostruiti. Questa e' una buona base.

Restano pero' quattro problemi:

- il catalogo pubblico viene scaricato da `releases/latest/download/<channel>.json`, quindi dipende dalla GitHub Release globalmente piu' recente;
- generatore, validatore, note e manifest sono collocati dentro l'app della Suite;
- il workflow forza alla stessa versione i tre tool attivi;
- `minLauncherVersion` e' presente nel contratto ma non viene applicato dall'updater prima dell'installazione.

### 7. Il pulsante di refresh combina due operazioni diverse

Il click sul refresh in `suite-launcher-src/app.js` esegue insieme:

- aggiornamento dello stato dei tool tramite il catalogo;
- controllo della nuova versione della Suite.

Le API IPC sono gia' separate, ma la UX le presenta come una sola azione. Il controllo automatico delle schede dei tool puo' restare globale, mentre il comando esplicito `Aggiorna FileX Suite` deve riguardare soltanto la Suite.

### 8. Alcuni tool del manifest non hanno sorgenti versionate attive

Batch Print Layout, Image Converter e Trova Foto da Lista compaiono nel manifest e nel lockfile, ma nelle rispettive directory locali non e' presente un `package.json` tracciato con il sorgente applicativo. Le loro voci storiche possono essere conservate, ma non devono essere selezionabili in una nuova pipeline finche' i workspace non vengono ripristinati.

## Architettura target

### Principio 1: prodotto, runtime e catalogo sono responsabilita' distinte

```text
apps/filex-desktop                 applicazione FileX Suite
apps/<tool>                        applicazione e versione del singolo tool
packages/desktop-core              primitive Electron realmente condivise
packages/release-contracts         tipi e validazione del catalogo update
release/                            configurazione e script di pubblicazione
```

`apps/filex-desktop` deve diventare progressivamente la sola Suite. Il codice nativo specifico dei tool deve vivere nel tool interessato; soltanto primitive autenticamente condivise devono essere estratte in package comuni.

### Principio 2: una sorgente di versione per ogni distribuibile

Sorgenti autorevoli proposte:

| Componente | Sorgente versione |
| --- | --- |
| FileX Suite | `apps/filex-desktop/package.json` |
| Image Select Pro | `apps/photo-selector-app/package.json` |
| Image Party Frame | `apps/image-party-frame/package.json` |
| Archivio Flow | `apps/archivio-flow/package.json` |
| Futuri tool | `apps/<tool>/package.json` |

Il builder deve risolvere la versione dal workspace del target e passarla a Electron Builder con `extraMetadata.version`. Per la Suite usa il package della Suite; per un tool usa il package del tool.

Il lockfile deve essere aggiornato solo per i package la cui versione cambia. Non deve piu' esistere l'obbligo di allineare tutte le versioni.

### Principio 3: tag con namespace del componente

Tag proposti:

- `suite-v0.2.0`;
- `photo-selector-app-v1.4.2`;
- `image-party-frame-v1.1.0`;
- `archivio-flow-v0.8.3`.

Il namespace evita collisioni quando Suite e tool hanno lo stesso numero di versione e permette ai workflow di capire il solo componente da costruire.

### Principio 4: catalogo remoto stabile, non collegato a `releases/latest`

Il client non deve piu' scoprire versioni tramite la GitHub Release globalmente piu' recente. Deve leggere un endpoint stabile e cache-bustabile, per esempio:

```text
https://github.com/gennaromazza/imagetools/releases/download/update-catalog-stable/stable.json
https://github.com/gennaromazza/imagetools/releases/download/update-catalog-beta/beta.json
```

I tag `update-catalog-stable` e `update-catalog-beta` rappresentano release tecniche mutabili dedicate al solo catalogo. Gli installer restano invece asset immutabili nelle release con tag del componente.

In alternativa il catalogo puo' essere pubblicato su un branch/hosting statico dedicato. Non e' consigliato usare direttamente `docs/updates` finche' non e' definito un aggiornamento atomico che impedisca a un successivo deploy Pages di ripristinare un catalogo vecchio.

### Principio 5: un catalogo unico con voci indipendenti

Schema concettuale v2:

```json
{
  "schemaVersion": 2,
  "channel": "stable",
  "generatedAt": "...",
  "components": {
    "suite": {
      "id": "suite-launcher",
      "version": "0.2.0",
      "installerUrl": ".../suite-v0.2.0/FileX-Suite-0.2.0-stable-x64-setup.exe",
      "installerSha256": "...",
      "highlights": []
    },
    "tools": {
      "photo-selector-app": {
        "version": "1.4.2",
        "installerUrl": ".../photo-selector-app-v1.4.2/Image-Select-Pro-1.4.2-stable-x64-setup.exe",
        "installerSha256": "...",
        "minSuiteVersion": "0.2.0",
        "desktopApiVersion": 1,
        "highlights": []
      }
    }
  },
  "payloadSha256": "...",
  "payloadSignature": "..."
}
```

La pubblicazione deve leggere il catalogo remoto corrente, sostituire una sola voce e lasciare byte-per-byte invariati gli altri componenti, salvo `generatedAt` e firma del documento.

La compatibilita' non deve essere espressa soltanto con la versione commerciale della Suite. E' preferibile introdurre anche `desktopApiVersion`, incrementato solo quando cambia il contratto IPC/runtime richiesto da un tool.

### Principio 6: build selettiva e host Electron separati

Architettura finale consigliata:

```text
apps/filex-desktop/
  src/main.ts                    solo launcher, catalogo e gestione installazioni
  src/preload.ts                 API della Suite

apps/photo-selector-app/
  electron/main.ts               host nativo di Image Select Pro
  electron/preload.ts

apps/image-party-frame/
  electron/main.ts               host e server del solo tool
  electron/preload.ts

apps/archivio-flow/
  electron/main.ts               host e watcher del solo tool
  electron/preload.ts

packages/desktop-core/
  process, finestre e utility condivise senza logica di prodotto

packages/release-contracts/
  schema, parser, firma e compatibilita' del catalogo
```

Ogni installer include soltanto il main/preload del proprio prodotto, il proprio renderer e le dipendenze native necessarie. La variabile `FILEX_TOOL` puo' essere mantenuta durante la migrazione, ma non deve essere il confine architetturale finale.

## Pipeline target

### Release Suite

Trigger: tag `suite-v*` o dispatch con componente `suite`.

1. Validare il tag contro `apps/filex-desktop/package.json`.
2. Eseguire test/typecheck della Suite e dei package condivisi importati.
3. Costruire solo launcher e host della Suite.
4. Costruire solo l'installer FileX Suite.
5. Pubblicare l'asset nella release `suite-vX.Y.Z`.
6. Aggiornare soltanto `components.suite` nel catalogo.
7. Verificare URL e SHA-256 remoti.
8. Verificare che una Suite precedente proponga la nuova versione.

### Release singolo tool

Trigger: tag `<tool-id>-v*` o dispatch con `component=<tool-id>`.

1. Validare il tag contro `apps/<tool>/package.json`.
2. Eseguire test/typecheck del tool e dei package condivisi importati.
3. Costruire soltanto renderer e host Electron del tool.
4. Costruire soltanto il suo installer.
5. Pubblicare l'asset nella release `<tool-id>-vX.Y.Z`.
6. Aggiornare soltanto la voce del tool nel catalogo.
7. Verificare URL, SHA-256 e compatibilita' dichiarata.
8. Verificare che la Suite mostri `Aggiorna` solo sulla scheda interessata.
9. Verificare che la Suite non mostri un proprio aggiornamento.

### Release multipla intenzionale

Una matrice di componenti puo' essere consentita per modifiche condivise, ma deve essere una scelta esplicita. Non deve mai essere il comportamento predefinito della release di un tool.

## Piano di refactoring

### Fase 0 - Test di caratterizzazione

Obiettivo: bloccare il comportamento utile esistente prima di spostare codice.

- Testare parsing, integrita' e fallback del manifest.
- Testare confronto indipendente delle versioni.
- Testare rilevamento delle installazioni e lettura versione ASAR.
- Testare che l'aggiornamento chiuda soltanto il tool selezionato.
- Testare che un tag tool non venga interpretato come versione Suite.
- Testare la generazione di un catalogo aggiornando una sola voce.

Gate: nessun refactoring strutturale prima che questi test siano verdi.

### Fase 1 - Versioni e builder indipendenti

Obiettivo: eliminare l'obbligo di incrementare la Suite quando cambia un tool, senza spostare subito tutto il runtime.

- Portare le versioni reali nei `package.json` dei tre tool attivi.
- Aggiungere al descriptor il percorso del package sorgente della versione.
- Fare risolvere a Electron Builder la versione del target.
- Impostare `extraMetadata.version` e verificare la versione nell'ASAR.
- Separare le directory di output per componente.
- Rimuovere la build di Image Select Pro da `build:suite`.
- Rendere `dist:all-tools:win` un comando manuale di manutenzione, non una dipendenza delle release normali.

Gate: build Suite e build di ciascun tool producono versioni diverse e corrette, senza costruire gli altri componenti.

### Fase 2 - Catalogo v2 e updater indipendenti

Obiettivo: eliminare ogni dipendenza da `releases/latest`.

- Spostare schema, generatore, validatore e note fuori dall'app Suite.
- Introdurre il catalogo v2 con sezione Suite e sezione tool.
- Leggere il catalogo da un URL stabile dedicato.
- Fare controllare alla Suite soltanto `components.suite`.
- Fare controllare alle schede soltanto `components.tools[toolId]`.
- Applicare realmente `minSuiteVersion` e/o `desktopApiVersion`.
- Conservare temporaneamente il parser v1 per aggiornare le installazioni esistenti.
- Aggiungere cache locale con ultimo catalogo valido; il manifest bundled deve essere solo bootstrap, non una fonte che puo' far regredire versioni.

Gate: pubblicando un catalogo con il solo tool a versione maggiore, la Suite resta `up-to-date` e una sola scheda mostra `Aggiorna`.

### Fase 3 - Workflow e tag per componente

Obiettivo: rendere l'indipendenza effettiva in CI/CD.

- Sostituire `windows-release.yml` con workflow separati o con un workflow riusabile parametrico.
- Introdurre tag namespaced.
- Validare la versione contro il package del componente selezionato.
- Costruire e caricare soltanto i suoi asset.
- Aggiornare il catalogo in modo atomico dopo la pubblicazione e la verifica degli asset.
- Impedire la diminuzione di versione e la modifica accidentale delle altre voci.
- Aggiungere concurrency lock per canale durante l'aggiornamento del catalogo.
- Aggiornare il sito download affinche' risolva la voce Suite dal catalogo, non dalla release globale piu' recente.

Gate: tempi e artefatti di una release tool non includono FileX Suite o altri tool.

### Fase 4 - Separazione fisica degli host Electron

Obiettivo: ridurre dimensioni, dipendenze e blast radius.

- Estrarre primitive comuni in `packages/desktop-core`.
- Spostare updater, catalogo, tool discovery e process coordinator nel solo host Suite.
- Spostare servizi Photo Selector nel relativo host.
- Spostare servizi Archivio Flow e Image Party Frame nei relativi host.
- Creare preload e contratti IPC minimi per ogni prodotto.
- Fare produrre al compilatore output target-specifici, evitando `.output/electron/**/*` condiviso.
- Rimuovere `FILEX_TOOL` come selettore dell'applicazione packaged dopo la migrazione di tutti i tool.

Gate: analisi degli installer dimostra che ciascun ASAR contiene soltanto codice e dipendenze del prodotto.

### Fase 5 - Migrazione operativa e pulizia

- Pubblicare una ultima release compatibile con catalogo v1 e v2.
- Aggiornare prima la Suite esistente a una versione capace di leggere v2.
- Pubblicare una release canary di un solo tool senza nuova Suite.
- Verificare aggiornamento, rollback e installazioni legacy per-machine/per-user.
- Rimuovere il fallback v1 soltanto dopo la finestra di migrazione.
- Aggiornare contratto di pubblicazione, runbook, changelog e AGENTS.md.

## Inventario dei file interessati

### Versionamento e comandi

- `package.json`
- `package-lock.json`
- `apps/filex-desktop/package.json`
- `apps/photo-selector-app/package.json`
- `apps/image-party-frame/package.json`
- `apps/archivio-flow/package.json`
- futuri `apps/<tool>/package.json` ripristinati

### Packaging

- `apps/filex-desktop/electron-builder.config.mjs`
- `apps/filex-desktop/scripts/build-suite-launcher.mjs`
- `apps/filex-desktop/scripts/sync-branding.mjs`
- `apps/filex-desktop/scripts/copy-image-party-frame-server.mjs`
- `apps/filex-desktop/scripts/copy-archivio-server.mjs`
- `apps/filex-desktop/scripts/clean-release.mjs`
- `apps/filex-desktop/scripts/collect-installers.mjs`
- nuovi builder/entrypoint Electron nei singoli tool

### Runtime Suite e aggiornamenti

- `apps/filex-desktop/src/main.ts`
- `apps/filex-desktop/src/preload.ts`
- `apps/filex-desktop/src/suite-updater.ts`
- `apps/filex-desktop/src/updater.ts`
- `apps/filex-desktop/src/filex-process-coordinator.ts`
- `apps/filex-desktop/src/tool-manifest.ts`
- `apps/filex-desktop/suite-launcher-src/app.js`
- `apps/filex-desktop/suite-launcher-src/index.html`
- `apps/filex-desktop/suite-launcher-src/dock-window.js`

### Runtime tool da estrarre dal main condiviso

- `apps/filex-desktop/src/desktop-store.ts`
- `apps/filex-desktop/src/google-drive-service.ts`
- `apps/filex-desktop/src/native-folder-service.ts`
- `apps/filex-desktop/src/native-image-service.ts`
- `apps/filex-desktop/src/thumbnail-disk-cache.ts`
- `apps/filex-desktop/src/raw-jpeg-extractor.ts`
- `apps/filex-desktop/src/xmp-compatibility.ts`
- `apps/filex-desktop/src/image-converter-service.ts`
- `apps/filex-desktop/src/image-file-finder-service.ts`
- i consumer `filexDesktop` in Photo Selector, Archivio Flow e Image Party Frame

### Contratti

- `packages/desktop-contracts/src/index.ts`
- artefatti generati/tracciati di `packages/desktop-contracts/src/index.*`
- nuovo `packages/release-contracts/` oppure una sezione release isolata nel package esistente

### Catalogo e note

- `apps/filex-desktop/release-manifests/stable.json`
- `apps/filex-desktop/release-manifests/beta.json`
- `apps/filex-desktop/release-notes.json`
- `apps/filex-desktop/scripts/generate-release-manifest.mjs`
- `apps/filex-desktop/scripts/validate-release-manifest.mjs`
- nuova directory top-level `release/` consigliata

### CI/CD e pubblicazione

- `.github/workflows/windows-release.yml`
- `.github/workflows/pages.yml`
- nuovi workflow `release-suite.yml`, `release-tool.yml` e workflow riusabile
- `AGENTS.md`

### Documentazione e sito

- `README.md`
- `CHANGELOG.md`
- `docs/12-release-engineering-windows.md`
- `docs/13-installer-and-updater-runbook.md`
- `docs/18-publish-build-contract.md`
- `docs/GIT_WORKFLOW.md`, soltanto se cambiano naming o gestione dei branch release
- `docs/index.html`

### Test

- `scripts/test-filex-updater-lock.mjs`
- nuovi test di manifest/catalogo, version resolver, compatibilita', build selection e workflow contract

## Criteri di accettazione finali

1. Una modifica solo a Image Select Pro incrementa soltanto la sua versione.
2. Il comando di release produce soltanto l'installer di Image Select Pro.
3. Nessun installer o `latest.yml` della Suite viene rigenerato.
4. Il catalogo cambia soltanto nella voce `photo-selector-app`.
5. La Suite installata non propone un proprio aggiornamento.
6. La scheda Image Select Pro propone `Aggiorna`; le altre schede no.
7. Dopo l'aggiornamento viene chiuso e riaperto soltanto Image Select Pro.
8. Una release Suite non ricostruisce alcun tool.
9. Il sito continua a scaricare l'ultima Suite anche se la release GitHub piu' recente appartiene a un tool.
10. URL e SHA-256 di ogni voce del catalogo sono verificati dopo l'upload remoto.
11. Una versione incompatibile viene bloccata con un messaggio esplicito, non installata.
12. Il rollback modifica soltanto la voce del componente interessato.

## Rischi e mitigazioni

- **Migrazione delle installazioni esistenti:** mantenere nomi executable, appId e percorsi NSIS attuali; cambiare soltanto sorgente versione e feed.
- **Catalogo aggiornato prima degli asset:** pubblicare prima gli asset, verificarli, poi aggiornare atomicamente il catalogo.
- **Due release simultanee:** serializzare per canale l'aggiornamento del catalogo e rileggere sempre l'ultima revisione prima del merge.
- **Firma del catalogo:** mantenere SHA-256 e HMAC; chiarire la distribuzione della chiave di verifica, poiche' un HMAC richiede un segreto anche nel client. Per una verifica pubblica forte valutare firma asimmetrica.
- **Package condiviso modificato:** calcolare i componenti impattati o richiederli esplicitamente; non includere automaticamente la Suite se non importa quel package.
- **Tool storici senza workspace:** preservare le voci remote ma bloccarne la pubblicazione fino al ripristino del sorgente e del package versionato.

## Decisione raccomandata

Procedere in due traguardi:

1. **Indipendenza di release** con Fasi 0-3: risolve subito il costo operativo e il falso accoppiamento delle versioni.
2. **Indipendenza di runtime** con Fasi 4-5: riduce dimensione degli installer e rende il confine architetturale duraturo.

Fare direttamente una riscrittura completa degli host Electron aumenterebbe il rischio sull'updater. La separazione di versioni, catalogo e workflow deve arrivare prima; la separazione fisica puo' quindi avvenire componente per componente mantenendo sempre una pipeline pubblicabile.
