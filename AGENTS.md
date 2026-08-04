# FileX release instructions

## "Pubblica e builda" contract

Quando l'utente chiede di pubblicare, buildare per pubblicazione o creare una release, la consegna non si limita al push del codice. Deve sempre includere:

1. sincronizzazione di `main` e branch/PR secondo `docs/GIT_WORKFLOW.md`;
2. scelta della nuova versione e allineamento tra tag Git, `apps/filex-desktop/package.json` e `package-lock.json`;
3. aggiornamento di documentazione, `CHANGELOG.md`, runbook e sito download in `docs/`;
4. test, typecheck e build dei componenti modificati;
5. build degli installer Windows di FileX Suite e di ogni tool modificato;
6. pubblicazione degli installer, blockmap, `latest.yml` e manifest `stable.json`/`beta.json` nella stessa GitHub Release;
7. merge su `main`, tag `vX.Y.Z` e monitoraggio dei workflow Windows Release e GitHub Pages;
8. verifica remota degli asset, del sito download e delle versioni proposte da FileX Suite tramite il manifest pubblico.

Una release non e' completata finche' il manifest remoto non contiene la nuova versione dei tool modificati e i relativi URL/checksum non risultano validi.

