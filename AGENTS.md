# FileX release instructions

## "Pubblica e builda" contract

Quando l'utente chiede di pubblicare, buildare per pubblicazione o creare una release, la consegna non si limita al push del codice. Deve sempre includere:

1. sincronizzazione di `main` e branch/PR secondo `docs/GIT_WORKFLOW.md`;
2. scelta della nuova versione del solo componente interessato e allineamento tra tag namespaced (`suite-vX.Y.Z` o `<tool-id>-vX.Y.Z`), relativo `package.json` e `package-lock.json`;
3. aggiornamento di documentazione, `CHANGELOG.md`, runbook in `docs/` e sito download in `website/`;
4. test, typecheck e build dei componenti modificati;
5. build dell'installer Windows del solo componente pubblicato; una release tool non deve costruire FileX Suite e una release Suite non deve costruire tool;
6. pubblicazione degli installer e blockmap nella GitHub Release del componente; `latest.yml` va pubblicato solo per la Suite, mentre `stable.json`/`beta.json` va aggiornato solo per una release tool;
7. merge su `main`, tag namespaced del componente, monitoraggio dei workflow Windows Release pertinenti e deploy del sito su Firebase Hosting quando `website/` cambia;
8. verifica remota degli asset, del feed Suite dedicato, del sito download e delle versioni proposte da FileX Suite tramite il catalogo pubblico dedicato.

Una release non e' completata finche' il feed remoto del componente non contiene la nuova versione e i relativi URL/checksum non risultano validi. Gli altri componenti devono rimanere invariati.

