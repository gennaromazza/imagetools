# Contratto operativo: pubblica e builda

Questa procedura definisce cosa significa **pubblicare e buildare FileX**. Va applicata a ogni richiesta di release, senza considerare sufficiente il solo push del codice.

## Risultato obbligatorio

Al termine devono essere disponibili:

- codice integrato in `main` tramite il workflow Git documentato;
- tag Git namespaced coerente con la versione del componente (`suite-vX.Y.Z` o `<tool-id>-vX.Y.Z`);
- changelog e documentazione aggiornati;
- sito Firebase Hosting in `website/` aggiornato;
- installer del solo componente pubblicato;
- blockmap e, soltanto per una release Suite, `latest.yml` nel feed Suite dedicato;
- soltanto per una release tool, aggiornamento della sua voce in `stable.json` o `beta.json`;
- verifica che FileX Suite mostri `Aggiorna` per ogni tool con versione installata inferiore.

## Sequenza standard

1. Sincronizzare `main` con `git pull --ff-only origin main` e creare un branch release.
2. Individuare il componente interessato e scegliere la sua nuova versione semantica.
3. Allineare il relativo `package.json`, il lockfile e il tag namespaced.
4. Aggiornare `CHANGELOG.md`, documentazione tecnica e checklist in `docs/`, oltre alla pagina download in `website/`.
5. Eseguire test, typecheck e build locali in proporzione alle modifiche.
6. Verificare che `.github/workflows/windows-release.yml` supporti il componente senza costruire Suite o tool estranei.
7. Aprire e integrare la PR verso `main`.
8. Creare e pushare il tag del componente; il workflow genera soltanto il suo installer e aggiorna il feed pertinente.
9. Attendere il completamento del workflow `FileX Windows Release` e, se `website/` e' cambiato, pubblicare il target Firebase `filex-website` con `npm run deploy:website`.
10. Scaricare e validare il manifest remoto e controllare asset, alias download e sito pubblico su `https://filex-suite.web.app`.

## Verifica updater

Il controllo finale usa:

`https://github.com/gennaromazza/imagetools/releases/download/update-catalog-stable/stable.json`

Per ogni tool modificato il manifest deve avere:

- `version` uguale alla versione appena pubblicata;
- `installerUrl` riferito al tag appena creato;
- `installerSha256` di 64 caratteri esadecimali;
- installer effettivamente scaricabile.

FileX Suite confronta questa versione con quella installata. Se la versione remota e' superiore, nella scheda del tool deve comparire `Aggiorna` dopo il refresh.

