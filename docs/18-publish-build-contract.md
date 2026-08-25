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
- matrice licenze verificata sull'artefatto installato: blocco senza entitlement e avvio con entitlement attivo per ogni tool soggetto a licenza;
- disinstallazione e reinstallazione verificate senza bypass, perdita ingiustificata di dati o blocco della rimozione dovuto alla licenza.
- pacchetto Electron reale verificato per chiusura transitiva degli import e smoke test del main process senza `ERR_MODULE_NOT_FOUND`.

> **Nota per i nuovi tool:** Quando si aggiunge per la prima volta uno strumento all'ecosistema, assicurarsi di aver seguito preventivamente il **[Runbook Creazione e Rilascio (22-new-tool-creation-runbook.md)](./22-new-tool-creation-runbook.md)**. Se il tool non è registrato in `.github/workflows/windows-release.yml` o nel manifesto (`tool-manifest.ts`), non verrà rilasciato o non potrà essere avviato per problemi di licenza.

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
11. Installare il componente in un ambiente di prova con enforcement reale, verificare la sua policy licenze e completare almeno un ciclo disinstallazione/reinstallazione. Le build dev con licenza automatica non soddisfano questo gate.

## Gate Google Drive

Per ogni release di un tool che espone funzioni Drive:

- `IMAGE_SELECT_GOOGLE_CLIENT_ID` e `IMAGE_SELECT_GOOGLE_CLIENT_SECRET` devono essere presenti nei secret CI; il generatore blocca la release se una delle due credenziali manca;
- il client Google Cloud deve essere di tipo **Desktop app** e il consent screen deve essere pubblicato per utenti esterni;
- lo scope richiesto dal codice deve restare `drive.file`, salvo una decisione architetturale documentata e una nuova verifica Google;
- provare collegamento con un account nuovo, riavvio applicazione, sincronizzazione, funzionamento offline, riconnessione dopo revoca e scollegamento;
- verificare che lo stesso profilo del sistema operativo condivida l'account fra i tool FileX e che un profilo Windows/macOS diverso non erediti il token;
- controllare sul Drive dell'utente che vengano creati soltanto cartelle e manifest FileX, mai fotografie o percorsi assoluti locali.

## Gate licenze per componente

La policy da verificare è quella dichiarata da `licenseRuntime` nel manifest, non quella dedotta dal nome del prodotto:

- `shared-runtime`: senza licenza valida il tool non si apre; con stato `active` o `grace` si apre.
- `management`: la Suite resta accessibile per attivazione, disattivazione e aggiornamenti anche senza licenza.
- `standalone`: il comportamento commerciale deve essere documentato e testato nell'entry point del tool; non va automaticamente equiparato né a gratuito né a FileX All Access.

La disinstallazione deve riuscire anche offline e con licenza assente, scaduta o revocata. Se un prodotto deve liberare uno slot dispositivo durante la rimozione, l'operazione remota deve essere best-effort e non può bloccare l'uninstaller.

## Verifica updater

Il controllo finale usa:

`https://github.com/gennaromazza/imagetools/releases/download/update-catalog-stable/stable.json`

Per ogni tool modificato il manifest deve avere:

- `version` uguale alla versione appena pubblicata;
- `installerUrl` riferito al tag appena creato;
- `installerSha256` di 64 caratteri esadecimali;
- installer effettivamente scaricabile.

FileX Suite confronta questa versione con quella installata. Se la versione remota e' superiore, nella scheda del tool deve comparire `Aggiorna` dopo il refresh.

## Sincronizzazione automatica del sito dopo una release Suite

Ogni release con tag `suite-vX.Y.Z` attiva `.github/workflows/website-suite-sync.yml`. Il workflow esegue lo script `scripts/update-website-suite-download.mjs`, aggiorna la versione mostrata nella homepage, pubblica `website/` sul target Firebase Hosting `filex-website` e verifica che `https://filex-suite.web.app/` mostri la versione appena rilasciata e il link stabile `suite-channel-stable/FileX-Suite-stable-x64-setup.exe`.

La repository deve avere la secret Actions `FIREBASE_TOKEN`. Il valore non va mai committato né inserito nei log. Se la secret manca o il deploy/verifica fallisce, la sincronizzazione del sito non è completata e va ripetuta dopo aver corretto la configurazione.
