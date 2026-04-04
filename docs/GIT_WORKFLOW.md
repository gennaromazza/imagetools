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
3. Crea un branch feature:
   - `git switch -c feat/nome-task`
4. Commit piccoli e chiari.
5. Push del branch feature e PR verso `main`.

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
- Commit diretti su `main` senza branch feature (salvo fix urgenti concordati)

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
2. `git branch --show-current` should be `main` before coding
3. `git fetch --all --prune`
4. `git rev-list --left-right --count origin/main...main`
5. If counts are not `0 0`, run `git pull --ff-only origin main`

### Conflict Prevention Rules

- If working tree is dirty, never change branch with force options.
- Never run destructive commands (`reset --hard`, forced checkout) unless explicitly requested by user.
- If legacy branches exist, preserve with `backup/*` naming before cleanup.
- Prefer feature branches from `main` and open PRs back to `main`.
