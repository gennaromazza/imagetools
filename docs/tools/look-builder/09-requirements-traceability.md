# Tracciabilita' requisiti e test

Questa matrice collega requisiti, verifiche, casi fotografici ed exit criterion. Gli ID `REQ-*` diventano stabili dalla prima implementazione; eventuali sostituzioni devono lasciare una voce di migrazione nel decision log.

Legenda exit criterion:

- **F0**: necessario per chiudere lo spike di fattibilita';
- **F1**: necessario per chiudere il vertical slice;
- **MVP**: necessario per il primo rilascio;
- **Post-MVP**: previsto ma non bloccante per il primo rilascio.

## Prodotto e sicurezza dei file

| ID | Requisito | Verifica principale | Caso | Exit |
|---|---|---|---|---|
| REQ-PROD-001 | Il tool non elabora interi servizi fotografici | E2E su limiti progetto e assenza batch export | GEN-05 | MVP |
| REQ-PROD-002 | L'output finale contiene soltanto preset/profili destinati a Lightroom | Integration test del contenuto ZIP | LRC-01 | F0 |
| REQ-PROD-003 | Gli originali non vengono mai modificati | Test permessi, hash prima/dopo e failure injection | ING-09 | F1 |
| REQ-PROD-004 | L'elaborazione delle immagini e' locale | Network-denial E2E e audit delle richieste | ING-01 | MVP |
| REQ-PROD-005 | Il progetto e' riapribile e riproducibile | Golden project e confronto hash ricetta/export | GEN-07 | F1 |
| REQ-PROD-006 | Nessuna fotografia entra nel bundle diagnostico per default | Unit test redazione + inspection ZIP | ING-09 | F1 |

## Ingest e gestione colore

| ID | Requisito | Verifica principale | Caso | Exit |
|---|---|---|---|---|
| REQ-ING-001 | RAW e JPEG confluiscono nel contratto canonical image | Integration test adapter | ING-01, ING-03, ING-05 | F1 |
| REQ-ING-002 | RAF X-Trans supportato e tracciato | Decode test + verifica provenance | ING-01, ING-02 | F1 |
| REQ-ING-003 | Preview incorporata e decode RAW sono distinti | Test metadati renderer + review UI | ING-01 | F1 |
| REQ-ING-004 | ICC JPEG incorporato viene rispettato | Golden color-managed | ING-05, ING-06 | F1 |
| REQ-ING-005 | JPEG non taggato assume sRGB con avviso | Unit/integration warning code | ING-07 | F1 |
| REQ-ING-006 | File corrotto non arresta la UI | Failure injection del sidecar | ING-09 | F1 |
| REQ-ING-007 | Input non supportato non produce colori silenziosamente errati | Capability test e stato bloccante | ING-02 | MVP |

## Base tecnica e look

| ID | Requisito | Verifica principale | Caso | Exit |
|---|---|---|---|---|
| REQ-COL-001 | La base non forza l'istogramma sugli estremi | Golden e review fotografica | TON-01, TON-02, TON-03 | MVP |
| REQ-COL-002 | Curve tonali senza inversioni indesiderate | Property test monotonicita' | TON-05, COL-06 | F1 |
| REQ-COL-003 | Informazione JPEG clippata non viene dichiarata recuperata | Warning test e review copy | ING-08 | MVP |
| REQ-COL-004 | Il look e' separato dall'input transform | Test dipendenze e recipe snapshot | GEN-01 | F1 |
| REQ-COL-005 | Soft/Standard/Strong derivano dalla stessa recipe | Unit test identity blending | LRC-04 | MVP |
| REQ-COL-006 | Pelle e neutri hanno protezioni misurabili | Metriche + review fotografica | PEO-01, COL-05 | MVP |
| REQ-COL-007 | Outlier e reference incoerenti vengono segnalati | Dataset controllato e test clustering | GEN-03 | MVP |
| REQ-COL-008 | La validazione include almeno un holdout | E2E workflow | GEN-05, GEN-06 | MVP |
| REQ-COL-009 | A parita' di input/versioni il risultato e' deterministico | Run ripetuti e confronto hash | GEN-07 | F1 |

## Lightroom ed export

| ID | Requisito | Verifica principale | Caso | Exit |
|---|---|---|---|---|
| REQ-EXP-001 | Il Creative Profile si applica a RAW supportati | Round-trip Lightroom | LRC-02 | F0 |
| REQ-EXP-002 | Il look si applica a JPEG supportati | Round-trip Lightroom | LRC-03 | F0 |
| REQ-EXP-003 | ZIP e XMP vengono validati prima della scrittura finale | Integration test e file corrotti | LRC-01 | F0 |
| REQ-EXP-004 | L'assenza del profilo non passa inosservata | Test installazione incompleta | LRC-06 | MVP |
| REQ-EXP-005 | Auto Base, se presente, e' adattivo tramite Lightroom | Round-trip su scene diverse | LRC-05 | MVP |
| REQ-EXP-006 | La procedura mobile e' dichiarata per versione | Checklist dispositivi/versioni | LRC-07 | Post-MVP |
| REQ-EXP-007 | Un export precedente rimane riproducibile | Golden XMP e versioni exporter | GEN-07 | MVP |

## Audit, UX e operabilita'

| ID | Requisito | Verifica principale | Caso | Exit |
|---|---|---|---|---|
| REQ-AUD-001 | Ogni stage produce eventi strutturati | Contract test degli eventi | ING-09 | F1 |
| REQ-AUD-002 | Ogni decisione A/B e' ricostruibile | E2E workflow + event replay | GEN-07 | MVP |
| REQ-AUD-003 | Warning con codice, severita' e azione | Unit test catalogo errori | ING-07, GEN-03 | F1 |
| REQ-AUD-004 | Audit distingue Base, Look e Base + Look | Review UI e snapshot stato | TON-08 | MVP |
| REQ-UX-001 | Il fotografo comprende la qualita' delle reference | Usability test moderato | GEN-03, GEN-04 | MVP |
| REQ-UX-002 | Il confronto A/B esplicita la caratteristica confrontata | Usability test + analytics locale | PEO-01, COL-01 | MVP |
| REQ-UX-003 | Errori tecnici non richiedono lettura del log | Usability/failure test | ING-09 | MVP |
| REQ-PERF-001 | Preview, memoria, progetto ed export rispettano i budget approvati | Benchmark su hardware di riferimento | Matrice trasversale | MVP |

## Controllo copertura

Prima di chiudere una fase:

1. ogni requisito previsto per la fase deve avere almeno un test eseguito;
2. ogni test deve produrre evidenza identificabile;
3. ogni caso obbligatorio deve essere coperto da una fixture autorizzata;
4. eccezioni e waiver devono avere owner, motivazione e scadenza;
5. il report deve elencare requisiti senza test e casi senza requisito;
6. un requisito bloccante fallito impedisce il passaggio di fase.

