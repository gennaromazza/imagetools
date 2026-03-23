# TASK: ESTENSIONE IMAGE ID PRINT — PRESET INTERNAZIONALI + UI

## CONTESTO (OBBLIGATORIO)

L'applicazione Image ID Print è già sviluppata e funzionante.

NON devi:

* ricreare il progetto
* cambiare stack tecnologico
* modificare architettura esistente
* riscrivere componenti UI

Devi:

* lavorare SOLO in estensione
* aggiungere funzionalità senza rompere nulla

---

# OBIETTIVO

Aggiungere:

1. preset internazionali documenti e visti
2. selezione per paese e categoria
3. UX migliorata per selezione preset

---

# STEP 1 — ANALISI CODICE ESISTENTE (OBBLIGATORIO)

Prima di modificare:

* individua dove sono gestiti i preset attuali
* verifica se sono hardcoded o già modulari
* individua dove vengono usati:

  * crop engine
  * layout engine
  * UI selezione formato

❗ NON duplicare logica esistente

---

# STEP 2 — REGISTRO CENTRALIZZATO PRESET

Se NON esiste già:

creare file:

```
src/features/image-id-print/data/document-presets.ts
```

Se ESISTE:
→ estenderlo

---

## STRUTTURA DATI (OBBLIGATORIA)

```ts
export type DocumentPreset = {
  id: string;
  countryCode: string;
  countryName: string;
  category: "id_card" | "passport" | "visa" | "residence_permit" | "custom";
  name: string;
  widthMm: number;
  heightMm: number;
  aspectRatio: number;
  background: "white" | "light" | "custom";
  notes?: string;
  enabled: boolean;
};
```

---

## PRESET DA AGGIUNGERE (OBBLIGATORI)

```ts
export const DOCUMENT_PRESETS: DocumentPreset[] = [

  // ITALIA
  {
    id: "it_photo",
    countryCode: "IT",
    countryName: "Italia",
    category: "id_card",
    name: "Fototessera 35x45 mm",
    widthMm: 35,
    heightMm: 45,
    aspectRatio: 35 / 45,
    background: "light",
    enabled: true,
  },

  // USA
  {
    id: "us_visa",
    countryCode: "US",
    countryName: "United States",
    category: "visa",
    name: "USA Visa / Passport 2x2 inch",
    widthMm: 51,
    heightMm: 51,
    aspectRatio: 1,
    background: "white",
    notes: "Formato ufficiale USA",
    enabled: true,
  },

  // CANADA
  {
    id: "ca_passport",
    countryCode: "CA",
    countryName: "Canada",
    category: "passport",
    name: "Canada Passport 50x70 mm",
    widthMm: 50,
    heightMm: 70,
    aspectRatio: 50 / 70,
    background: "white",
    enabled: true,
  },

  // UK
  {
    id: "uk_passport",
    countryCode: "UK",
    countryName: "United Kingdom",
    category: "passport",
    name: "UK Passport 35x45 mm",
    widthMm: 35,
    heightMm: 45,
    aspectRatio: 35 / 45,
    background: "white",
    enabled: true,
  },

  // CINA
  {
    id: "cn_visa",
    countryCode: "CN",
    countryName: "China",
    category: "visa",
    name: "China Visa 33x48 mm",
    widthMm: 33,
    heightMm: 48,
    aspectRatio: 33 / 48,
    background: "white",
    enabled: true,
  },

  // INDIA
  {
    id: "in_visa",
    countryCode: "IN",
    countryName: "India",
    category: "visa",
    name: "India Visa 2x2 inch",
    widthMm: 51,
    heightMm: 51,
    aspectRatio: 1,
    background: "white",
    enabled: true,
  },

  // UAE
  {
    id: "ae_visa",
    countryCode: "AE",
    countryName: "UAE",
    category: "visa",
    name: "UAE Visa 35x45 mm",
    widthMm: 35,
    heightMm: 45,
    aspectRatio: 35 / 45,
    background: "white",
    enabled: true,
  }

];
```

---

# STEP 3 — INTEGRAZIONE UI (SENZA RISCRIVERE)

Modificare SOLO la logica dati:

## 3.1 Sostituire preset statici

* usare `DOCUMENT_PRESETS`
* eliminare hardcode dove possibile

---

## 3.2 Aggiungere selezione categoria

UI deve permettere:

* Tutti
* ID
* Passport
* Visa

---

## 3.3 Aggiungere selezione paese

Dropdown o select:

* Italia
* USA
* Canada
* UK
* China
* India
* UAE

---

## 3.4 Filtro combinato

Filtro logico:

```ts
filtered = presets
  .filter(p => p.enabled)
  .filter(p => selectedCategory ? p.category === selectedCategory : true)
  .filter(p => selectedCountry ? p.countryCode === selectedCountry : true);
```

---

## 3.5 Lista preset finale

Mostrare:

* nome preset
* dimensione (es. 35x45 mm)

---

# STEP 4 — UX MIGLIORATA

## 4.1 Ricerca veloce

Aggiungere campo:

“Cerca paese o formato”

Filtro:

```ts
p.name.toLowerCase().includes(query)
|| p.countryName.toLowerCase().includes(query)
```

---

## 4.2 Auto suggerimento

Se utente scrive:

* "usa"
  → suggerire USA Visa

---

## 4.3 Default intelligente

Se nessuna selezione:
→ default = Italia fototessera

---

## 4.4 Visualizzazione dimensioni

Mostrare sempre:

"35x45 mm"

---

# STEP 5 — INTEGRAZIONE CON CROP

NON modificare logica interna.

Assicurarsi solo che:

```ts
aspectRatio = preset.widthMm / preset.heightMm
```

---

# STEP 6 — LAYOUT ED EXPORT

NON modificare.

Devono funzionare automaticamente con:

* nuove dimensioni
* DPI già implementati

---

# ANTI-ALLUCINAZIONE (CRITICO)

* NON introdurre librerie
* NON duplicare componenti
* NON riscrivere UI
* NON hardcodare nuovi preset nella UI
* NON modificare layout engine
* NON modificare export engine

---

# CRITERIO DI SUCCESSO

Il task è completato se:

* i nuovi preset compaiono nella UI
* filtro paese funziona
* filtro categoria funziona
* ricerca funziona
* crop cambia correttamente
* layout funziona senza modifiche
* export funziona correttamente

---

FINE TASK
