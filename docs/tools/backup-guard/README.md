# FileX Backup Guard

Stato: specifica di prodotto iniziale approvata; implementazione non ancora avviata.

FileX Backup Guard mantiene un archivio fotografico principale e un clone fisico coerenti, verificati e comprensibili. L'archivio principale e' sempre la fonte di verita'. Il clone riceve aggiunte, modifiche e cancellazioni dal principale; puo' inoltre riportare nel principale soltanto contenuti nuovi creati durante il lavoro fuori studio.

## Decisioni approvate

| Tema | Decisione |
|---|---|
| Nome | FileX Backup Guard |
| Tool ID | `backup-guard` |
| Fonte di verita' | Una radice master locale registrata e non modificabile dal tool |
| Clone | Volume fisico associato e identificato in modo persistente |
| Direzione ordinaria | Master verso clone, cancellazioni comprese |
| Eccezione | Elementi realmente nuovi sul clone possono essere importati nel master |
| Cancellazioni dal clone | Non si propagano al master; il master ripristina il clone |
| Conflitti | Nessuna sovrascrittura automatica; entrambe le versioni sono preservate |
| Cronologia | Permanente, ricercabile, esportabile e accessibile dall'app |
| Lightroom | Cataloghi trattati come pacchetti coerenti e copiati solo a Lightroom chiuso |
| Integrazione | Contratto condiviso con Archivio Flow, senza accesso diretto ai database |
| Piattaforma iniziale | Windows, installazione indipendente gestita da FileX Suite |

## Principio di prodotto

> Il clone deve rappresentare fedelmente il master. Backup Guard non modifica mai il master per adeguarlo al clone; puo' soltanto aggiungervi contenuti esterni nuovi, verificati e senza collisioni.

L'assenza di un elemento dal master e' una cancellazione da propagare al clone soltanto quando lo storico dimostra che quell'elemento era presente nella precedente baseline valida. Se la baseline non esiste o il master non e' leggibile, ogni eliminazione viene bloccata.

## Documenti

- [Requisiti di prodotto e regole di sincronizzazione](01-product-requirements.md)
- [Sicurezza, affidabilita' e modello delle cancellazioni](02-safety-and-reliability.md)
- [Architettura e persistenza](03-architecture-and-data.md)
- [Integrazione con Archivio Flow e FileX Suite](04-suite-and-archivio-flow-integration.md)
- [Protezione dei cataloghi Lightroom](05-lightroom-protection.md)
- [Brand identity e specifica degli asset](06-brand-identity.md)
- [UX, wireframe e linguaggio](07-ux-wireframes.md)
- [Test, prestazioni e roadmap](08-validation-performance-roadmap.md)

## Confini della prima versione

La versione 1 gestisce una coppia master-clone, scansione incrementale, piano differenze, trasferimenti verificati, cancellazioni master verso clone, importazione dei soli nuovi elementi dal clone, conflitti, journal, cronologia e cataloghi Lightroom. Non offre cloud backup, RAID, versionamento completo, deduplicazione globale o fusione automatica di cataloghi Lightroom.

