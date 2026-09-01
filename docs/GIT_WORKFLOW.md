# Git Workflow Policy (FileX Suite)

Questa policy evita conflitti tra `main` e `master` e definisce un flusso unico.

## Regole Base

- Branch operativo unico: `main`.
- Non lavorare su `master` in locale.
- Non fare merge manuali da `master` a `main`.
- Prima di iniziare, sincronizzare sempre `main` in fast-forward.

## Flusso Giornaliero

1. Vai su `main`:
   - `git switch main`
2. Aggiorna senza merge impliciti:
   - `git pull --ff-only origin main`
3. Lavora sul branch gia' concordato. Un agente automatico non crea branch o worktree di propria iniziativa.
4. Se l'utente o il flusso di lavoro richiede una PR, crea un branch dedicato da `main`, usa commit piccoli e chiari e apri la PR verso `main`.
5. Al termine verifica che il checkout sia pulito, che non siano rimaste operazioni Git sospese e che gli eventuali worktree temporanei siano stati chiusi in sicurezza.

## Pubblicazione dalla FileX Dev Console

Quando le modifiche sono state completate e verificate, la pubblicazione ordinaria della Suite avviene dalla sezione **Release FileX Suite** della Dev Console. Il pulsante **Verifica e pubblica** calcola la prossima patch, esegue i controlli locali, include le modifiche presenti nel commit di release, effettua push e tag e attende la verifica di GitHub Actions e dei feed.

La Console accetta la pubblicazione solo dal branch `main`. Prima del click controlla con attenzione l'elenco delle modifiche: il workflow le include tutte nel commit di release.

## Comandi Sicuri Consigliati

- Verifica stato:
  - `git status -sb`
- Verifica branch corrente:
  - `git branch --show-current`
- Verifica allineamento con remoto:
  - `git fetch --all --prune`
  - `git rev-list --left-right --count origin/main...main`

## Cose Da Evitare

- `git pull` senza `--ff-only`
- Merge di branch con storie non correlate
- Uso quotidiano di `master`
- Creazione automatica di branch o worktree non richiesti
- Rimozione di branch non integrati o worktree sporchi
- Regole locali in `.git/info/exclude` al posto del `.gitignore` versionato

## Ciclo di vita di branch e worktree

- Il repository principale resta il checkout operativo predefinito.
- Un worktree temporaneo deve essere collegato a un task concreto e a un branch identificabile.
- Prima di rimuoverlo, controlla lo stato del worktree e preserva sempre il branch se contiene commit non integrati.
- Dopo integrazione e verifica, rimuovi il worktree e soltanto allora elimina l'eventuale branch locale gia' integrato.
- Le cartelle residue non registrate da Git sono rimovibili solo dopo avere verificato percorso, stato e assenza di commit unici.

## Chiusura obbligatoria del lavoro

1. Esegui i test minimi pertinenti.
2. Controlla `git diff --check` prima del commit.
3. Crea un commit coerente e pubblicalo quando richiesto dal task.
4. Su un commit pulito esegui `npm run check:git-hygiene`.
5. Se hai effettuato il push, attendi che GitHub Actions sia verde.
6. Verifica infine `git status -sb`, `git worktree list` e l'allineamento con `origin/main`.

Un task non e' concluso se restano modifiche inattese, worktree abbandonati, operazioni Git sospese o una pipeline rossa.

## Recovery Rapido

Se il repo sembra incoerente:

1. Ferma merge/rebase in corso.
2. Fai un backup branch:
   - `git branch backup/safety-YYYY-MM-DD`
3. Torna su `main` e riallinea:
   - `git switch main`
   - `git fetch --all --prune`
   - `git pull --ff-only origin main`

## AI Agent Instructions

Questa sezione e' pensata per agenti automatici (CLI/CI/Codex/Copilot-like).

### Invariants

- Primary branch: `main`
- Allowed daily sync command: `git pull --ff-only origin main`
- Do not use local `master` for development tasks
- Do not merge unrelated histories

### Deterministic Startup Checklist

1. `git rev-parse --is-inside-work-tree` must be `true`
2. `git branch --show-current` deve corrispondere al branch concordato; in assenza di indicazioni resta su `main`
3. `git fetch --all --prune`
4. `git rev-list --left-right --count origin/main...main`
5. If counts are not `0 0`, run `git pull --ff-only origin main`

### Conflict Prevention Rules

- If working tree is dirty, never change branch with force options.
- Never run destructive commands (`reset --hard`, forced checkout) unless explicitly requested by user.
- If legacy branches exist, preserve with `backup/*` naming before cleanup.
- Non creare branch o worktree senza richiesta esplicita; quando richiesti, derivali da `main` e integrali tramite PR.
