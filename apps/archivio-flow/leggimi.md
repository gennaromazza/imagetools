# 📸 Archivio SD App — Specifica Operativa (Anti-Allucinazione)

---

# 📌 Contesto

Devo sviluppare una nuova applicazione all'interno della mia suite di tool fotografici.

Questa applicazione NON è un progetto da zero, ma:
👉 un’estensione coerente della suite esistente  
👉 con riuso di UI, componenti e stack tecnologico già presenti  

L’obiettivo è creare un software semplice, veloce e affidabile per:

- importare foto da SD
- organizzare automaticamente i lavori
- mantenere un archivio consultabile

---

# ❗ Regole Anti-Allucinazione (OBBLIGATORIE)

## 1. NON reinventare ciò che esiste già
- NON creare una nuova UI da zero
- NON introdurre nuovi pattern grafici
- NON cambiare lo stile della suite

👉 Riutilizzare layout, componenti e stile esistenti

---

## 2. NON introdurre nuove tecnologie
- NON cambiare stack
- NON aggiungere librerie inutili
- NON proporre soluzioni “alternative”

👉 Usare ESCLUSIVAMENTE lo stesso stack degli altri tool

---

## 3. NON complicare il progetto
- NON aggiungere funzionalità non richieste
- NON anticipare feature future
- NON creare architetture complesse inutili

👉 Questo è un tool semplice, operativo, concreto

---

## 4. NON cambiare il flusso utente
- Il software deve replicare il flusso reale attuale
- Deve solo automatizzarlo, non reinventarlo

---

## 5. NON perdere tempo su UI/design
- La UI è già definita
- Il focus è sulla logica

---

## 6. PRIMA analisi, POI implementazione
Prima di scrivere codice:
- analizzare struttura esistente
- identificare componenti riutilizzabili
- definire piano chiaro

---

# 🎯 Obiettivo Applicazione

Creare un’app che permetta di:

## 1. Importare foto da SD
## 2. Organizzare automaticamente i lavori
## 3. Rinominare file in modo coerente
## 4. Generare archivio leggero
## 5. Consultare e riaprire lavori esistenti

---

# 🧩 Funzionalità (Versione 1)

## 1. Rilevamento SD
- rilevare automaticamente la scheda inserita
- mostrare:
  - percorso
  - numero file
  - presenza RAW/JPG

---

## 2. Creazione nuovo lavoro

Campi richiesti:

- Nome lavoro / cliente
- Data lavoro (default: oggi)
- Autore

---

## 3. Naming cartella (OBBLIGATORIO)

Formato:
2026-03-21 - Maria Rossi Shooting - 21-03-2026


---

## 4. Struttura cartelle

Creare automaticamente:


FOTO_SD
└─ AUTORE
BASSA_QUALITA
EXPORT


---

## 5. Copia file da SD

- Copiare TUTTI i file
- RAW + JPG
- Nessuna selezione
- Nessuna esclusione
- Destinazione import: `FOTO_SD\Autore`
- Se compili una sottocartella aggiuntiva: `FOTO_SD\Autore\SottoCartella`

---

## 6. Rinomina file

Formato:


NomeLavoro_Data_Autore_NomeOriginale


Esempio:


MariaRossi_20260321_Gennaro_DSCF1234.RAF


Regole:
- NON perdere nome originale
- NON creare collisioni
- mantenere estensione

---

## 7. Archivio leggero (opzionale)

- generare JPG compressi
- salvarli in `BASSA_QUALITA`
- attivabile tramite opzione

---

## 8. Registro lavori (OBBLIGATORIO)

L’app deve salvare un elenco dei lavori creati.

Per ogni lavoro:

- nome
- data
- autore
- percorso cartella
- data creazione

---

## 9. Ricerca lavori

L’utente deve poter:

- cercare per nome
- cercare per data
- aprire cartella lavoro

---

# 🖥️ UI (Vincolo forte)

## NON creare nuova UI

Deve:

- usare layout esistente
- usare componenti esistenti
- mantenere spacing, font, colori

---

## Struttura schermata

### Sezione 1 — Nuovo lavoro
- SD rilevata
- Nome lavoro
- Data
- Autore
- preview nome cartella
- checkbox:
  - rinomina file
  - genera jpg leggeri
- bottone: IMPORTA

---

### Sezione 2 — Archivio lavori
- barra ricerca
- lista lavori
- azioni:
  - apri cartella
  - visualizza percorso

---

# 🔄 Flusso operativo reale

## Caso 1 — Nuovo shooting

1. Inserisco SD
2. Apro app
3. Inserisco dati lavoro
4. Clicco importa

Risultato:
- cartella creata
- file copiati
- file rinominati
- archivio aggiornato

---

## Caso 2 — Riapertura lavoro

1. Apro app
2. Cerco lavoro
3. Apro cartella

---

# ⚠️ Cosa NON deve fare

- selezione foto
- orchestrazione matrimonio
- integrazione cloud
- Firebase
- multi SD avanzato
- automazioni complesse
- gestione utenti
- upload automatici

---

# 🧠 Filosofia del tool

Questo software deve essere:

- veloce
- semplice
- affidabile
- prevedibile

---

# 📌 Regola finale

👉 NON costruire un sistema complesso  
👉 Costruire uno strumento che l’utente usa subito

---

# 🚀 Obiettivo sviluppo

Creare un’app funzionante, concreta e utilizzabile immediatamente nel workflow reale.

---

# 🔚 Nota finale

Questo è il primo modulo di un sistema più grande.

NON anticipare evoluzioni future.  
Costruire una base solida e riutilizzabile.
