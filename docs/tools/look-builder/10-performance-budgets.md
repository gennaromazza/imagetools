# Budget prestazionali

## Stato

I budget definitivi sono un gate della Fase 0 e richiedono misure sul prototipo. Questo documento stabilisce cosa misurare, come misurarlo e quali soglie candidate portare all'approvazione. Le soglie candidate non sono ancora requisiti contrattuali.

## Principi

- misurare separatamente ingest, decode, analisi, rendering, fitting ed export;
- pubblicare mediana, p95 e caso peggiore, non soltanto la media;
- usare fixture fisse con hash e dimensioni note;
- distinguere cache fredda e cache calda;
- distinguere JPEG, RAW Bayer e RAF X-Trans;
- misurare con telemetria locale strutturata, senza inviare immagini;
- nessun miglioramento prestazionale puo' ridurre silenziosamente qualita' o precisione.

## Configurazioni Windows da approvare

### Minima

La Fase 0 deve fissare:

- versione Windows supportata;
- CPU, numero core e set di istruzioni minimo;
- RAM installata;
- GPU richiesta oppure non richiesta;
- spazio libero temporaneo;
- tipo disco supportato;
- display e gestione colore minima.

Obiettivo di prodotto: il motore deve poter funzionare senza GPU dedicata. Un eventuale percorso GPU e' un'accelerazione verificata, non un requisito implicito.

### Raccomandata

Deve rappresentare una workstation fotografica realistica, non hardware laboratorio. La scheda di benchmark registra modello CPU, RAM, GPU/driver, SSD, build Windows, profilo energetico e monitor.

## Corpus benchmark

| Classe | Fixture proposta | Scopo |
|---|---|---|
| JPEG-S | 12-24 MP, sRGB | Interazione comune e preview |
| JPEG-L | 40-60 MP, Adobe RGB/P3 | Memoria e color management |
| RAW-B | RAW Bayer 24-33 MP | Decode RAW comune |
| RAW-H | RAW Bayer 45-60 MP | Caso professionale pesante |
| RAF-X | RAF X-Trans 26/40 MP | Percorso Fuji |
| MIX-P | Progetto misto al limite approvato | Picco memoria e rigenerazione |
| LUT-33 | Gradienti e immagini con LUT 33^3 | Preview/export standard candidato |
| LUT-65 | Stessi input con LUT 65^3 | Confronto qualita'/costo |

I file reali devono avere licenza interna esplicita; gli asset sintetici devono essere generati in modo riproducibile.

## Soglie candidate per la Fase 0

| ID | Misura | Definizione | Ipotesi iniziale da validare |
|---|---|---|---|
| PERF-01 | Primo contatto | Tempo da import a thumbnail visibile, cache fredda | JPEG p95 <= 1 s; RAW embedded preview p95 <= 2 s |
| PERF-02 | Preview analitica RAW | Decode + canonical transform + preview 1:1 utile | RAW comune p95 <= 5 s sulla macchina minima |
| PERF-03 | Aggiornamento interattivo | Modifica intensita' o scelta A/B su proxy gia' pronto | p95 <= 250 ms |
| PERF-04 | Cambio foto | Visualizzazione proxy gia' in cache | p95 <= 150 ms |
| PERF-05 | Rigenerazione look | Fitting dopo una decisione, escluso decode | p95 <= 2 s sul progetto nominale |
| PERF-06 | Export | Recipe approvata -> XMP validati -> ZIP atomico | p95 <= 5 s |
| PERF-07 | RAM singolo RAW | Incremento resident set durante RAW-H | Picco <= 2 GB, da correlare alla dimensione sensore |
| PERF-08 | RAM progetto | Picco MIX-P senza conservare tutti i full-res in memoria | <= 50% RAM disponibile e nessuna paginazione sostenuta |
| PERF-09 | Dimensione progetto | Metadati, ricette e audit senza proxy sensibili | <= 25 MB per progetto nominale |
| PERF-10 | Cache/proxy | Spazio massimo configurabile e liberabile | Limite utente + default da decidere dopo misure |

Le soglie sopra sono proposte di lavoro. Diventano obbligatorie soltanto dopo approvazione esplicita del report Fase 0.

## Limiti di scala da decidere

La specifica di prodotto impedisce il batch, ma l'app necessita di limiti tecnici:

| Limite | Ipotesi di ricerca | Decisione Fase 0 |
|---|---:|---|
| Reference consigliate | 8-20 | Da misurare e validare UX |
| Reference massime | 30 | Da approvare |
| Foto di prova consigliate | 3-10 | Da validare UX |
| Foto di prova massime | 12 | Da approvare |
| Pixel massimi per input | Nessuna soglia ancora | Definire da sicurezza e memoria |
| Dimensione massima file | Nessuna soglia ancora | Definire da decoder e timeout |
| Progetti recenti indicizzati | Nessuna soglia ancora | Definire da SQLite/UI |

Il superamento di un limite deve produrre un messaggio preventivo. Il tool non deve accettare un carico enorme e degradare senza spiegazione.

## Protocollo di benchmark

1. chiudere applicazioni non necessarie e fissare profilo energetico;
2. registrare tutte le versioni hardware/software;
3. eseguire almeno una warm-up non conteggiata;
4. eseguire almeno 10 run per fixture, oppure motivare un numero inferiore;
5. raccogliere mediana, p95, massimo, RAM peak e bytes temporanei;
6. ripetere cache fredda e calda;
7. confrontare output e metriche colore per escludere scorciatoie qualitative;
8. allegare eventi audit e report machine-readable;
9. proporre soglie finali minima/raccomandata all'utente;
10. registrare l'approvazione come decisione ADR.

## Comportamento sotto pressione

- decodificare un numero limitato di full-res contemporaneamente;
- usare proxy color-managed per interazione e full-res per validazioni mirate;
- cancellare job non piu' necessari;
- applicare backpressure al sidecar;
- avvisare prima di superare il budget cache;
- fallire in modo controllato su memoria insufficiente;
- scrivere l'export in un file temporaneo validato e rinominarlo atomicamente;
- non ridurre automaticamente griglia LUT o precisione senza evidenza nell'Audit.

## Report di approvazione Fase 0

Il report deve includere:

- configurazioni minima e raccomandata proposte;
- risultati per ogni `PERF-*`;
- grafici o tabelle p50/p95/max;
- confronto RAF/Bayer/JPEG e 33^3/65^3;
- picchi RAM e disco;
- regressioni qualitative osservate;
- soglie finali proposte;
- eccezioni note;
- decisione approvata o richiesta di ottimizzazione.

