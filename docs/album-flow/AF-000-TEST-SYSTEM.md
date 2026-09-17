# AF-000 — Sistema di test Album Flow

Il comando `npm run test:album-flow-system` esegue smoke check statici sui confini documentati in `TASK-AF-000-CURRENT-STATE-AUDIT.md`, `AF-000-INTEGRATION-MAP.md` e `AF-000-OPEN-DECISIONS.md`.

Il gate aggregato `npm run test:album-flow-all` esegue l’intera suite Album Flow in sequenza e deve essere usato prima di ogni integrazione di nuove schermate.

Verifica automaticamente:

- handoff Photo Selector presente e compatibile;
- percorso Auto Layout collegato al progetto;
- creazione capitoli manuali;
- libreria delle foto importate;
- anteprima completa senza crop;
- presenza dei tre documenti AF-000.
- renderer SVG con dimensioni del foglio e slot assegnati.

Il test contrattuale `npm run test:album-flow-handoff` copre manifest Unicode, traversal dei percorsi e ordine di selezione.

## Matrice manuale da completare in Dev Console

| Caso | Risultato atteso |
|---|---|
| Nuovo progetto vuoto | appare in Home e apre il setup |
| Import manuale | crea/aggiorna progetto e mostra tutte le miniature |
| Import da Photo Selector | conserva id, selezione, rating, pick/reject, label e ordine |
| Formato personalizzato | salva larghezza, altezza, margini e abbondanza |
| Crea capitolo | aggiunge un capitolo persistente al progetto |
| Genera bozza Auto | produce pagine modificabili senza perdere asset |
| Modalità Manuale | non genera automaticamente e mantiene la libreria disponibile |
| Foto RAW senza preview | mostra fallback e non blocca la UI |
| Progetto senza foto | disabilita la bozza e propone import |

Il renderer SVG ha uno smoke test automatico; rasterizzazione/PDF, stampa, relink e salvataggio atomico restano aperti come indicato nelle decisioni AF-000 e richiedono implementazione prima del gate G3.

Stato verificato: il relink dei percorsi è disponibile nel renderer e testato con 2 casi; il renderer SVG include bleed e safe area ed è testato con 3 casi. Il PDF nativo richiede ancora un contratto IPC dedicato nel main process Electron.
