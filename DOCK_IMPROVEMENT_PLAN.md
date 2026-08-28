# Roadmap di implementazione Dock FileX Suite

## Stato attuale (recap rapido)
La dock di FileX Suite è costruita in `main.ts` e `suite-main.ts` (bootstrap per Suite) e nel renderer HTML/CSS/JS dentro `suite-launcher-src`.

- Stato persistito: `DesktopDockState` (contratto condiviso)
  - file: `packages/desktop-contracts/src/index.ts`
- Salvataggio/lettura stato: `saveSuiteDockState` + `readSuiteDockState` in `apps/filex-desktop/src/main.ts`
- Creazione finestra dock: `createSuiteDock` in `apps/filex-desktop/src/main.ts`
- UI dock: `apps/filex-desktop/suite-launcher-src/dock.html`, `dock-window.css`, `dock-window.js`
- Build output docking: `apps/filex-desktop/scripts/build-suite-launcher.mjs` e risorse packager

## Obiettivo
Introdurre una dock più stabile + più utile, riducendo il problema che oggi tende a “sparire” o richiedere riposizionamenti continui.

---

## Migliorie già considerate (5)

1. **Hardening del bootstrap dock**
   - In `createSuiteDock`, se `dock.html` non esiste, mostrare una UI fallback minima e registrare errore diagnostico esplicito.
   - Inserire stato visivo di errore in dock (non fallback muto).

2. **Clamping robusto della posizione**
   - Clamp su `x` e `y` anche al caricamento/salvataggio, in base al display corrente.
   - Evita window fuori viewport dopo cambio monitor/DPI.

3. **Unificazione dei due processi Suite**
   - Ridurre divergenze tra `src/main.ts` e `src/suite-main.ts` su: preload, path, layout/salvataggio stato, eventi mouse.
   - Obiettivo: meno regressioni quando cambia una parte del runtime.

4. **Dock come centro di manutenzione tool**
   - Portare nel pannello dock indicatori aggiornamenti, stato “update disponibili”, quick-open alla pagina tool.
   - Ridurre click in app principale.

5. **UX/accessibilità + base test**
   - Supporto tastiera essenziale e test manuali smoke: apertura dock, stato persistito, salvataggio x/y/opacità/collasso.

---

## Altre 5 migliorie richieste (nuove)

6. **Nuovo paradigma: dock laterale ancorata (verticale) + reveal on hover**
   - Inserire modalità `edge` per ancoraggio automatico a sinistra o destra del desktop.
   - In stato `collapsed`, la dock resta un pannello sottile (solo icone); al `mouseenter` si espande verticalmente verso il centro mostrando:
     - icone strumenti
     - label compatta on-demand
     - pulsanti stato
   - Modalità più idonea per avere l’utility sempre presente e “non disturbare” il canvas video.

7. **Magnetismo contesto monitor + taskbar aware**
   - `resolveSuiteDockState` dovrebbe calcolare lato runtime il monitor più vicino al puntatore all’avvio e ancorare lì.
   - Tenere conto area taskbar (`workArea`) evitando sovrapposizioni persistenti.

8. **Auto-docking intelligente con snap rapido**
   - Trascinamento: quando la finestra è vicina al bordo, entra automaticamente in modalità ancorata.
   - Salvataggio modalità: `edgeAnchor` in state (`bottom|left|right|floating`), con fallback alla posizione precedente per compatibilità.

9. **Animazioni e comportamento “micro-UI” più leggibili**
   - Animazioni leggere di reveal/slide per transizioni left/right.
   - Hover/press feedback coerente (scale/minor glow), blur/trasparenza differenziata tra modalita’ collapsed/expanded.
   - Indicatori visivi per tool con update pending (dot colorato/tooltip dinamico).

10. **“Video-safe mode” e zone di esclusione**
   - Impostazione rapida per utenti che lavorano con player/fullscreen:
     - altezza ridotta e trasparenza più alta
     - hide on focus applicazioni “video” (es. fullscreen)
     - opzione “modalità gaming/streaming” per ignorare collisioni orizzontali e restare compatta laterale
   - Evita occlusione involontaria durante lavoro su schermi secondari.

11. **Aggiunta di strumenti rapidi lato dock (extra funzionale)**
   - Pulsanti rapidi: `Cerca aggiornamenti`, `Apri Suite`, `Avvia ultimo tool usato`, `Impostazioni dock`.
   - Rende la dock non solo launcher, ma area controllo rapido.

12. **Persistenza avanzata stato UX**
   - In state salvo anche:
     - `edgeAnchor`, `snapPadding`, `compactMode`, `revealMode`.
   - Evita che l’utente debba riadattare dopo ogni avvio.

13. **Compatibilità “legacy install”: auto-detection e fallback di build**
   - Se l’installer di una release non include `suite-launcher`, mostro avviso guidato con reset completo dock-state.
   - In caso mismatch versioning, fallback automatico alla configurazione minima e ricreazione artefatti.

14. **Centro notifiche interattivo nella dock**
   - Notifiche reali ma compatte (aggiornamenti tool/suite, stato licenza, stato job lunghi).
   - Ogni voce con azione contestuale (apri tool, apri suite, gestione licenza se disponibile).
   - Persistenza minima: manteniamo max 20 notifiche, con deduplica e riepilogo non invasivo.

15. **Controllo rumorosità delle notifiche**
   - Canale `silenzioso`/`importante` per non disturbare chi usa la dock in presenza continua di lavoro (es. video/photo review).
   - Impostazione dock-side: solo badge, badge+toast, o notifiche complete.

---

## Piano di implementazione consigliato

### Fase 1 (stabilità)
- Aggiornare `main.ts` (suite) e/o `suite-main.ts` con:
  - clamp stato robusto
  - guardie diagnostiche se manca `dock.html`
  - supporto edge mode in state

### Fase 2 (UX verticale)
- Aggiornare:
  - `suite-launcher-src/dock-window.html`
  - `suite-launcher-src/dock-window.css`
  - `suite-launcher-src/dock-window.js`
- Aggiungere classi e stato `dock--edge-left / dock--edge-right / dock--floating`.

### Fase 3 (integrazione funzionale)
- Integrare indicatori aggiornamenti e pulsanti utility nel renderer.
- Eventuale API addizionale nel preload per stato aggiornamenti dock-specifici.

### Fase 4 (polish e rollout)
- Verifica su 2 monitor + 1 monitor UHD + fullscreen video.
- Documento utente ridotto: “Come cambiare edge della dock + modalità focus video”.

---

## Criteri di accettazione (MVP)
- La dock non “sparisce” dopo riavvio/aggiornamento.
- È sempre recuperabile anche dopo cambio monitor.
- Posso scegliere ancoraggio laterale con comportamento hover verticale.
- Non copre il contenuto video durante utilizzo prolungato.
- Aggiornamenti e stato tool leggibili in dock.

---

## Definizione del file da aggiornare dopo approvazione
- Dopo il tuo ok, passo a:
  1) implementare prima Fase 1 e 2,
  2) applicare tuning su Fase 3,
  3) chiudere con Fase 4 e smoke test.

## Stato integrazione attuale (28/08/2026)
- Aggiunto `edgeAnchor` al contratto persistito con supporto `bottom`, `left` e `right` in entrambe le entry Electron.
- Implementata dock verticale laterale con reveal al passaggio del mouse, riordino verticale e ancoraggio taskbar-aware alla `workArea`.
- Aggiunto selettore posizione nelle impostazioni e ripristino coordinate quando si cambia lato.
- Integrato il centro notifiche per aggiornamenti Suite/tool e stato licenza, con azioni contestuali.
- Corretto il ridimensionamento temporaneo della finestra laterale per mostrare impostazioni e notifiche senza tagliarle.
- Separato lo stato del centro notifiche da quello delle impostazioni, con dimensionamento dedicato anche nella dock inferiore.
- Restano pianificati per una fase successiva: snap durante trascinamento, modalità video-safe avanzata e controllo granularizzato della rumorosità.

## Verifica runtime (28/08/2026)
- Build completa `build:suite` superata.
- Dock laterale sinistra: stato compatto `76x76`, reveal a `82x442` con 5 tool visibili e richiusura automatica verificata.
- Pannello impostazioni laterale: finestra `380x512`, pannello `280x203`, senza clipping.
- Cambio lato sinistra/destra persistito e classi renderer aggiornate correttamente.
- Centro notifiche laterale destro: finestra `380x442`, pannello `280x119`, senza clipping.
- Centro notifiche inferiore: finestra `452x420`, pannello interamente contenuto sopra la dock.
- Suite riavviata in modalita' normale senza porta di debugging dopo il collaudo.
- Limite della prova: nessun aggiornamento o errore licenza era attivo, quindi non erano disponibili azioni contestuali reali da eseguire.
- Correzione visuale successiva: altezza impostazioni della dock inferiore aumentata da 190 a 220 px per evitare il clipping di bordo, angoli e ombra del pannello.
- Correzione persistenza posizione: apertura e chiusura conservano il centro verticale sui bordi laterali e il bordo inferiore nella modalita' bottom; il cambio lato inizializza la posizione una sola volta.

