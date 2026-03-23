# IMAGE ID PRINT — SPECIFICA COMPLETA PER SVILUPPO

## 1. CONTESTO

Questo tool fa parte di una suite di applicazioni fotografiche già esistenti.

È OBBLIGATORIO mantenere coerenza con:

* UI
* UX
* stack tecnologico
* struttura codice

Il tool di riferimento è:

👉 **Party Frame (Photo Frame / Image Party Frame)**

Questo tool deve:

* riutilizzare lo stesso stack
* riutilizzare le stesse dipendenze
* riutilizzare gli stessi pattern architetturali
* riutilizzare gli stessi componenti UI quando possibile

❗ NON creare nuovi stack, NON introdurre nuove librerie se non strettamente necessario.

---

## 2. NOME MODULO

**Image ID Print**

### Claim:

Foto per documenti pronte per la stampa

---

## 3. OBIETTIVO DEL TOOL

Consentire all’utente di:

1. Caricare una foto
2. Ritagliarla con proporzioni vincolate (fototessera/passaporto)
3. Scegliere un formato foglio
4. Generare automaticamente una pagina con più copie della foto
5. Esportare un file pronto per la stampa (alta qualità)

---

## 4. FLUSSO UTENTE (OBBLIGATORIO)

1. Upload foto (drag & drop o click)
2. Scelta tipo documento
3. Crop guidato con aspect ratio bloccato
4. Scelta formato foglio
5. Calcolo automatico copie
6. Anteprima foglio
7. Export finale

Il flusso deve essere lineare e senza passaggi inutili.

---

## 5. FUNZIONALITÀ CORE

### 5.1 Upload

* Drag & drop
* Click upload
* Formati supportati:

  * JPG
  * JPEG
  * PNG

---

### 5.2 Preset documenti

Il sistema deve avere preset hardcoded:

* Fototessera → 35x45 mm
* Passaporto → 35x45 mm
* Custom

Ogni preset definisce:

* widthMm
* heightMm
* aspectRatio

❗ NON inventare altri formati senza esplicita richiesta.

---

### 5.3 Crop engine

Requisiti:

* Aspect ratio BLOCCATO
* Zoom
* Pan
* Rotazione (opzionale ma consigliata)

Overlay:

* Cornice crop
* Centro

❗ NON usare librerie pesanti se Party Frame non le usa.
❗ Se Party Frame ha già un crop system → riutilizzarlo.

---

### 5.4 Preset fogli stampa

Preset obbligatori:

* 10x15 cm
* 13x18 cm
* A4

Ogni preset:

* widthMm
* heightMm

---

### 5.5 Layout automatico

Il sistema deve:

1. Convertire mm → pixel usando DPI
2. Calcolare quante copie entrano

Formula OBBLIGATORIA:

pixel = (mm / 25.4) * dpi

Calcolo:

* area utile = foglio - margini
* copie per riga = floor(area utile / dimensione foto)
* copie per colonna = floor(area utile / dimensione foto)
* totale = righe × colonne

❗ NON usare valori arbitrari
❗ NON approssimare senza formula

---

### 5.6 Anteprima

Deve mostrare:

* foglio
* griglia
* copie reali

❗ Preview ≠ Export
Preview può essere scalata
Export deve essere reale

---

### 5.7 Export

Formati:

* JPG
* PNG
* PDF

Requisiti:

* 300 DPI
* qualità alta
* nessuna compressione aggressiva

Nome file:
fototessera_35x45_10x15_8copie.jpg

---

## 6. ARCHITETTURA (OBBLIGATORIA)

Separare in moduli:

### 6.1 document-presets

Contiene i formati documento

---

### 6.2 sheet-presets

Contiene i formati foglio

---

### 6.3 crop-engine

Gestisce:

* zoom
* pan
* area crop

---

### 6.4 layout-engine

Responsabile SOLO di:

* calcolo copie
* posizioni X/Y

❗ Deve essere funzione pura (no UI)

---

### 6.5 export-engine

Responsabile di:

* generazione immagine finale
* generazione PDF

---

### 6.6 preview-renderer

Solo per UI

---

## 7. STACK TECNOLOGICO

DEVE essere lo stesso di Party Frame.

Se Party Frame usa:

* React
* TypeScript
* Canvas API

→ usare gli stessi

❗ NON introdurre:

* nuove librerie di crop
* nuovi state manager
* nuovi framework

Se non necessario.

---

## 8. REGOLE ANTI-ALLUCINAZIONE (CRITICHE)

### 8.1 NON inventare dipendenze

Se una libreria non è presente nel progetto:
→ NON usarla

---

### 8.2 NON cambiare stack

Usare ESATTAMENTE quello esistente

---

### 8.3 NON creare feature non richieste

Esempi vietati:

* AI face detection
* background removal
* controlli biometrici

---

### 8.4 NON saltare conversioni fisiche

TUTTE le dimensioni devono passare da:

mm → inch → pixel

---

### 8.5 NON mescolare preview ed export

Sono due sistemi separati

---

### 8.6 NON scrivere codice monolitico

Separare i moduli come definito

---

### 8.7 NON usare valori “magici”

Ogni numero deve avere origine logica

---

### 8.8 NON ignorare edge cases

Gestire:

* immagine troppo piccola
* foglio incompatibile
* zero copie possibili

---

## 9. EDGE CASES (OBBLIGATORI)

* immagine con risoluzione insufficiente
* margini troppo grandi
* nessuna copia possibile
* crop fuori bounds
* export senza immagine

---

## 10. UI / UX

Deve essere coerente con Party Frame.

Layout:

* Sidebar sinistra → controlli
* Centro → crop editor
* Destra → anteprima foglio

❗ NON reinventare UI

---

## 11. PERFORMANCE

* Preview veloce
* Export separato e più pesante
* Evitare blocchi UI

---

## 12. CRITERI DI ACCETTAZIONE

Il tool è corretto se:

* Carico una foto
* Seleziono fototessera 35x45
* Seleziono foglio 10x15
* Il sistema genera automaticamente 8 copie
* L’export produce file corretto a 300 DPI

---

## 13. VERSIONE MVP

Implementare SOLO:

* upload
* crop
* preset documenti
* preset fogli
* layout automatico
* export JPG/PDF

❗ Tutto il resto è fuori scope

---

## 14. OUTPUT ATTESO

* Codice completo
* Struttura modulare
* Nessuna dipendenza inutile
* UI coerente con Party Frame
* Tool funzionante end-to-end

---

FINE SPECIFICA


## 15. GESTIONE DPI E QUALITÀ DI STAMPA (OBBLIGATORIA)

Questa sezione è CRITICA.
Il tool deve garantire output reale e corretto per la stampa fotografica.

---

### 15.1 DPI di default

* DPI default: **300**
* Deve essere configurabile dall’utente (opzionale UI)
* Range consigliato:

  * 150 DPI (bassa qualità)
  * 300 DPI (standard stampa)
  * 600 DPI (alta qualità)

Se non specificato → usare SEMPRE 300 DPI

---

### 15.2 Conversione dimensioni (OBBLIGATORIA)

Tutte le dimensioni devono essere calcolate con questa formula:

pixel = (mm / 25.4) * dpi

Esempio:

Fototessera 35x45 mm a 300 DPI:

* width = (35 / 25.4) * 300 ≈ 413 px
* height = (45 / 25.4) * 300 ≈ 531 px

❗ Vietato:

* usare valori hardcoded
* usare scaling visivo
* usare percentuali arbitrarie

---

### 15.3 Risoluzione canvas finale

Il canvas di export deve essere:

* dimensione reale del foglio in pixel
* calcolata in base al DPI

Esempio:

Foglio 10x15 cm → 100x150 mm

→ width = (100 / 25.4) * 300 ≈ 1181 px
→ height = (150 / 25.4) * 300 ≈ 1772 px

❗ Il canvas finale deve usare queste dimensioni reali

---

### 15.4 Qualità immagine

Per export JPG:

* qualità: **100% (1.0)**
* no compressione visibile
* no ridimensionamenti post-render

Per PNG:

* lossless
* nessuna compressione distruttiva

---

### 15.5 Rendering ad alta qualità

Il rendering finale deve:

* usare canvas separato dall’anteprima
* disegnare ogni immagine alla dimensione reale
* evitare scaling multipli

Flusso corretto:

1. Crop → immagine finale
2. Ridimensionamento UNA SOLA VOLTA alla dimensione target
3. Disegno su canvas finale

❗ Vietato:

* scalare più volte
* usare immagini preview per export

---

### 15.6 Controllo qualità immagine

Il sistema deve verificare:

Se immagine originale < risoluzione richiesta:

→ mostra warning:

“La risoluzione dell’immagine potrebbe non essere sufficiente per una stampa ottimale a [DPI]”

---

### 15.7 Coerenza dimensionale stampa

Il file esportato deve rispettare:

* dimensioni fisiche reali (mm/cm)
* proporzioni esatte
* nessuna distorsione

Test obbligatorio:

Stampando il file:

* una fototessera deve misurare ESATTAMENTE 35x45 mm

---

### 15.8 PDF stampa

Se export PDF:

* mantenere DPI interno (300)
* inserire immagine senza scaling automatico
* dimensione pagina reale (es. 10x15 cm)

❗ Vietato:

* lasciare scaling automatico del viewer PDF
* usare dimensioni non controllate

---

### 15.9 Separazione preview vs export

OBBLIGATORIO:

Preview:

* bassa risoluzione
* veloce

Export:

* alta risoluzione
* preciso

❗ Non riutilizzare canvas preview per export

---

### 15.10 Nome file intelligente

Formato:

tipoDocumento_dimensione_foglio_numeroCopie_dpi.jpg

Esempio:

fototessera_35x45_10x15_8copie_300dpi.jpg

---

### 15.11 Anti-allucinazione (DPI)

Regole vincolanti:

* NON inventare DPI
* NON ignorare conversioni mm → pixel
* NON usare valori approssimativi
* NON usare scaling CSS per dimensioni finali
* NON esportare da canvas non calibrato

---

## CRITERIO DI ACCETTAZIONE DPI

Il sistema è corretto se:

* una foto 35x45 mm esportata a 300 DPI
* stampata su carta reale

→ misura esattamente 35x45 mm

---

FINE SEZIONE DPI
