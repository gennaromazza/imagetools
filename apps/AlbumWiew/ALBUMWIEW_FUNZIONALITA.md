# AlbumWiew — Funzionalità, Architettura e Best Practice

## Introduzione
AlbumWiew è un’app desktop modulare per la gestione, annotazione e revisione di album fotografici sfogliabili, con supporto PSD, annotazioni, foto alternative e integrazione Auto-layout.

---

## Funzionalità principali
- Caricamento immagini JPG e PSD (smart object)
- Caricamento e gestione foto alternative
- Visualizzazione album sfogliabile (mockup)
- Annotazioni su foto (matita, note testuali)
- Sostituzione foto tramite "Altre foto disponibili"
- Aggiornamento PSD con sostituzione smart object
- Salvataggio, esportazione e importazione progetti
- Integrazione con Auto-layout tramite cartella condivisa e JSON

---

## Flusso operativo completo
1. Creazione album in Auto-layout (PSD, JSON, JPG)
2. Importazione progetto in AlbumWiew
3. Annotazione e sostituzione foto
4. Esportazione progetto aggiornato
5. Reimportazione e aggiornamento in Auto-layout

---

## Modularità e Architettura
- **Micro-componenti React**: ogni funzionalità è un componente autonomo e riutilizzabile
- **Code splitting**: sezioni pesanti (PSD, annotazione, viewer) caricate dinamicamente
- **Lite code**: dipendenze minime, bundle ottimizzato
- **Clean code**: nomi chiari, separazione responsabilità, nessun codice morto
- **Struttura a cartelle**:
  - /src/components/Upload/
  - /src/components/AlbumViewer/
  - /src/components/Annotation/
  - /src/components/AlternativePhotos/
  - /src/components/PsdHandler/
  - /src/integration/
  - /src/utils/

---

## Naming convention
- Componenti: PascalCase (es. PhotoAnnotator.tsx)
- Funzioni/variabili: camelCase
- Costanti: MAIUSCOLO_SNAKE_CASE
- File: descrittivi, senza abbreviazioni inutili

---

## Gestione stato
- Stato locale per UI e interazioni rapide
- Stato globale (es. context o Redux) solo per dati condivisi tra macro-componenti
- Evitare prop drilling profondo

---

## Test
- Test unitari per funzioni di utilità e logica
- Test di rendering per micro-componenti
- Test end-to-end per flusso di caricamento, annotazione, sostituzione e integrazione

---

## Esempio struttura JSON di progetto
{
  "pages": [
    { "id": "pg1", "image": "page1.jpg", "smartObject": "Layer 1", "notes": "Da sostituire", "drawings": [ ... ] },
    ...
  ],
  "alternatives": [ "alt1.jpg", "alt2.jpg" ],
  "history": [ ... ]
}

---

## Anti Allucinazione IA — Vibe Coding

### Principi
- Validazione automatica dei suggerimenti IA tramite test
- Code review obbligatoria per ogni contributo IA
- Prompt engineering dettagliato e contestualizzato
- Logging e tracciamento dei suggerimenti IA integrati
- Test di regressione dopo ogni merge IA
- Documentazione delle decisioni IA
- Snippet piccoli e modulari, mai blocchi estesi senza verifica
- Feedback loop: annotare e correggere errori IA

### Checklist revisione suggerimenti IA
- [ ] Il codice suggerito è stato testato (unit o e2e)?
- [ ] Il codice è stato revisionato da un umano?
- [ ] Il prompt fornito all’IA era chiaro e contestualizzato?
- [ ] Il codice è tracciato (commit/tag/commento)?
- [ ] Sono stati eseguiti test di regressione?
- [ ] La logica IA è documentata e motivata?
- [ ] Il codice è integrato come micro-componente o funzione isolata?
- [ ] Sono stati annotati e corretti eventuali errori/allucinazioni precedenti?

---

## FAQ e riferimenti
- Come si integra con Auto-layout?
- Come vengono gestite le annotazioni?
- Come si effettua il code splitting?

Per dettagli tecnici, vedi anche DOCUMENTAZIONE_TOOL.md e auto-layout.md.
