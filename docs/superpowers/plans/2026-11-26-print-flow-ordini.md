# Print Flow a ordini — piano

> **For agentic workers:** metodo scelto dall'utente: Gemini (via OmniRoute) scrive il codice, Claude lo rivede, corregge e poi scrive i test. Sostituisce l'ordine «test prima».

**Goal:** sostituire il percorso a 5 passi con un ritaglio in serie per ordini a gruppi.
**Architecture:** logica pura in `src/order/`, interfaccia in `src/ui/`; resa tramite `renderPhotoCanvas` esistente.
**Tech Stack:** React 19, Vite, TypeScript, vitest.
**Spec:** `docs/superpowers/specs/2026-11-26-print-flow-ordini-design.md`

## Global Constraints
- `src/print-engine.ts` e `src/render-export.ts` non cambiano (li usa ID Photo).
- Tipi IPC solo da `@photo-tools/desktop-contracts`.
- JPG qualità 0.95, 300 DPI, avviso sotto 200 DPI, handoff massimo 500 foto.
- Nessuna sovrascrittura; originali mai toccati. Testi dell'interfaccia in italiano.

## Review Focus
- Due foto con lo stesso nome da cartelle diverse: entrambe esportate, nomi distinti.
- Esportare due volte nella stessa cartella: suffissi, nessun errore e nessuna sovrascrittura.
- Ordine salvato con foto spostate o cancellate: segnalate, export di quel gruppo bloccato con messaggio.
- Bordino più grande di metà foto o valori vuoti/negativi: limitati, mai area zero.
- Annullamento a metà export: il gruppo in corso non lascia file parziali.

## Task
- [ ] **1. Modello e geometria** — `src/order/model.ts`, `src/order/geometry.ts`; test `src/order/model.test.ts`, `geometry.test.ts`.
- [ ] **2. Nomi e salvataggio** — `src/order/naming.ts`, `src/order/storage.ts`; test omonimi.
- [ ] **3. Resa ed export** — `src/order/render.ts`, `src/order/export.ts`; test `export.test.ts`.
- [ ] **4. Sottocartella nel processo principale** (scritta da Claude, tocca il filesystem) — `ensureOutputSubfolder(parentPath: string, name: string): Promise<string>` in `packages/desktop-contracts`, `apps/filex-desktop` (modulo `output-subfolder.ts` + test, preload, handler, whitelist `files` di electron-builder).
- [ ] **5. Interfaccia** — `src/App.tsx`, `src/ui/*`, `src/styles.css`.
- [ ] **6. Pulizia** — cancellare planner, passi, `useWorkbench`, `copies`, componenti e documenti vecchi; `ARCHITETTURA.md`; versione 0.3.0 (anche dipendenza in `apps/id-photo/package.json` e lockfile); etichetta in Archivio Flow; descrizione test nella Dev Console; changelog; pagina del sito.
- [ ] **7. Verifica** — test e typecheck di Print Flow, ID Photo, desktop, Dev Console; build; prova a schermo; security-review, code-review, simplify.

I contratti di ogni modulo (firme e regole) sono nei prompt mandati a Gemini; il codice rivisto è la fonte di verità.
