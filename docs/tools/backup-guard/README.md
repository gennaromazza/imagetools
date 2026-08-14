# FileX Backup Guard

Stato: prima versione operativa locale implementata; validazione su archivi reali multi-terabyte ancora necessaria prima della pubblicazione.

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

## Stato dell'implementazione

Sono disponibili:

- associazione persistente master-clone con verifica dell'identita' del volume;
- scansione incrementale basata su metadata e baseline;
- piano immutabile ricalcolato prima dell'esecuzione;
- copia master-clone e importazione dei nuovi file dal clone;
- SHA-256 su origine e staging prima dell'attivazione, con una sola lettura della sorgente;
- sostituzione con rollback della vecchia copia;
- cancellazioni master-clone spostate nel cestino FileX;
- conferma esplicita delle cancellazioni e controllo preventivo dello spazio libero;
- journal persistente, recupero dopo interruzione, cronologia ricercabile ed esportabile;
- progresso con byte, MB/s, ETA, pausa e annullamento sicuro;
- verifica profonda byte-per-byte su richiesta;
- cestino grafico con recupero separato nel master;
- risoluzione grafica dei conflitti senza sovrascritture silenziose;
- rilevamento dei lock Lightroom e snapshot del pacchetto prima delle scelte di conflitto;
- coda persistente dei nuovi lavori provenienti da Archivio Flow;
- integrazione con FileX Suite, branding e build indipendente.

Restano gate obbligatori prima della prima release: benchmark multi-terabyte, prove fisiche di disconnessione e power-loss e verifica su piu' filesystem Windows. I flussi software equivalenti sono coperti dalla suite automatica locale.

## Confini della prima versione

La versione 1 gestisce una coppia master-clone, scansione incrementale, piano differenze, trasferimenti verificati, cancellazioni master verso clone, importazione dei soli nuovi elementi dal clone, conflitti, journal, cronologia e cataloghi Lightroom. Non offre cloud backup, RAID, versionamento completo, deduplicazione globale o fusione automatica di cataloghi Lightroom.

