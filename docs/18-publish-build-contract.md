# Contratto operativo: pubblica e builda

Questa procedura definisce cosa significa **pubblicare e buildare FileX**. Va applicata a ogni richiesta di release, senza considerare sufficiente il solo push del codice.

## Risultato obbligatorio

Al termine devono essere disponibili:

- codice integrato in `main` tramite il workflow Git documentato;
- tag Git coerente con la versione degli installer;
- changelog e documentazione aggiornati;
- sito GitHub Pages aggiornato;
- installer FileX Suite e installer dei tool modificati;
- blockmap e `latest.yml` per l'auto-update della Suite;
- `stable.json` o `beta.json` con versione, URL e SHA-256 dei tool;
- verifica che FileX Suite mostri `Aggiorna` per ogni tool con versione installata inferiore.

## Sequenza standard

1. Sincronizzare `main` con `git pull --ff-only origin main` e creare un branch release.
2. Individuare i tool interessati e scegliere la nuova versione semantica.
3. Allineare versione del package desktop, lockfile e tag `vX.Y.Z`.
4. Aggiornare `CHANGELOG.md`, documentazione tecnica, checklist e pagina download.
5. Eseguire test, typecheck e build locali in proporzione alle modifiche.
6. Aggiornare `.github/workflows/windows-release.yml` se un tool modificato non e' incluso negli artefatti.
7. Aprire e integrare la PR verso `main`.
8. Creare e pushare il tag stabile; il workflow `FileX Windows Release` genera installer, manifest e GitHub Release.
9. Attendere il completamento dei workflow `FileX Windows Release` e `Publish FileX Suite page`.
10. Scaricare e validare il manifest remoto e controllare asset, alias download e sito pubblico.

## Verifica updater

Il controllo finale usa:

`https://github.com/gennaromazza/imagetools/releases/latest/download/stable.json`

Per ogni tool modificato il manifest deve avere:

- `version` uguale alla versione appena pubblicata;
- `installerUrl` riferito al tag appena creato;
- `installerSha256` di 64 caratteri esadecimali;
- installer effettivamente scaricabile.

FileX Suite confronta questa versione con quella installata. Se la versione remota e' superiore, nella scheda del tool deve comparire `Aggiorna` dopo il refresh.

