# filex-dev-console — dashboard locale di sviluppo

Workspace: `@photo-tools/filex-dev-console`. È una dashboard Express locale su `127.0.0.1`, porta predefinita `4390` (variabile `FILEX_CONSOLE_PORT`), pensata per avviare, fermare e osservare i tool prima della release.

## Architettura

- `server/index.ts`: API HTTP, contenuti statici e operazioni su licenze e test.
- `server/tools.ts`: elenco autorevole dei tool avviabili, workspace, script, porta e tipo (`web` o `electron`).
- `server/processes.ts`: avvio, rilevamento, log e arresto dei processi Windows.
- `public/index.html`: interfaccia della dashboard.

Ogni tool mostrato nella dashboard deve avere un workspace esistente e uno script `dev` realmente dichiarato nel relativo `package.json`. Quando si aggiunge un tool, aggiorna `server/tools.ts` e verifica che la sua porta corrisponda allo script avviato.

## Disciplina di verifica

- Non aggiungere tool dalla memoria o da documentazione storica: verifica directory, `package.json`, script e porta reali.
- Non riportare un avvio come riuscito soltanto perché il processo è stato creato; verifica il processo o la porta prevista e consulta il log in caso di errore.
- Mantieni l'allowlist in `server/tools.ts`; se serve un comando, una porta o una modalità non presenti, chiedi prima all'utente invece di esporre esecuzione arbitraria.
- Per indagare un problema, leggi prima il log e il singolo script interessato; evita di avviare più tool o test non collegati.

## Sicurezza operativa

- Le API sono volutamente locali: non cambiare host da `127.0.0.1` né esporre CORS in rete senza una richiesta esplicita.
- I comandi devono restare basati su una allowlist (`DEV_TOOLS`); non accettare comandi shell arbitrari dal browser.
- I log runtime in `.runtime/` sono temporanei e non vanno versionati.

## Verifica

```powershell
npm --workspace @photo-tools/filex-dev-console run typecheck
npm run dev:console
```

Verifica manualmente `http://127.0.0.1:4390`, l'avvio di almeno un tool web e uno Electron e l'arresto selettivo. Non usare “Ferma tutti” durante una verifica se esistono processi di sviluppo avviati dall'utente.
