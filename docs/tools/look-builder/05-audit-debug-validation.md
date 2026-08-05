# Audit, debug e validazione

L'audit non e' un log testuale aggiunto alla fine. E' un output strutturato di ogni stage e deve permettere di rispondere a tre domande:

1. quale dato e' entrato e come e' stato interpretato;
2. quale decisione automatica o umana ha modificato la ricetta;
3. perche' il file esportato ha superato o fallito la validazione.

## Eventi strutturati

Ogni run possiede `runId`, timestamp monotono, versione app, sistema, algoritmi e seed. Evento minimo:

```json
{
  "schemaVersion": 1,
  "runId": "...",
  "stage": "raw.decode",
  "event": "completed",
  "inputFingerprint": "...",
  "durationMs": 0,
  "facts": {},
  "metrics": {},
  "warnings": [],
  "algorithm": { "id": "...", "version": "..." }
}
```

Gli eventi sono append-only. La UI deriva lo stato visibile dagli stessi risultati usati dal motore, evitando un secondo sistema diagnostico divergente.

## Livelli di diagnostica

### Sempre attivo

- stage, durata, stato e codice errore;
- versioni e capability;
- fingerprint non reversibile dell'input;
- metadati tecnici minimizzati;
- decisioni A/B e parametri finali;
- metriche colore aggregate;
- esito dei validatori XMP/ZIP.

### Modalita' debug locale

- istogrammi numerici per stage;
- curve campionate;
- statistiche della LUT;
- confronto CPU/renderer;
- snapshot dei contratti intermedi senza pixel originali;
- tracing IPC e sidecar.

### Opt-in sensibile

- thumbnail ridotte;
- crop problematici;
- path originali;
- dump di proxy pixel.

Questi dati non entrano mai automaticamente nel bundle da inviare all'assistenza.

## Inspector per l'utente tecnico

Il progetto deve offrire un pannello Audit con:

- **Input**: formato, camera, ICC, assunzioni e decoder;
- **Pipeline**: grafo degli stage, tempi, cache e versioni;
- **Tono**: istogrammi prima/dopo, percentili, curva e clipping;
- **Colore**: gamut, neutri, pelle, palette e trasformazioni;
- **Look**: decomposizione della ricetta e origine delle preferenze;
- **LUT QA**: dimensione, discontinuita', inversioni e identity distance;
- **Export**: proprieta' XMP, file ZIP, checksum e matrice Lightroom;
- **Log**: eventi filtrabili e copiabili con redazione automatica.

Ogni avviso deve includere codice stabile, severita', spiegazione e azione suggerita. Esempio: `JPEG_UNTAGGED_ASSUMED_SRGB`, non una generica stringa “profilo mancante”.

## Bundle diagnostico

Contenuto predefinito:

```text
filex-look-builder-diagnostic.zip
  manifest.json
  events.jsonl
  metrics.json
  recipe.json
  dependency-versions.json
  system-summary.json
  export-validation.json
```

Il bundle esclude originali, thumbnail, nomi file, path, EXIF GPS e dati cliente. Prima della creazione mostra un riepilogo esatto; l'utente puo' aggiungere volontariamente preview ridotte.

## Strategia di test

### Unit test

- curve monotone e invertibilita' dove prevista;
- percentili robusti e classificatori di scena;
- conversioni di coordinate colore;
- blending `identity -> look`;
- serializzazione canonica e migrazioni ricetta;
- redazione dei dati sensibili.

### Property-based test

- nessun NaN/Infinity su immagini valide;
- input identita' produce output identita';
- livelli LUT validi rimangono nel dominio dichiarato;
- intensita' zero non modifica l'immagine;
- luminanza ordinata non viene invertita oltre la tolleranza;
- output deterministico con stesso seed e versione;
- parser e ZIP non accettano path traversal.

### Golden test sintetici

Il repository di test puo' contenere soltanto asset creati internamente o con licenza esplicita:

- gradienti RGB e neutral ramp;
- step wedge;
- Hald/identity LUT;
- patch ColorChecker sintetiche con valori documentati;
- immagini di gamut boundary;
- pattern di banding, clipping e compressione;
- piccoli RAW concessi esplicitamente per test.

Le immagini dei clienti non diventano fixture.

### Integration test

- RAW -> canonical image;
- JPEG ICC -> canonical image;
- recipe -> LUT -> preview;
- recipe -> XMP -> parse round-trip;
- XMP -> ZIP -> import corpus;
- crash/timeout sidecar -> recovery UI;
- riapertura progetto con versione precedente.

### Test Lightroom

Poiche' Lightroom e' il consumer reale, una suite interna non basta. Ogni release dell'esportatore deve essere verificata almeno su:

- Lightroom Classic Windows nelle versioni supportate;
- Lightroom desktop Windows;
- RAW Adobe standard, Fuji RAF e JPEG sRGB/Adobe RGB;
- installazione pulita e aggiornamento di un look esistente;
- profilo mancante, duplicato e rinominato;
- Soft/Standard/Strong e Auto Base;
- re-export da Lightroom per confronto strutturale.

L'automazione UI di Lightroom non e' data per scontata. Finche' non esiste un harness affidabile, il risultato e' una checklist firmata con screenshot, hash dei file e versione esatta.

## Metriche

Metriche tecniche, non giudizi estetici:

- CIEDE2000 su patch note e neutral axis;
- deviazione di neutralita';
- clipping totale e per canale;
- percentuale out-of-gamut;
- errore tra LUT e trasformazione di riferimento;
- massima discontinuita' tra celle adiacenti;
- errore 33^3 rispetto a 65^3;
- differenza tra applicazione CPU e OpenColorIO;
- stabilita' del look tra scene e fotocamere;
- tempi e memoria per stage.

La CIEDE2000 non misura la bellezza di un look. L'approvazione estetica deriva dai confronti dell'utente e da una review fotografica sulla matrice di casi.

## Failure injection

Il sistema di debug deve provare:

- RAW troncato o non supportato;
- JPEG con ICC malformato;
- metadati enormi o corrotti;
- sidecar che si chiude a meta' decode;
- disco pieno durante l'export;
- destinazione non scrivibile;
- ZIP esistente;
- progetto interrotto durante migrazione;
- algoritmo nuovo che cambia una golden image;
- dipendenza nativa mancante o con versione errata.

## Comandi futuri

All'implementazione devono corrispondere comandi ripetibili, sul modello dell'audit Photo Selector:

```text
npm run audit:look-builder
npm run test:look-builder:color
npm run test:look-builder:export
npm run licenses:look-builder
```

Questi nomi sono parte della specifica proposta e saranno aggiunti soltanto con lo scaffold.

## Regola di regressione

Ogni modifica dell'algoritmo produce un report differenziale su tutte le golden e sui casi fotografici autorizzati. Le differenze sopra soglia richiedono:

- motivazione;
- immagini prima/dopo;
- metriche;
- versione nuova dell'algoritmo;
- approvazione esplicita.

Nessuna “miglioria AI” puo' cambiare silenziosamente un look gia' esportato.

