# Integrazione FileX Suite, editor e stampa

## Integrazione nella Suite

Il Tool ID `id-photo` è registrato nei punti effettivi del monorepo:

1. estensione di **DesktopToolId** in **packages/desktop-contracts/src/index.ts**;
2. descrittore completo in **apps/filex-desktop/src/tool-manifest.ts**;
3. script di build, sviluppo e distribuzione in **apps/filex-desktop/package.json**;
4. workspace reale in **apps/id-photo/package.json**;
5. asset e metadati di Suite nei file che oggi mantengono liste esplicite;
6. release workflow, validazione artefatto e catalogo;
7. test e categoria proprietaria nella FileX Dev Console;
8. pagina marketing, icona, indice strumenti, guida e sitemap, con stato “in arrivo” finché non viene pubblicato.

Il manifest resta l'unica fonte del catalogo desktop. La Dev Console ricava automaticamente i tool del manifest in **server/tools.ts**; non va introdotto un secondo catalogo manuale.

## Ingresso diretto da Archivio Flow

Dalla griglia della scheda SD, Archivio Flow può aprire FileX ID Photo con esattamente una foto. Il passaggio usa il contratto condiviso `DesktopPhotoToolHandoff`: il manifest contiene soltanto percorsi e metadati, resta nell'area privata FileX per un massimo di dieci minuti ed è reclamato atomicamente una sola volta dal tool destinatario.

Prima dell'avvio la shell verifica che la foto sia un file reale sotto la radice della scheda, rifiuta duplicati, symlink o junction e registra dimensione e data di modifica. Al consumo ripete le verifiche e rifiuta una sorgente cambiata. ID Photo salva la commessa corrente, apre una nuova commessa con la foto ricevuta e avverte l'operatore di non rimuovere la scheda fino alla conclusione o alla creazione della copia Photoshop.

Lo stesso canale serve Party Frame e Batch Print Layout con selezioni da 1 a 500 foto. Le immagini non vengono incorporate nel manifest, caricate in cloud o copiate automaticamente: i tool continuano a leggere le sorgenti selezionate finché il supporto rimane collegato.

## Licenza

La policy configurata è **shared-runtime**, coerente con il piano FileX All Access. Non basta dichiararla nel manifest:

- senza licenza attiva, la Suite deve bloccare l'avvio;
- con licenza attiva o in grace, il tool deve aprirsi;
- l'uninstaller deve restare disponibile anche senza licenza o rete;
- la verifica avviene sull'installer reale e non sulla licenza automatica di sviluppo.

La configurazione è implementata; la prova senza/con licenza sull'installer reale resta un gate obbligatorio della prima release.

## Capacità riusabili di Batch Print Layout

Batch Print Layout è il riferimento operativo per il foglio fotografico. Il suo dominio contiene:

- preset foglio 10×15, 13×18, 15×20, 20×30, A4, A3, Letter e personalizzato;
- margini e spaziature espressi in millimetri;
- crop, zoom e rotazione;
- calcolo griglia e centratura dell'ultima pagina incompleta;
- anteprima a DPI inferiore rispetto all'export;
- guide di taglio;
- export JPG, PNG, PDF e TIFF;
- guardie contro canvas oltre 32.767 px di lato o oltre 512 MiB RGBA.

FileX ID Photo riusa oggi `@photo-tools/batch-print-layout/print-engine` e `@photo-tools/batch-print-layout/render-export` tramite gli export pubblici del workspace, senza duplicare il motore. I test dei due prodotti devono continuare a proteggere questo contratto condiviso.

## Limiti di Batch Print Layout da non ereditare senza verifica

- non conserva commesse o clienti;
- l'export richiede preview ad alta risoluzione e non è un pass-through garantito dell'originale;
- il PDF ha dimensioni fisiche in centimetri e il JPG riceve un patch DPI JFIF, ma PNG e TIFF non impostano oggi metadati DPI verificati;
- non espone un'API di stampa nativa riutilizzabile da ID Photo; il bridge dedicato risiede nella shell desktop FileX;
- il suo pulsante con icona stampante è un preset, non una stampa reale.

Il contratto di output di FileX ID Photo deve definire, provare e documentare contenuto, pixel, metadati e risultato stampato per ciascun formato dichiarato.

## Bridge Photoshop

Il contratto desktop esistente espone funzionalità che FileX ID Photo può riusare:

- scelta dell'eseguibile editor;
- rilevamento candidati installati;
- apertura o invio di file a un editor;
- scelta del file risultante;
- stat di file per dimensione e data modifica;
- lettura preview nativa.

FileX ID Photo implementa il concetto di copia di lavoro. Il flusso attuale:

1. crea atomicamente una copia byte per byte sotto `<Home>/FileX-ID-Photo-Data/id-photo/working/job-<id>/` su Windows, fuori dalle cartelle note normalmente reindirizzate da OneDrive (e sotto `<userData>/id-photo-data/` sugli altri sistemi);
2. avvia Photoshop solo sulla copia gestita;
3. rileva con polling dimensione e data di modifica;
4. consente il rientro sullo stesso file oppure la selezione esplicita di un “Salva con nome” flattenato;
5. rilegge e decodifica l'immagine, quindi azzera crop, controlli e approvazioni precedenti;
6. archivia uno snapshot distinto e permette di ripristinarlo in una nuova copia modificabile;
7. registra la revisione Photoshop nella commessa senza eliminare automaticamente gli snapshot precedenti;
8. offre sia la pulizia delle sole copie/revisioni Photoshop mantenendo la commessa, sia la cancellazione completa della commessa; entrambe richiedono conferma e non toccano originali o output.

Le Azioni Photoshop automatiche non rientrano nella prima versione.

## Pannello di stampa nativo

Il contratto desktop espone `printIdPhotoPages`. Il renderer prepara ogni foglio alla risoluzione del profilo, il main process costruisce un documento con dimensioni fisiche e apre il dialogo visibile del sistema tramite Electron con stampa non silenziosa. Il risultato distingue lavoro consegnato al driver, annullamento ed errore.

La funzione non seleziona automaticamente stampante, carta o compensazioni e non considera la consegna al driver come prova di stampa completata. L'operatore controlla formato, scala 100% e assenza di adattamento pagina. La calibrazione automatica per combinazioni stampante/carta resta separata e richiederà prove fisiche dedicate.

## Liste e file espliciti aggiornati

L'integrazione corrente comprende:

- **apps/filex-desktop/scripts/build-suite-launcher.mjs**;
- **apps/filex-desktop/scripts/sync-branding.mjs**;
- **apps/filex-desktop/suite-launcher-src/app.js**;
- **apps/filex-desktop/suite-launcher-src/dock-window.js**;
- generatori e validator dei manifest di release;
- test di release, catalogo e licenze;
- **.github/workflows/windows-release.yml**;
- la lista **COMPONENT_RELEASES** e mapping dei test in **apps/filex-dev-console/server/index.ts**;
- script test nella root del monorepo;
- **website/strumenti/index.html**, pagina dedicata, sitemap e asset.

Il test di indipendenza release verifica le liste principali. Il manifest alimenta la Dev Console, mentre release, branding, validator e sito mantengono anche punti espliciti.

## Release indipendente

Il workflow reale riconosce `id-photo-vX.Y.Z`, costruisce il solo installer FileX ID Photo e aggiorna la sola voce catalogo. La versione 0.1.0 è stata pubblicata; le funzioni successive richiedono una nuova versione del componente e `minLauncherVersion` 0.1.61, oltre allo smoke test del main process impacchettato. La procedura deve seguire:

- **.github/workflows/windows-release.yml**;
- **docs/18-publish-build-contract.md**;
- manifest e package effettivi.

Non va introdotto un tag Suite fittizio per pubblicare il tool: la Suite 0.1.61 deve seguire il proprio ciclo e la release ID Photo il flusso indipendente verificato.
