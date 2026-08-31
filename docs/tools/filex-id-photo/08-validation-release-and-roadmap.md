# Validazione, release e roadmap

## Regola di qualità

Una funzione non è pronta perché appare in anteprima. È pronta solo quando le sue promesse sono provate nel percorso desktop, sull'output reale e, dove necessario, sul materiale fisico.

## Matrice di test

| Area | Casi minimi |
|---|---|
| Commesse | creazione, riapertura, file mancanti, rinomina, annullamento, limite registro, errore quota, avviso persistente di modifiche non salvate, dialogo nativo resta/chiudi comunque, salvataggio alla chiusura e pulizia esplicita delle sole copie gestite |
| Originali e revisioni | nessuna modifica sorgente, working copy, rollback, reimport Photoshop, Salva con nome |
| Profili | versione, fonte, misure mm, ratio volto, linee occhi, policy modifica, scadenza profilo |
| Crop e geometria | portrait, landscape, EXIF, zoom, rotazione, numero copie, 10×15 e 15×20 |
| Rendering | limite memoria, import fino al cap con thumbnail lazy e una sola preview di dettaglio revocabile, ultima pagina, guide taglio, PDF e JPG secondo il contratto della prima release |
| Output persistito | staging progressivo con journal scritto prima dei link, pubblicazione hard-link atomica no-overwrite di ogni file, collisione race-safe, errore sicuro sui filesystem incompatibili, acknowledgement soltanto dopo persistenza sincrona del pending, cleanup best-effort successivo, rollback/recovery verificati per identità che preservano i nomi sostituiti da terzi e rifiuto symlink; size e SHA-256 calcolati sui byte preparati prima della pubblicazione e associati ai nomi finali; retry dei medesimi percorsi senza nuova esportazione; promozione a `lastExport` soltanto se percorso, size, identità filesystem e SHA coincidono; riapertura e verifica periodica; invalidazione per file mancante, sostituito, modificato o contesto variato; timeout e retry single-flight per reader temporaneamente indisponibile |
| Photoshop | editor assente, copia atomica gestita, collisioni, polling, rientro sullo stesso file, Salva con nome flattenato e file non decodificabile |
| Privacy | nessuna chiamata rete per foto, cancellazione delle copie gestite e log senza immagine |
| Stampa | misura fisica degli export PDF/JPG al 100%; selezione driver, annullamento e stampa diretta sono esclusi dalla prima release |
| Electron | preload, IPC, percorso non autorizzato, build, ASAR, main process impacchettato |
| Licenza | senza entitlement, con entitlement, disinstallazione e reinstallazione |

Ogni test creato deve avere:

- script root con prefisso test;
- categoria proprietaria nella FileX Dev Console;
- descrizione concreta in **apps/filex-dev-console/server/index.ts**;
- esecuzione del test e typecheck della Dev Console nello stesso intervento.

## Dataset di prova

Il dataset non può contenere fotografie di clienti senza titolo d'uso e retention esplicita. Deve essere versionato o riproducibile, con casi sintetici o autorizzati per:

- qualità della foto;
- geometria e crop;
- Photoshop;
- output e stampa.

## Gate della prima release

Prima di creare tag o pubblicare:

1. nomenclatura, Tool ID, package, manifest e branding sono coerenti;
2. tutti i profili inclusi hanno fonti ufficiali verificate;
3. output e misure fisiche sono provati su stampanti e carte dichiarate;
4. Photoshop lavora solo sulla copia di lavoro;
5. installer, sito e documentazione descrivono soltanto le funzioni realmente disponibili e confermano che la stampa diretta è assente dalla prima release;
6. test dominio, renderer, bridge e Dev Console sono superati;
7. build Electron, packaging reale, chiusura import runtime di main e preload e smoke hidden delle API IPC fingerprint/transazione sono superati; test, dichiarazioni e source map non devono entrare nell'ASAR;
8. policy shared-runtime è verificata senza e con licenza attiva sull'installer;
9. disinstallazione e reinstallazione non lasciano bypass o stati incoerenti;
10. changelog, documentazione, pagina web e guida pubblica descrivono solo funzioni provate.

La licenza automatica di sviluppo non vale come prova della release.

## Milestone

### Stato al 31 agosto 2026

| Milestone | Stato reale |
|---|---|
| M0 | dossier, nome, Tool ID e perimetro completati |
| M1 | workspace, profili, commesse, crop e copie di lavoro non distruttive implementati e coperti da test locali |
| M2 | impaginazione 10×15/15×20 ed export PDF/JPG implementati; prova fisica su carta ancora necessaria prima della release |
| M3 | working copy gestita, apertura su Photoshop 2026, polling, snapshot, rollback, ricarica e “Salva con nome” implementati; collaudo desktop locale superato, prova sul futuro installer ancora necessaria |
| M4 | stampa nativa e calibrazione automatica escluse dalla prima release |
| M5 | Suite, Dev Console, CI, pipeline, sito e guida integrati; packaging/release, verifica licenza e ciclo installazione non ancora eseguiti |

### M0 — Decisioni e dossier

Approvare nome, Tool ID, scope primo mercato, profili iniziali, output e matrice stampanti. Completare questo dossier, asset brief e piano pagina marketing.

### M1 — Fondazioni non distruttive

Creare workspace, manifest, contratti, commessa locale, import, versioni di lavoro, profili versione uno e crop guidato. Gate: nessun originale alterato.

### M2 — Motore documento e impaginazione

Estrarre o riusare in modo testato la geometria di stampa, produrre 10×15 e 15×20, creare PDF e output raster verificati. Gate: quantità e misure corrette su foglio reale.

### M3 — Photoshop professionale

Configurazione editor, working copy, polling, reimport e gestione errori. Gate: save in-place e Salva con nome funzionano senza perdere la commessa.

### M4 — Stampa nativa e calibrazione

Implementare bridge solo dopo definizione delle stampanti target; aggiungere pagina calibrazione, profili e prove driver. Gate: misura fisica conforme alle tolleranze approvate.

### M5 — Suite, sito e release

Completare catalogo, licenza, updater, installer, sito e guida. Gate: la Suite installata gestisce correttamente il tool e il sito dichiara solo capacità reali.

## Deliverable sito e marketing

Alla prima funzionalità verificata devono essere aggiornati:

- pagina prodotto in **website/strumenti/<tool-id>/index.html**;
- indice strumenti in **website/strumenti/index.html**;
- icona in **website/assets/icons/**;
- guida professionale in **website/guide/<slug>/index.html**;
- indice guide e sitemap pertinenti;
- eventuale homepage e metadata SEO.

La pagina deve valorizzare workflow locale, controllo professionale, Photoshop opzionale e riduzione dei passaggi, senza promettere conformità garantita o stampa diretta non ancora verificata.

## Release indipendente

Il componente è registrato nelle liste reali di **.github/workflows/windows-release.yml**, validation e packaging. Il futuro tag `id-photo-vX.Y.Z` pubblicherà il solo componente secondo la pipeline indipendente e richiederà FileX Suite 0.1.61 o successiva; non si deve simulare una release Suite per rendere visibile il nuovo prodotto.

La procedura completa segue **docs/18-publish-build-contract.md**: changelog, commit, push, tag, installer, feed, sito, licenza e verifica del manufatto installato.

## Fuori ambito senza una nuova decisione

- nuovi Paesi o documenti;
- Azioni Photoshop automatiche;
- riconoscimento biometrico;
- cloud backup o sincronizzazione immagini;
- stampa diretta o silenziosa;
- supporto ICC completo;
- app mobile o workflow consumer;
- pubblicazione o release effettiva.
