# FileX ID Photo

## Stato del progetto

**Versione 0.1.1 pronta per la distribuzione stabile con FileX Suite 0.1.61 o successiva. La versione include il flusso completo di importazione, preparazione, esportazione e stampa nativa.**

Questo dossier definisce come progettare, integrare, validare e pubblicare il prossimo tool FileX dedicato alle fototessere per documenti. Il prodotto è rivolto esclusivamente a fotografi professionisti, studi e negozi; non è progettato come servizio consumer o web.

I valori tecnici fissati dall'implementazione sono:

| Campo | Valore |
|---|---|
| Nome prodotto | FileX ID Photo |
| Tool ID | `id-photo` |
| Workspace npm | `@photo-tools/id-photo` |
| Porta di sviluppo | `4225` |
| Eseguibile Windows | `FileX-ID-Photo` |
| Policy licenza | `shared-runtime` |
| Suite minima per la prima release | `0.1.61` |

Il renderer è in `apps/id-photo`; catalogo, script e metadati di distribuzione sono registrati nella shell FileX e nella Dev Console.

## Perimetro implementato

- flusso UI Commessa → Prepara → Verifica → Impagina → Esporta;
- tutorial operativo sempre raggiungibile da ogni schermata, con capitolo contestuale per ciascuno dei cinque step e indicazioni dedicate al passaggio Photoshop;
- importazione desktop di una singola foto, da cartella, tramite drag & drop e fallback browser;
- apertura diretta da Archivio Flow con una singola foto selezionata dalla scheda, tramite handoff locale consume-once e senza duplicare i byte nel manifest;
- profili versionati CIE 35×45, passaporto italiano 35×45 con fonte MAECI e formato generico 35×45 dichiarato come preset studio;
- crop guidato, zoom, posizione e rotazione senza modifica dell'originale;
- controlli tecnici locali su risoluzione, luminosità, contrasto, nitidezza e uniformità dello sfondo;
- passaggio Photoshop su copia atomica gestita da FileX, rilevamento della modifica, snapshot reali ripristinabili e rientro sullo stesso file o tramite “Salva con nome” flattenato;
- comando separato per eliminare copie e revisioni Photoshop mantenendo commessa, originali e output;
- output scritto senza sovrascrivere file esistenti, registrato subito come verifica in attesa e promosso a pronto solo dopo SHA-256; alla riapertura e durante la sessione il retry usa gli stessi file, senza riesportazioni o suffissi;
- impaginazione condivisa con Batch Print Layout su 10×15 e 15×20;
- export della foto singola in JPG e del foglio PDF o JPG con dimensioni fisiche/DPI e indicatori di taglio opzionali;
- apertura del pannello di stampa nativo Windows/macOS con fogli renderizzati alla risoluzione del profilo selezionato;
- integrazione Suite, licenza, Dev Console, CI, pipeline di release, icona, pagina marketing e guida pubblica.

Resta fuori dal prodotto la calibrazione automatica delle stampanti. Il pannello nativo è disponibile; l'operatore deve verificare nel driver scala 100% e adattamento pagina disattivato.

## Promessa di prodotto

> Dalla foto del cliente al foglio pronto per la stampa, con controlli locali, workflow non distruttivo e un passaggio Photoshop opzionale.

FileX ID Photo deve ridurre i passaggi ripetitivi del banco stampa senza togliere controllo al fotografo:

- mantiene immutato l'originale;
- lavora per commesse e per versione della foto;
- applica regole documentali versionate e con fonte verificabile;
- usa elaborazioni locali, senza upload delle fotografie né crediti per singola foto;
- consente il ritocco manuale in Photoshop su una copia di lavoro;
- genera fogli 10×15 e 15×20 in PDF o JPG, da verificare fisicamente prima della release;
- dichiara con chiarezza ciò che verifica e ciò che resta responsabilità dell'operatore e dell'ente emittente.

## Decisioni approvate

| Tema | Decisione |
|---|---|
| Pubblico | Fotografi professionisti, studi e negozi |
| Piattaforma iniziale | Desktop FileX su Windows |
| Modello commerciale | Entitlement FileX All Access tramite runtime condiviso, da verificare sull'installer |
| Flusso | Commessa → foto → preparazione → verifica → impaginazione → export/consegna |
| Originale | Mai sovrascritto dal tool |
| Photoshop | Passaggio manuale assistito su copia di lavoro; nessuna Azione automatica nella prima versione |
| Profilo documento | Catalogo versionato con fonte primaria, data di verifica e policy di modifica |
| Output | Foto singola JPG, foglio JPG/PDF e apertura del pannello di stampa nativo |
| Conformità | Nessuna promessa di accettazione garantita da parte di un ente |

## Obiettivo della prima versione commerciale

La prima versione deve permettere a un operatore esperto di creare, verificare, impaginare ed esportare una fototessera per i profili italiani prioritari, con:

1. apertura di una commessa locale e importazione di una foto, da cartella, con drag & drop oppure invio diretto da Archivio Flow;
2. selezione della foto e crop guidato;
3. profili CIE Italia e passaporto Italia 35×45 mm con fonti ufficiali registrate, più un preset studio generico chiaramente distinto;
4. preparazione locale e ritorno da Photoshop;
5. scelta del numero copie e del foglio 10×15 o 15×20;
6. export tracciabile della foto singola JPG e del foglio PDF/JPG, con specifica di qualità verificata e impronta SHA-256 persistita per ogni file; un output mancante, sostituito o modificato revoca lo stato pronto, mentre un errore temporaneo o un timeout conserva il record, sospende lo stato pronto e attiva un retry senza letture sovrapposte;
7. conservazione o eliminazione esplicita delle copie gestite della commessa, senza cancellazioni automatiche silenziose.
8. guida integrata persistente, consultabile senza abbandonare la commessa e senza cambiare lo step di lavoro corrente;
9. apertura del pannello di stampa Windows/macOS con fogli alle dimensioni fisiche richieste e verifica manuale delle opzioni del driver.

Il tool non rimuove né sostituisce automaticamente lo sfondo. Gli interventi restano manuali e devono rispettare la policy mostrata dal profilo documento.

## Principi non negoziabili

1. Nessun file originale viene modificato, spostato o cancellato.
2. Nessuna fotografia viene inviata a servizi remoti dal flusso di elaborazione.
3. Il tool non identifica persone e non applica modifiche automatiche al soggetto.
4. Ogni regola documentale espone fonte, versione, data di revisione e limiti.
5. Un avviso tecnico non equivale a certificazione dell'accettazione del documento.
6. Una misura dichiarata in millimetri deve essere provata su carta e stampante reali prima della release.
7. L'operatore può eliminare la commessa e le copie gestite solo dopo conferma; la prima release non applica una cancellazione automatica basata sull'età o sul numero delle commesse.

## Confini della prima versione

Sono fuori ambito finché non approvati e verificati:

- riconoscimento o identificazione univoca delle persone;
- invio cloud delle immagini o account cliente;
- generazione di visi, ricostruzione di porzioni mancanti o beauty retouch automatico;
- esecuzione automatica di Azioni Photoshop;
- gestione colore ICC completa e soft proof certificato;
- stampa silenziosa senza pannello di sistema e calibrazione automatica;
- supporto dichiarato a Paesi o documenti senza fonte ufficiale registrata;
- certificazione o garanzia di accettazione da parte di Questure, Comuni, consolati o altri enti.

## Indice

- [Requisiti di prodotto](01-product-requirements.md)
- [Profili documento e integrità dell'immagine](02-document-profiles-and-image-integrity.md)
- [Flusso Photoshop](03-photoshop-workflow.md)
- [Architettura, persistenza e sicurezza](04-architecture-persistence-and-security.md)
- [Integrazione FileX Suite, editor e stampa](05-filex-suite-print-and-editor-integration.md)
- [Brand identity e UI](06-brand-identity-and-ui.md)
- [Stampa, calibrazione e operazioni](07-print-calibration-output-and-operations.md)
- [Validazione, release e roadmap](08-validation-release-and-roadmap.md)

## Fonti di verità del repository

Al momento dell'implementazione, i valori tecnici devono essere letti da:

- **apps/filex-desktop/src/tool-manifest.ts** per catalogo, Tool ID, URL di sviluppo, packaging e policy licenza;
- **packages/desktop-contracts/src/index.ts** per contratti IPC e tipi condivisi;
- **apps/filex-desktop/package.json** per script Electron di build, sviluppo e distribuzione;
- **apps/filex-dev-console/server/tools.ts** e **server/index.ts** per avvio e test dalla Dev Console;
- **.github/workflows/windows-release.yml** per componenti pubblicabili e pipeline di release;
- **docs/18-publish-build-contract.md** per i gate di pubblicazione;
- **apps/batch-print-layout** per la capacità riusabile di impaginazione fisica e i suoi limiti effettivi.

Il runbook **docs/22-new-tool-creation-runbook.md** resta una checklist utile, ma la release indipendente effettiva deve seguire workflow, manifest e script presenti nel repository.
