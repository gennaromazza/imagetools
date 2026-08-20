# packages — librerie condivise

## Inventario reale

I package condivisi sono:

- `@photo-tools/core`
- `@photo-tools/desktop-contracts`
- `@photo-tools/filesystem`
- `@photo-tools/layout-engine`
- `@photo-tools/presets`
- `@photo-tools/shared-types`
- `@photo-tools/ui-schema`

Verifica sempre il campo `name` e gli script nel `package.json` del package prima di modificarlo o invocarlo.

## Disciplina di verifica

- Non dedurre API esportate, dipendenze o compatibilità dai nomi dei package: controlla `package.json` e gli export effettivi.
- Per un contratto condiviso, cerca prima i consumer con `rg` e modifica soltanto quelli realmente interessati.
- Se non è chiaro se un cambiamento è compatibile o richiede un bump di versione, chiedi all'utente prima di procedere.
- Leggi il minimo indispensabile: indice pubblico, file interessato e consumer trovati; evita scansioni complete del monorepo.

## Regole

- `packages/desktop-contracts/src/index.ts` è la fonte unica dei tipi e delle API condivise tra renderer ed Electron. Le modifiche qui richiedono la verifica dei consumer interessati.
- Mantieni le dipendenze già dichiarate: non presumere che ogni package dipenda da `shared-types` o che sia pubblicabile su npm.
- Non cambiare versioni, contratti pubblici o esportazioni senza una richiesta esplicita.

## Verifica

Esegui i soli script esistenti nel package interessato, dalla radice:

```powershell
npm --workspace @photo-tools/desktop-contracts run typecheck
npm --workspace @photo-tools/desktop-contracts run build
```

Se uno script non è dichiarato, non sostituirlo con un comando ipotetico: usa la verifica più vicina disponibile a livello di repository.
