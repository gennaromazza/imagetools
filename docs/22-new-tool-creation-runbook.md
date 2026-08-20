# FileX: Runbook Creazione e Rilascio di un Nuovo Tool

Questo documento fissa le regole e la procedura operativa da seguire quando si aggiunge una nuova applicazione (tool) all'ecosistema di FileX Suite, garantendo che sia correttamente integrato nella build di sistema, gestisca adeguatamente le licenze e venga rilasciato senza intoppi dalla CI/CD.

---

## 1. Creazione del pacchetto (workspace npm)

I nuovi tool vengono tipicamente creati all'interno della directory `apps/` seguendo la struttura monorepo:

1. Crea la directory: `apps/nome-nuovo-tool/`
2. Configura un `package.json` definendo in particolare:
   - `name`: `@photo-tools/nome-nuovo-tool`
   - `version`: (es. `0.1.0`)
   - `main`: opzionale (dipende da come viene compilato)
   - I vari script per avviare l'ambiente di `dev` e generare la `build` web/renderer e (se serve) il backend Electron.

---

## 2. Registrazione in FileX Desktop (`tool-manifest.ts`)

Per essere visto dalla shell desktop, il tool dev'essere esplicitamente descritto nel file manifesto.

**File da modificare:** `apps/filex-desktop/src/tool-manifest.ts`

Aggiungi il descrittore del tool alla costante `desktopToolManifest`:
```typescript
  "nome-nuovo-tool": {
    id: "nome-nuovo-tool",
    displayName: "Nome Formattato",
    productName: "Nome Prodotto",
    executableName: "Eseguibile-Windows", // Es. Nome-Nuovo-Tool
    workspacePackageName: "@photo-tools/nome-nuovo-tool",
    versionPackageRelativeToShell: "../nome-nuovo-tool",
    // Configura i path necessari:
    electronMainOutputFile: "nome-nuovo-tool/electron/main.js", // se applicabile, o quello del template base
    electronPreloadOutputFile: "nome-nuovo-tool/electron/preload.cjs",
    workspaceDistDirRelativeToShell: "../nome-nuovo-tool/.output/web",
    packagedDistDir: "apps/nome-nuovo-tool/web",
    brandAssetName: "nome-asset-icona",
    defaultWindowWidth: 1280,
    defaultWindowHeight: 860,
    minWindowWidth: 980,
    minWindowHeight: 700,
    devUrl: "http://127.0.0.1:4XXX", // Scegliere una porta univoca per il web server di sviluppo Vite
    releaseChannelDefault: "stable",
    releaseManifestKey: "nome-nuovo-tool",
    suiteVisible: true,
    
    // IMPORTANTE: Gestione Licenze
    licenseRuntime: "shared-runtime", 
  },
```

### Regole per il campo `licenseRuntime`
È obbligatorio impostare `licenseRuntime` correttamente. I valori permessi sono:
- `shared-runtime`: (Es. Image Select Pro) Il tool necessita di una licenza FileX All Access attiva. FileX Suite ne bloccherà l'avvio ("Apri") se l'utente non ha una licenza valida.
- `standalone`: (Es. FileX Send, Backup Guard, Cache Sweep) Il tool si gestisce da solo in modalità freeware, freemium o con un suo meccanismo di licenza indipendente. **La Suite avvierà sempre questi tool senza bloccarne il lancio.**
- `management`: Riservato al solo `suite-launcher`.

Prima della prima release, la scelta deve essere provata sull'installer con enforcement reale. Per `shared-runtime` verificare blocco senza licenza e avvio con licenza attiva; per `standalone` documentare e testare esplicitamente l'eventuale entitlement nel suo entry point Electron. Verificare inoltre disinstallazione/reinstallazione: la rimozione deve riuscire indipendentemente dallo stato o dalla connettività della licenza.

---

## 3. Aggiornamento degli script di FileX Desktop (`package.json`)

Per permettere la build e l'estrazione locale dell'installer, vanno aggiunti nuovi script in `apps/filex-desktop/package.json`.

Cerca le rispettive sezioni e aggiungi:
1. Sotto i task di build:
   `"build:nome-nuovo-tool": "npm run build:shell && npm --workspace @photo-tools/nome-nuovo-tool run build"`
2. Sotto i task di start (opzionale se utile):
   `"start:nome-nuovo-tool": "npm run build:nome-nuovo-tool && cross-env FILEX_TOOL=nome-nuovo-tool electron ."`
3. Sotto i task di dev (concurrently con wait-on per la porta Vite):
   `"dev:nome-nuovo-tool": "npm run build:shell && concurrently -k \"npm --workspace @photo-tools/nome-nuovo-tool run dev -- --host 127.0.0.1 --port 4XXX\" \"wait-on tcp:127.0.0.1:4XXX && cross-env FILEX_TOOL=nome-nuovo-tool FILEX_RENDERER_MODE=dev FILEX_RENDERER_URL=http://127.0.0.1:4XXX electron .\""`
4. Sotto i task di dist (build dell'installer Windows):
   `"dist:nome-nuovo-tool:win": "npm run build:nome-nuovo-tool && cross-env FILEX_TOOL=nome-nuovo-tool electron-builder --config electron-builder.config.mjs --win nsis --x64 --publish never"` (aggiungere `--ia32` se si desidera buildare anche l'architettura a 32 bit).
5. **Importante:** Aggiungi l'esecuzione di `npm run dist:nome-nuovo-tool:win` nel macro-comando `"dist:all-tools:win"`.

---

## 4. Configurazione della CI/CD su GitHub Actions (`windows-release.yml`)

Senza questa parte il tool **non verrà mai compilato e pubblicato su GitHub**, pur essendo visibile all'interno della Suite!

**File da modificare:** `.github/workflows/windows-release.yml`

In questa action ci sono 3 passaggi fondamentali da integrare:

1. **Trigger via Push dei Tag**
   All'inizio del file, nell'array `on: push: tags:`, aggiungi il pattern per il tag del nuovo tool:
   ```yaml
      - "nome-nuovo-tool-v*"
   ```
2. **Scelte disponibili del `workflow_dispatch` (per rilascio manuale)**
   Aggiungere l'opzione nell'elenco degli `options:` in `inputs.component`:
   ```yaml
          - nome-nuovo-tool
   ```
3. **Verifica post-build**
   Trovate il blocco `Verify selected artifact version` (job `build-and-release`). Inserite nel `switch ($env:FILEX_COMPONENT)` l'esatto prefisso assegnato nell'installer (parametro `executableName` nel manifest):
   ```powershell
          $expectedPrefix = switch ($env:FILEX_COMPONENT) {
            # ... altri tool
            "nome-nuovo-tool" { "Eseguibile-Windows" }
          }
   ```

---

## 5. Rilascio e Push

Una volta configurato il tutto:
1. Esegui `npm install` alla root del monorepo (se hai aggiunto pacchetti o per allineare il `package-lock.json`).
2. Verifica in locale che la build compili con `npm run dist:nome-nuovo-tool:win` (da `apps/filex-desktop`).
3. Crea un commit per salvare il tool: `git commit -am "feat: create nome-nuovo-tool"`
4. Lancia la pubblicazione del tool creando un tag: `git tag nome-nuovo-tool-v0.1.0`
5. Lancia la pubblicazione di FileX Suite creando un tag `suite-v0.1.XX` in modo che il catalogo si aggiorni integrando il nuovo elemento.
6. Pusha sia commit che tag: `git push origin main && git push --tags`

La GitHub Action leggerà il tag, farà la build del singolo tool indicato e genererà l'eseguibile di release su GitHub!
