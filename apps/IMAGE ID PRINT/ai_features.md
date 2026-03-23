# TASK: ESTENSIONE IMAGE ID PRINT — AI BACKGROUND, EXPAND WHITE, REFILL GENERATIVO, UPSCALE

## CONTESTO (OBBLIGATORIO)

L'applicazione Image ID Print è già sviluppata e funzionante.

NON devi:
- ricreare il progetto
- riscrivere la UI
- cambiare stack tecnologico
- introdurre nuove dipendenze frontend inutili
- modificare le logiche già corrette di crop, layout e export se non strettamente necessario

Devi:
- lavorare SOLO in estensione del codice esistente
- mantenere l’architettura attuale
- mantenere la UI coerente con il progetto esistente e con Party Frame
- aggiungere nuove funzioni AI come strumenti opzionali e non distruttivi

---

## OBIETTIVO

Aggiungere all’app esistente le seguenti funzionalità:

1. rimozione automatica dello sfondo
2. sostituzione automatica con sfondo bianco
3. espansione canvas con riempimento bianco quando la foto è troppo stretta
4. refill generativo opzionale delle zone estese quando serve ricostruire un bordo
5. upscale opzionale ad alta qualità per immagini piccole o deboli

Queste funzioni devono essere pensate per foto documento, quindi:
- approccio conservativo
- niente effetti estetici aggressivi
- niente alterazioni forti del volto
- massima semplicità d’uso

---

## PRINCIPIO DI PROGETTO

Per foto documento esistono due casi distinti:

### Caso A — Expand White
Quando la foto è troppo stretta ma il soggetto è già buono:
- estendere il canvas
- riempire lo spazio aggiunto di bianco
- ricentrare correttamente il soggetto

Questo NON richiede AI generativa.

### Caso B — Generative Refill
Quando l’estensione bianca pura non basta e mancano piccoli bordi visivi utili:
- estendere il canvas
- generare contenuto solo nelle nuove zone
- usare refill generativo in modo leggero e controllato
- usare questa modalità SOLO come opzione avanzata

La modalità standard deve restare Expand White.

---

## STEP 1 — ANALISI DEL CODICE ESISTENTE (OBBLIGATORIO)

Prima di scrivere codice:

1. individua il modulo feature di Image ID Print
2. individua dove sono gestiti:
   - upload immagine
   - crop
   - export
   - preview
3. individua se esiste già un backend locale o una logica server-side locale
4. individua pattern già esistenti per:
   - servizi
   - worker
   - processi esterni
   - moduli data/config
5. riutilizza la convenzione architetturale già presente

NON duplicare logica esistente.

---

## STEP 2 — ARCHITETTURA DELLE NUOVE FUNZIONI

Le nuove funzioni AI NON devono sporcare la UI con logica pesante.

### Requisito architetturale
Se il progetto ha già un backend locale o un layer servizi:
- estendere quello esistente

Se non esiste:
- creare un micro-servizio locale separato e minimale per l’elaborazione immagini

### Obiettivo
Tenere separati:
- frontend/UI
- orchestrazione feature
- logica AI / elaborazione immagine

### Preferenza implementativa
Usare servizi locali e/o processi locali per:
- remove background
- apply white background
- expand white canvas
- generative refill
- upscale

---

## STEP 3 — INTEGRAZIONE BACKGROUND REMOVAL

### Tool da usare
Usare come prima scelta **rembg** in locale.

Motivazione:
- open source
- MIT
- utilizzabile come libreria Python, CLI, HTTP server o Docker
- già adatto alla rimozione sfondo immagini :contentReference[oaicite:1]{index=1}

### Requisiti
Aggiungere una funzione chiamabile dal tool tipo:
- `removeBackground(image)`

### Output atteso
Restituire:
- immagine PNG con trasparenza
oppure
- buffer equivalente con alpha channel

### UI
Aggiungere un’azione semplice:

- `Rimuovi sfondo`

### Comportamento
- non applicare automaticamente all’import
- l’utente deve poter decidere
- mostrare anteprima prima/dopo
- mantenere possibilità di annullare

---

## STEP 4 — SFONDO BIANCO AUTOMATICO

Dopo la rimozione sfondo, aggiungere:

- `Applica sfondo bianco`

### Logica
- usare l’immagine scontornata
- comporla sopra uno sfondo bianco puro
- preservare bene i bordi
- nessun alone grigio evidente

### Requisito
Lo sfondo bianco deve essere:
- davvero uniforme
- adatto a uso documento
- applicabile anche dopo eventuale expand canvas

### UI
Checkbox o toggle:
- `Sfondo bianco automatico`

---

## STEP 5 — EXPAND WHITE CANVAS (OBBLIGATORIO)

Aggiungere una funzione per casi in cui la foto è troppo stretta.

### Nome logico
- `Expand White`
- oppure `Espandi sfondo`

### Comportamento
Quando il crop documento richiede più spazio:
- estendere il canvas
- mantenere il soggetto centrato
- riempire le nuove aree con bianco
- NON deformare il soggetto
- NON scalare in modo arbitrario il volto solo per farlo entrare

### Parametri
- espansione orizzontale
- espansione verticale
- padding automatico o manuale
- ancoraggio centrato

### Regola importante
Questa deve essere la modalità default quando la foto è troppo stretta.

---

## STEP 6 — GENERATIVE REFILL OPZIONALE

### Obiettivo
Aggiungere una modalità avanzata per ricostruire solo piccole porzioni mancanti nei bordi estesi.

### Soluzioni consentite
Usare una di queste opzioni SOLO se compatibile con il progetto e fattibile localmente:

- integrazione locale con workflow di outpainting
- backend locale basato su ComfyUI workflow
- backend locale basato su Fooocus in modalità inpaint/outpaint

Fooocus è offline/open source e include inpaint/outpaint; i workflow ComfyUI coprono in/outpainting. :contentReference[oaicite:2]{index=2}

### Regole
Il refill generativo deve:
- essere opzionale
- essere conservativo
- agire solo sulle aree nuove
- NON alterare il volto
- NON alterare occhi, naso, bocca
- NON reinventare identità o tratti del soggetto

### Ambito di utilizzo
Usare solo per:
- bordi capelli
- piccole porzioni laterali
- margini spalle
- parti minori del contorno

NON usare per:
- ricostruire metà testa
- cambiare posa
- cambiare volto
- modificare elementi centrali del soggetto

### UI
Aggiungere toggle separato:
- `Refill generativo bordi`

E opzione sicurezza:
- `Usa solo sulle aree estese`

### Fallback
Se il refill fallisce o produce risultato instabile:
- tornare automaticamente a Expand White
- mostrare warning non bloccante

---

## STEP 7 — UPSCALE OPZIONALE

### Tool da usare
Usare come opzione **Real-ESRGAN** per upscale/restoration locale.

Real-ESRGAN è un progetto open source per image/video restoration. :contentReference[oaicite:3]{index=3}

### Requisito
Aggiungere una funzione opzionale:
- `Upscale 2x`
- `Upscale 4x` solo se sostenibile

### Quando usarla
Solo se:
- immagine sorgente troppo piccola
- qualità insufficiente per stampa
- utente lo richiede esplicitamente

### UI
Pulsante o menu:
- `Migliora risoluzione`
- `Upscale 2x`

### Regola
L’upscale NON deve essere automatico di default.

---

## STEP 8 — ORDINE CORRETTO DELLA PIPELINE

L’ordine corretto deve essere questo:

1. import foto
2. crop / allineamento documento
3. remove background (opzionale)
4. apply white background (opzionale)
5. expand white canvas (se necessario)
6. generative refill edges (opzionale, avanzato)
7. upscale (opzionale)
8. layout stampa
9. export finale

### Regola
NON eseguire upscale prima del crop se non strettamente necessario.
NON usare preview a bassa risoluzione per l’export finale.

---

## STEP 9 — STRUTTURA MODULARE CONSIGLIATA

Se compatibile col progetto, creare o estendere moduli simili a:

- `image-processing-service`
- `background-removal-service`
- `canvas-expand-service`
- `generative-refill-service`
- `upscale-service`

### Obiettivo
Separare chiaramente:
- orchestrazione feature
- logiche AI
- composizione finale immagine

### Regola
Ogni servizio deve avere input/output chiari e testabili.

---

## STEP 10 — IMPOSTAZIONI UI DA AGGIUNGERE

Aggiungere nella sidebar o pannello impostazioni, senza cambiare il layout principale:

### Sezione: Miglioramento immagine
- [ ] Rimuovi sfondo
- [ ] Applica sfondo bianco
- [ ] Espandi sfondo con bianco
- [ ] Refill generativo bordi
- [ ] Upscale 2x

### Sezione: Parametri avanzati
- morbidezza bordo
- padding espansione
- intensità refill (solo se realmente supportata)
- reset modifiche AI

### Requisito UX
Le impostazioni avanzate devono restare secondarie.
L’utente base deve poter ottenere il risultato in pochi click.

---

## STEP 11 — COMPORTAMENTO AUTOMATICO INTELLIGENTE

Aggiungere una logica semplice e sicura:

### Caso foto regolare
- nessuna espansione necessaria
- nessun refill necessario

### Caso foto troppo stretta
- suggerire `Espandi sfondo con bianco`

### Caso foto stretta con bordi visivamente tagliati
- suggerire `Refill generativo bordi` come opzione avanzata

### Caso immagine piccola
- suggerire `Upscale 2x`

### Requisito
I suggerimenti devono essere discreti.
NON applicare automaticamente refill generativo senza consenso utente.

---

## STEP 12 — REQUISITI TECNICI E ANTI-ALLUCINAZIONE

### Regole obbligatorie
- NON ricreare l’app
- NON cambiare stack frontend
- NON introdurre logiche cloud se non richieste
- NON introdurre API a pagamento
- NON dipendere da servizi esterni obbligatori
- NON introdurre face beautification aggressiva
- NON introdurre modelli che alterano il volto in modo evidente
- NON usare generative refill come default
- NON applicare AI in punti non necessari
- NON rompere pipeline crop/layout/export già esistente
- NON duplicare componenti già presenti

### Regole sui tool
- per background removal usare rembg come default locale
- per refill generativo usare solo soluzione locale e opzionale
- per upscale usare Real-ESRGAN come opzionale
- se una soluzione richiede dipendenze troppo invasive, isolarla in backend/processo separato

---

## STEP 13 — GESTIONE ERRORI

Gestire almeno questi casi:

- rembg non disponibile localmente
- modello AI non installato
- generative refill non disponibile
- immagine troppo grande per il processo
- immagine troppo piccola per stampa di qualità
- timeout elaborazione locale
- risultato AI vuoto o corrotto

### UX errori
Messaggi chiari, ad esempio:
- `Modulo rimozione sfondo non disponibile`
- `Refill generativo non configurato: uso espansione bianca standard`
- `L’immagine potrebbe non avere qualità sufficiente per la stampa`

---

## STEP 14 — PREVIEW E EXPORT

### Preview
- può essere più leggera
- deve mostrare chiaramente il risultato delle nuove funzioni

### Export
- deve usare pipeline finale ad alta qualità
- deve rispettare i DPI già implementati
- deve esportare l’immagine finale realmente processata
- NON usare il canvas preview come source per l’export finale

---

## STEP 15 — TEST MINIMI OBBLIGATORI

Aggiungere test o verifiche minime per:

1. remove background restituisce output valido
2. apply white background restituisce immagine con sfondo uniforme
3. expand white aggiunge spazio senza deformare il soggetto
4. refill generativo, se abilitato, modifica solo aree estese
5. upscale restituisce output più grande e non corrotto
6. export finale continua a funzionare con tutte le combinazioni principali

---

## STEP 16 — PRIORITÀ DI IMPLEMENTAZIONE

Ordine richiesto:

### Priorità 1
- remove background
- apply white background
- expand white canvas

### Priorità 2
- upscale opzionale

### Priorità 3
- generative refill opzionale

Se il refill generativo è troppo invasivo da integrare subito:
- predisporre architettura
- aggiungere toggle disabilitato o feature flag
- non rompere il resto

---

## STEP 17 — CRITERIO DI SUCCESSO

Il task è completato se:

- l’app esistente continua a funzionare
- l’utente può rimuovere lo sfondo
- può applicare sfondo bianco
- può espandere il canvas con bianco
- può usare opzionalmente upscale
- può usare opzionalmente refill generativo, oppure la sua architettura è predisposta senza rompere il progetto
- crop, layout ed export restano corretti

---

## STEP 18 — NOTE IMPLEMENTATIVE FINALI

Prima di scrivere codice:
- ispeziona i file esistenti
- riusa nomi, pattern, convenzioni e dipendenze del progetto
- preferisci modifiche minime e localizzate

Obiettivo finale:
aggiungere capacità reali al tool esistente, non reinventarlo.

FINE TASK