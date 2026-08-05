# Roadmap e decisioni

## Regola di governance

Le scelte di prodotto approvate sono registrate qui. Le scelte che cambiano risultato, compatibilita', licenza, privacy o costi di manutenzione devono essere presentate all'utente prima dell'implementazione. Il team puo' decidere autonomamente dettagli interni reversibili coperti da test.

## Decisioni approvate

| ID | Decisione | Stato |
|---|---|---|
| DEC-001 | Nome `FileX Look Builder` | Approvata |
| DEC-002 | Supporto in ingresso RAW e JPEG | Approvata |
| DEC-003 | Nessun batch di produzione; solo reference e immagini di prova | Approvata |
| DEC-004 | Output finale limitato a ZIP di preset/profili Lightroom | Approvata |
| DEC-005 | Solo librerie gratuite compatibili con prodotto commerciale closed-source | Approvata |
| DEC-006 | Tool autonomo nella suite FileX, non incorporato in Photo Selector | Approvata dal contesto precedente |
| DEC-007 | Documentazione prima dello sviluppo | Approvata |
| DEC-008 | Audit e debug della logica colore come requisito di prima classe | Approvata |

## Decisioni da approvare prima dello scaffold

### ADR-001 — Sidecar nativo

Proposta: processo C++/CMake separato per LibRaw, LittleCMS e OpenColorIO, protocollo JSONL. Alternativa: Rust con FFI C/C++. La decisione incide su competenze, sicurezza, packaging e manutenzione.

### ADR-002 — Dipendenza Adobe

Proposta: prima creare uno spike di conformita' isolato; poi scegliere tra serializer interno/XMP Toolkit e uso mirato del DNG SDK. L'inclusione del DNG SDK in un binario commerciale richiede approvazione legale e notice.

### ADR-003 — Target Lightroom

Definire versioni minime e piattaforme: Classic Windows obbligatorio; desktop e mobile opzionali. Questa scelta determina schema XMP, struttura ZIP e matrice QA.

### ADR-004 — Griglia e spazio LUT

Scegliere encoding, spazio di lavoro e griglia dopo confronto misurato 33^3/65^3 e import Adobe. Non fissare il formato in base alla sola dimensione file.

### ADR-005 — Contenuto esatto dello ZIP

Verificare se Lightroom accetta in modo affidabile profilo e preset nello stesso ZIP e se tollera file estranei. Per default l'export deve includere solo XMP finche' il test non prova altro.

### ADR-006 — Base automatica

Confermare se il rilascio include sia `Look only` sia `Look + Auto Base` e se la base FileX rimane solo anteprima/normalizzazione interna. Raccomandazione: entrambe le varianti, nessun algoritmo FileX statico spacciato per adattivo dentro il preset.

### ADR-007 — Dati e apprendimento

Decidere se il primo rilascio usa esclusivamente algoritmi deterministici. Raccomandazione: si'. Ogni modello futuro richiede origine dati, licenza, model card, test bias e consenso separati.

### ADR-008 — Persistenza e privacy

Scegliere se i progetti conservano soltanto link/fingerprint o anche proxy locali. Raccomandazione: link/fingerprint per default, proxy cifrati solo opt-in.

## Roadmap proposta

### Fase 0 — Spike di fattibilita'

Deliverable:

- generatore minimale di Creative Profile + preset XMP;
- import manuale in Lightroom su RAW e JPEG;
- identity LUT e look noto per verificare encoding;
- report 33^3/65^3;
- esperimento RAF/JPEG con renderer dichiarato;
- review licenze e SBOM iniziale;
- benchmark sulle configurazioni Windows candidate e proposta dei budget `PERF-*`;
- test di comprensione dei wireframe con fotografi;
- decisione ADR-001/002/003/004/005.

Exit criteria:

- pacchetto importato senza workaround non documentati;
- output visivamente e numericamente ripetibile;
- nessun componente con licenza incompatibile;
- limiti della preview dimostrati e accettati.
- configurazioni Windows, limiti di scala e budget prestazionali approvati.

### Fase 1 — Vertical slice locale

Deliverable:

- progetto, import di pochi file, canonical image;
- una sola ricetta deterministica;
- confronto Base/Look;
- esportazione ZIP;
- audit completo di un run;
- test automatici sintetici e tre casi fotografici reali autorizzati.

Exit criteria:

- RAF e JPEG attraversano la stessa pipeline di dominio;
- crash decoder non chiude l'app;
- ricetta riproducibile dopo riapertura;
- import Lightroom verificato.

### Fase 2 — Look Builder MVP

Deliverable:

- modalita' Esplora e Da reference;
- proposte parametriche originali;
- percorso A/B;
- Soft/Standard/Strong;
- `Look only` e, se approvato, `Auto Base`;
- inspector audit e bundle diagnostico;
- matrice fotografica minima completa;
- integrazione nel launcher FileX.

Exit criteria:

- criteri di accettazione prodotto soddisfatti;
- review fotografica e tecnica firmate;
- installer Windows, notice e SBOM completi;
- nessuna modifica degli originali e nessun traffico immagini.

### Fase 3 — Paired style e robustezza

Deliverable:

- modalita' `Impara il mio stile` RAW/JPEG;
- allineamento e fitting su coppie;
- holdout obbligatorio;
- calibrazione opzionale multi-camera separata dal look;
- compatibilita' Lightroom ampliata.

### Fase 4 — Ricerca ML opzionale

Non e' parte dell'MVP. Richiede una decisione esplicita e:

- dataset commercialmente utilizzabile;
- esecuzione locale;
- modello gratuito e redistribuibile;
- confronto contro baseline deterministica;
- model card, bias test, rollback e kill switch;
- miglioramento dimostrabile sulla matrice fotografica.

## Backlog di ricerca

- round-trip dei profili enhanced tra Lightroom e FileX;
- resa dell'amount del profilo su RAW/JPEG;
- color management monitor HDR e wide gamut;
- accuratezza e costo dei demosaic X-Trans disponibili in LibRaw senza moduli GPL;
- stabilita' del riconoscimento di pelle e illuminazione mista;
- strategia per reference con crop/esposizione locale molto diversi;
- UX della confidenza e degli outlier;
- benchmark su hardware Windows minimo e raccomandato.

## Definizione di “professionale”

Il termine e' accettabile soltanto se il prodotto:

- dichiara renderer, compatibilita' e limiti;
- non confonde profilo creativo e correzione camera;
- conserva neutri e transizioni entro soglie documentate;
- e' validato su persone, eventi, luce mista e scene estreme;
- produce file importabili e ripetibili;
- permette di capire e diagnosticare ogni trasformazione;
- tutela originali, privacy e licenze.

## Prossimo checkpoint con l'utente

Prima di scrivere codice presentare insieme:

1. scelta sidecar C++ oppure Rust/C++;
2. versioni Lightroom da supportare;
3. presenza di `Auto Base` nel primo ZIP;
4. formato del progetto e policy proxy;
5. risultato dello spike Adobe e decisione SDK/serializer.
