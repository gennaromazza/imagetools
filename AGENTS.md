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

## Igiene Git obbligatoria

- All'inizio di ogni intervento controlla `git status -sb`, il branch corrente, l'allineamento con `origin` e `git worktree list`. Non creare branch o worktree senza una richiesta esplicita dell'utente o una procedura di release verificata che li richieda.
- Un solo checkout operativo è la condizione normale. Ogni worktree temporaneo deve avere uno scopo dichiarato, rimanere fuori dal percorso principale e venire rimosso appena il lavoro è integrato. Prima della rimozione verifica sempre che sia pulito e che il branch sia preservato; non eliminare mai lavoro non integrato.
- Allegati, smoke test, cache e cartelle temporanee degli agenti devono essere coperti dal `.gitignore` versionato. Non usare `.git/info/exclude` come unica regola per file prodotti dal normale flusso di sviluppo.
- Non lasciare file inattesi non tracciati, merge/rebase/cherry-pick incompleti, worktree abbandonati o modifiche generate dai test. Se esiste lavoro precedente non attribuibile con certezza al task, preservalo e segnalalo invece di ripulirlo alla cieca.
- Prima di dichiarare concluso un intervento esegui il test pertinente, `npm run check:git-hygiene` su un commit pulito e verifica che il branch pubblicato sia allineato con il remoto. Se è stato effettuato un push, attendi l'esito della CI pertinente: stato Git sporco o CI rossa impediscono la chiusura del lavoro.
- Spegnimenti o riavvii richiesti dall'utente vanno eseguiti soltanto dopo avere salvato le modifiche, completato commit e push richiesti e concluso le verifiche remote.

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

## Test e Dev Console

Ogni nuovo test destinato allo sviluppo locale deve essere eseguibile dalla FileX Dev Console. Nello stesso intervento in cui viene creato o rinominato un test:

- aggiungi uno script `test:*` alla radice del monorepo che lo esegua senza comandi arbitrari ricevuti dal browser;
- assegna lo script alla categoria del prodotto in `apps/filex-dev-console/server/index.ts`;
- aggiungi una descrizione comprensibile che spieghi cosa cerca e quali rischi copre;
- verifica sia il test sia il typecheck di `@photo-tools/filex-dev-console`.

Un test presente soltanto nel `package.json` di un workspace e non raggiungibile dalla Dev Console è considerato incompleto. Mantieni le sezioni per prodotto espandibili e non accorpare test di tool diversi in una categoria generica quando il proprietario è noto.

## Release

Una release riguarda soltanto il componente richiesto. Prima di pubblicare o creare installer, verifica la procedura e gli script realmente presenti nel relativo `package.json` e in `.github/workflows/`. Non assumere feed, tag o workflow per singolo tool se non esistono nel repository.

Ogni richiesta di release, sia della Suite sia di un singolo tool della piattaforma, include obbligatoriamente questo flusso completo: aggiorna prima il changelog pertinente con le modifiche effettivamente rilasciate; crea quindi il commit della release, effettua il push del commit e dei tag richiesti dalla procedura verificata, quindi esegui il rilascio. Non considerare completata una release finché changelog, commit, push e pubblicazione non sono tutti conclusi con successo. Se lo stato Git sporco, le credenziali, i permessi o una procedura mancante impediscono uno di questi passaggi, fermati prima del rilascio e comunica con precisione il blocco; non omettere né simulare alcun passaggio.

Per ogni release `suite-vX.Y.Z`, il workflow `.github/workflows/website-suite-sync.yml` aggiorna la versione e il link stabile nella homepage e pubblica il sito su Firebase Hosting. La pipeline richiede la secret GitHub `FIREBASE_TOKEN`; se manca, la release deve essere considerata incompleta e va configurata prima della pubblicazione successiva. La verifica finale deve controllare sia il feed Suite sia la homepage pubblica `https://filex-suite.web.app/`.

Prima di ogni release Electron non basta il solo typecheck o `build:shell`: occorre costruire il pacchetto reale del componente, verificare che ogni import runtime compilato sia incluso nell'ASAR/output e avviare uno smoke test sul main process impacchettato. Quando si aggiunge o estrae un nuovo modulo importato dal main process, aggiornare nello stesso intervento la whitelist `files` di `electron-builder.config.mjs` e un test che controlli la chiusura transitiva delle dipendenze. Un errore `ERR_MODULE_NOT_FOUND` sul pacchetto installato deve bloccare tag, push e release.

Per modifiche al coordinamento degli aggiornamenti tool, lo smoke test deve partire da una versione realmente precedente installata, eseguire l'installer scaricato attraverso la Suite e verificare versione finale ed exit code. Un esito positivo di `ShellExecute`/`shell.openPath` non dimostra che l'installer sia partito: l'avvio deve essere osservabile e la Suite deve attendere la conclusione reale del processo.

Prima del ciclo locale disinstallazione/reinstallazione di ogni release Suite, eseguire `npm run release:prepare-filex-suite-clean-install`. Lo script puo' eliminare esclusivamente cache rigenerabili e i residui verificati della legacy 0.1.14; profilo, preferenze, licenza e build di sviluppo devono restare intatti. La pulizia e' richiamata anche dal preflight ufficiale `release-filex-suite.bat`.

Il ciclo completo di release Suite deve partire da `npm run release:prepare-filex-full-clean-test`: disinstalla Suite e tutti i tool, incluse installazioni legacy e registrazioni duplicate, ma preserva profili, progetti e stato licenza. La reinstallazione successiva deve verificare separatamente che (1) i tool gia' installati continuino a funzionare quando si rimuove soltanto la Suite e (2) la rimozione completa, richiesta esplicitamente, elimini tutti i binari senza dipendere dalla licenza.

Per ogni release di Suite o tool, verifica sul manufatto installato la policy `licenseRuntime` dichiarata nel manifest: senza licenza i tool soggetti a FileX All Access devono essere bloccati, con licenza attiva devono avviarsi e i tool `standalone` devono rispettare la policy esplicitamente documentata per quel prodotto. La licenza automatica di sviluppo non è una prova valida. Includi inoltre un test disinstallazione/reinstallazione: la disinstallazione non deve mai essere impedita dallo stato licenza e non deve lasciare bypass o stato incoerente. L'eventuale liberazione automatica dello slot dispositivo è un requisito separato da verificare, non da presumere.

## File generati e copie importate

- Non modificare `node_modules`, output di build o `apps/filex-dev-console/.runtime/`.
- La cartella `mnt/` è una copia importata di dati esterni e non fa parte del workspace operativo; non usarla come fonte di verità.

## Aggiornamenti del sito

- **Aggiornamento della Documentazione e Marketing**: Per ogni tool che subisce modifiche significative o integrazioni di nuove funzionalità, è obbligatorio aggiornare il sito ufficiale con una pagina dedicata contenente le specifiche tecniche. Ogni nuova implementazione deve essere concepita anche come elemento di *Page Marketing* per promuovere il software.
