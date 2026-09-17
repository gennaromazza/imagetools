# AF-000 — Decisioni aperte e gate di avvio

## Decisioni aperte

> Stato 2026-09-14: G1/G2 hanno una prima implementazione verificabile nel workspace (`AlbumProject` + manifest handoff dedicato). Restano da approvare le policy di prodotto e stampa prima del renderer definitivo.

1. **Handoff:** evolvere `DesktopPhotoToolHandoff` o creare un canale/manifest Album dedicato? La seconda opzione preserva la compatibilità dei consumer attuali.
2. **Ordine:** quale ordine diventa canonico per l'album: manuale Selector, data scatto, o una combinazione con override espliciti?
3. **Capitoli:** una `customLabel` può generare più capitoli? Come trattare assenza, rinomina o rimozione di una label dopo l'import?
4. **Persistenza:** posizione e formato di `AlbumProject`; serve definire portabilità, relink e salvataggio atomico.
5. **Output:** formati, DPI, profilo colore, bleed, safe area, PDF/printer marks e criterio di blocco preflight.
6. **Rendering:** renderer nativo (Sharp/Node), canvas/renderer o pipeline ibrida; questa scelta impatta fedeltà, memoria e test installato.
7. **Licenza:** `shared-runtime` coerente con gli altri tool Suite o una policy `standalone` esplicita.
8. **Distribuzione:** id, nome prodotto, icona, dimensioni finestra e compatibilità aggiornamenti da stabilire nel manifest reale.

## Gate prima dell'implementazione

- G1: approvare il contratto handoff e l'ownership dell'ordine/capitoli.
- G2: approvare schema `AlbumProject` comune ad auto e manuale.
- G3: definire requisiti di stampa/proofing e renderer.
- G4: creare il workspace e integrare manifest, IPC, Dev Console, test, installer e sito nello stesso intervento.

## Inferenze da validare

- Il package `@photo-tools/core` sembra il candidato naturale a ospitare il modello operativo condiviso, perché già coordina auto layout e editing manuale. Non è però una decisione registrata nel repository.
- Il manifest Album dovrebbe affiancare il sistema firmato/acknowledged già usato dalla shell, perché tale sistema ha controlli di sicurezza e lifecycle maturi. Va verificato che il volume di metadati rientri nei limiti o che questi siano aggiornati con test.
- Album Flow potrebbe adottare `shared-runtime`, seguendo i tool visibili della Suite. È una scelta di prodotto/licenza, non un fatto tecnico.
