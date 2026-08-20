# FileX / ImageTools — istruzioni di repository

## Ambito e struttura reale

Questo è un monorepo npm (workspaces `apps/*` e `packages/*`) scritto principalmente in TypeScript. I comandi vanno eseguiti dalla radice del repository con `npm`; non assumere l'uso di pnpm.

- `apps/filex-desktop`: shell Electron, catalogo dei tool e integrazioni native.
- `apps/*`: applicazioni e servizi indipendenti. Una cartella è un workspace solo se contiene `package.json`.
- `packages/*`: librerie condivise; il contratto desktop è in `packages/desktop-contracts`.
- `apps/filex-dev-console`: dashboard locale di sviluppo; non è un tool distribuito dalla Suite.

Prima di modificare un'app, leggi il suo `package.json`, gli script disponibili e gli eventuali `AGENTS.md` nella sua gerarchia. Non dedurre porte, nomi di package, tool ID o comandi: sono definiti dal codice e dai manifest effettivi.

## Metodo anti-allucinazione e uso efficiente del contesto

1. Cerca prima i file e il testo pertinenti con `rg`; poi leggi solo le sezioni necessarie.
2. Considera vero solo ciò che è verificabile nel repository, nei comandi eseguiti o in una fonte esterna esplicitamente consultata. Distingui sempre fatti, ipotesi e risultato di una verifica.
3. Non inventare file, API, script, porte, dipendenze, workflow, versioni, test o comportamenti. Se una fonte di verità manca, dichiaralo.
4. Se il dubbio cambia l'implementazione, lo scope, il rischio o l'effetto sui dati, fermati e chiedi all'utente una domanda breve e concreta. Non chiedere invece ciò che può essere scoperto in sicurezza dal repository.
5. Prima di modificare, controlla lo stato Git e preserva le modifiche non correlate dell'utente. Dopo la modifica esegui la verifica più piccola e pertinente disponibile.
6. Mantieni il contesto snello: non rileggere file già compresi, non caricare directory intere, non ripetere istruzioni ereditate e non avviare build/test globali se basta un workspace o uno script mirato.
7. Comunica in modo sintetico: esito, file toccati, verifica e solo i limiti rilevanti. Evita tutorial e riepiloghi ridondanti.

## Comandi comuni

```powershell
npm ci
npm run typecheck
npm run lint
npm run build
npm run dev:console
```

Per un singolo workspace usa sempre il suo nome reale:

```powershell
npm --workspace @photo-tools/filex-dev-console run typecheck
npm --workspace @photo-tools/filex-desktop run dev:image-converter
```

Non eseguire comandi di release, packaging o deploy salvo richiesta esplicita dell'utente.

## Contratti da rispettare

- I tipi IPC condivisi vanno importati da `@photo-tools/desktop-contracts`; non duplicarli localmente.
- Il catalogo dei tool desktop è `apps/filex-desktop/src/tool-manifest.ts`.
- Le porte e gli script di sviluppo sono quelli dichiarati nei `package.json` e, per la Dev Console, in `apps/filex-dev-console/server/tools.ts`.
- Le policy Git sono in `docs/GIT_WORKFLOW.md`. Non usare comandi distruttivi né modificare branch quando l'albero di lavoro è sporco.

## Release

Una release riguarda soltanto il componente richiesto. Prima di pubblicare o creare installer, verifica la procedura e gli script realmente presenti nel relativo `package.json` e in `.github/workflows/`. Non assumere feed, tag o workflow per singolo tool se non esistono nel repository.

Per ogni release di Suite o tool, verifica sul manufatto installato la policy `licenseRuntime` dichiarata nel manifest: senza licenza i tool soggetti a FileX All Access devono essere bloccati, con licenza attiva devono avviarsi e i tool `standalone` devono rispettare la policy esplicitamente documentata per quel prodotto. La licenza automatica di sviluppo non è una prova valida. Includi inoltre un test disinstallazione/reinstallazione: la disinstallazione non deve mai essere impedita dallo stato licenza e non deve lasciare bypass o stato incoerente. L'eventuale liberazione automatica dello slot dispositivo è un requisito separato da verificare, non da presumere.

## File generati e copie importate

- Non modificare `node_modules`, output di build o `apps/filex-dev-console/.runtime/`.
- La cartella `mnt/` è una copia importata di dati esterni e non fa parte del workspace operativo; non usarla come fonte di verità.
