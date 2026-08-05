# Architettura e stack

## Direzione proposta

Look Builder deve riusare il desktop FileX esistente, ma possedere un dominio e una pipeline colore indipendenti. L'UI resta React/TypeScript; decoder RAW e trasformazioni native vivono in un sidecar isolato. Questa e' una proposta architetturale, non ancora una decisione irreversibile.

## Contesto attuale riutilizzabile

Il repository dispone gia' di:

- Electron, React, TypeScript e Vite;
- Sharp/libvips per immagini bitmap;
- estrazione JPEG incorporato da RAW, compreso RAF, nel Photo Selector;
- integrazione ExifTool e Adobe DNG Converter in altri tool;
- store SQLite, eventi strutturati e boot log nel desktop;
- manifest centralizzato dei tool FileX;
- packaging e release Windows della suite.

L'estrattore attuale di Photo Selector e' utile per thumbnail veloci, ma non sostituisce un decode RAW lineare per analisi colore.

## Moduli proposti

```text
apps/filex-desktop
  launcher, finestre, IPC, lifecycle, crash containment

apps/look-builder
  React UI, workflow, inspector, confronto A/B

packages/look-builder-domain
  progetti, decisioni, ricette, use case; TypeScript puro

packages/look-builder-ingest
  contratti e adapter JPEG/RAW/metadati

packages/look-builder-color
  statistiche, base tonale, fitting e applicazione look

packages/look-builder-profile
  modello XMP, serializer, ZIP e validazione Lightroom

packages/look-builder-audit
  eventi, metriche, redazione dati e bundle diagnostico

native/look-builder-worker
  LibRaw, LittleCMS, OpenColorIO; processo separato
```

I nomi delle cartelle sono proposti e richiedono approvazione nello spike architetturale. I confini, invece, sono requisiti: UI, dominio, IO, calcolo colore, formato Adobe e audit non devono fondersi.

## Flusso delle dipendenze

```text
UI -> application use cases -> domain
                         |-> ingest ports -> adapters/sidecar
                         |-> color ports  -> deterministic engine
                         |-> export port  -> XMP/ZIP adapter
                         `-> audit port   -> local event store
```

Il dominio non importa Electron, filesystem, Sharp, LibRaw o Adobe. Gli adapter implementano porte versionate. Ogni stage accetta input immutabile e restituisce risultato, metriche e warning senza scrivere implicitamente su disco.

## Stack raccomandato

### Interfaccia e orchestrazione

- React + TypeScript + Vite, coerenti con le altre app FileX;
- Electron come host Windows;
- Zod o schema equivalente gia' approvato nel repository per validare IPC e file progetto;
- worker thread per calcolo TypeScript CPU-bound;
- SQLite/event store esistente per indice progetti e audit.

### Imaging

- Sharp/libvips per JPEG, resize, thumbnail e istogrammi semplici;
- LibRaw compilato nel percorso CDDL per RAW e RAF;
- LittleCMS per ICC;
- OpenColorIO per LUT, transform graph e validazione indipendente;
- ExifTool per metadati quando il parser interno non e' sufficiente;
- OpenCV solo se un caso misurato lo richiede;
- ONNX Runtime soltanto in una fase ML separata.

### Sidecar nativo

Un eseguibile separato e' preferito a un addon Node nativo per:

- isolare crash e file corrotti;
- mantenere l'ABI indipendente dalla versione Electron;
- rendere riproducibili versioni e capability;
- applicare timeout, memory limit e cancellazione;
- testare la pipeline senza avviare l'UI.

Protocollo proposto: JSON Lines versionato su stdin/stdout, payload pixel via file temporanei privati o shared memory solo dopo misurazione. Nessun path viene interpolato in una shell. Il sidecar espone comandi piccoli (`probe`, `decode`, `transform`, `validate-lut`) e un handshake con versioni, licenze e capability.

La scelta C++ diretto contro wrapper Rust/C++ e' un gate aperto. La raccomandazione iniziale e' C++/CMake per ridurre gli strati tra LibRaw, LittleCMS e OpenColorIO; prima dello scaffold vanno confrontati sicurezza, manutenzione e competenze del team.

## Modello progetto

Un progetto e' una ricetta riproducibile e non un contenitore fotografico:

```text
LookProject
  schemaVersion
  projectId
  displayName
  sourceLinks[]       # path locale + fingerprint, non bytes
  ingestFacts[]
  decisions[]         # A/B e conferme esplicite
  baseRecipe
  lookRecipe
  validationSummary
  algorithmVersions
  exportHistory[]
```

I path assoluti non devono finire nei bundle di supporto. Il fingerprint usa dimensione, metadati stabili e hash selettivo/completo secondo il livello di verifica.

## Formato Adobe come adapter

Il core produce un `LookRecipe` neutro. L'adapter Adobe decide come rappresentarlo in XMP. In questo modo:

- si puo' sostituire il serializer senza cambiare l'algoritmo;
- test colore e test di compatibilita' restano separati;
- un futuro exporter `.cube` o altro formato non contamina il dominio;
- l'uso o meno di Adobe SDK rimane una decisione locale all'adapter.

Prima di adottare il DNG SDK o il Profiles SDK occorrono review legale, SBOM e test di distribuzione. La strategia preferita e' usare il minimo codice necessario, conservare tutti i notice e non distribuire documentazione o sample asset Adobe non necessari.

## Sicurezza e privacy

- originali aperti in sola lettura;
- directory temporanea per-run, permessi locali e cleanup verificato;
- limite esplicito di file, pixel, dimensione e tempo di decode;
- parser XML senza entita' esterne;
- creazione ZIP con path normalizzati e senza traversal;
- nessun upload implicito;
- preview nel bundle diagnostico soltanto con opt-in;
- hash e log privi di nomi cliente per impostazione predefinita;
- sidecar con allowlist di operazioni, non una shell generica.

## Versionamento

Versionare separatamente:

- applicazione;
- schema progetto;
- pipeline RAW;
- algoritmo della base;
- modello/algoritmo del look;
- schema ricetta;
- esportatore XMP;
- protocollo sidecar;
- matrice Lightroom verificata.

Una migrazione progetto non modifica silenziosamente il look: conserva la ricetta precedente, mostra la differenza e richiede conferma per rigenerare.

## Policy dipendenze

Ogni dipendenza entra soltanto con:

1. bisogno misurato;
2. licenza e transitive registrate;
3. versione fissata e checksum;
4. source/binary notice generato;
5. scansione vulnerabilita';
6. owner e piano aggiornamento;
7. test di riproducibilita' del risultato.

“Gratis” e' una condizione necessaria indicata dal prodotto, non una valutazione legale sufficiente.

