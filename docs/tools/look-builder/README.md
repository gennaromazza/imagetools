# FileX Look Builder

Stato: specifica di prodotto e fattibilita', nessuna implementazione approvata.

FileX Look Builder e' un laboratorio locale per costruire un'identita' colore riutilizzabile in Adobe Lightroom. Analizza un numero limitato di file RAW e JPEG, guida il fotografo tra proposte e confronti A/B, mostra anteprime e genera soltanto un pacchetto ZIP di profili/preset XMP. Non sviluppa un intero servizio fotografico e non sostituisce Lightroom.

## Decisioni approvate

| Tema | Decisione |
|---|---|
| Nome prodotto | FileX Look Builder |
| Formati in ingresso | RAW e JPEG |
| Elaborazione | Solo reference e immagini di prova; nessun batch di produzione |
| Output | Un pacchetto ZIP importabile in Lightroom contenente i preset/profili approvati |
| Esecuzione | Locale, parte della suite FileX, Windows iniziale |
| Licenze | Solo componenti gratuiti e compatibili con un prodotto commerciale closed-source |
| Stato corrente | Documentazione e ricerca; niente scaffold applicativo |

## Posizione nella suite

Look Builder e' indipendente dal flusso quotidiano:

1. Archivio Flow recupera e organizza i lavori.
2. Photo Selector effettua selezione e revisione.
3. Lightroom sviluppa le fotografie con il look gia' creato.
4. Software esterni gestiscono impaginazione e proofing.

Look Builder viene aperto solo quando il fotografo vuole creare, aggiornare o validare il proprio look. Non deve essere incorporato in Photo Selector.

## Documenti

- [Requisiti e percorso UX](01-product-requirements.md)
- [Ricerca e fattibilita'](02-research-and-feasibility.md)
- [Pipeline colore](03-color-pipeline.md)
- [Architettura e stack](04-architecture-and-stack.md)
- [Audit, debug e validazione](05-audit-debug-validation.md)
- [Matrice dei casi fotografici](06-photographic-test-matrix.md)
- [Roadmap e decisioni aperte](07-roadmap-and-decision-log.md)
- [Glossario centrale](08-glossary.md)
- [Tracciabilita' requisiti e test](09-requirements-traceability.md)
- [Budget prestazionali](10-performance-budgets.md)
- [Wireframe e stati UI](11-ui-wireframes.md)

## Principio di prodotto

Il risultato professionale non e' una LUT ricavata ciecamente da una sola immagine. Il tool separa:

- interpretazione tecnica del file e normalizzazione della base;
- caratteristiche creative del look;
- preferenze espresse dal fotografo;
- limiti del supporto di destinazione Lightroom;
- validazione su scene diverse.

Il tool deve dichiarare quando una reference e' insufficiente, incoerente, gia' distruttivamente compressa o fuori dal dominio delle immagini di prova. Ogni risultato deve essere riproducibile e spiegabile tramite un audit locale.
