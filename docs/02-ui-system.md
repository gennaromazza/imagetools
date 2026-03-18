# Photo Tools for Photographers

## 02. UI System & Current Product Flow

Questo documento aggiorna il sistema UI allo stato reale dell'applicazione il 16 marzo 2026.
La UI attuale non e' piu' solo una linea guida: il repository contiene piu' tool, ma questo file
descrive soprattutto il flusso attuale di `auto-layout-app` a livello di suite.

Nota:

- i dettagli specifici di `image-party-frame` sono documentati in `docs/tools/image-party-frame.md`

## 1. Struttura reale dell'esperienza

L'app `auto-layout-app` oggi e' organizzata cosi':

1. `dashboard`
2. `setup`
3. `studio`

Questo e' il flusso utente principale:

```text
Dashboard Progetti
  -> crea / importa / apri progetto
Setup Progetto
  -> carica foto / scegli parametri / controlla riepilogo
Studio Layout
  -> modifica pagine / esporta / salva automaticamente
```

## 2. Dashboard

La dashboard e' la porta d'ingresso attuale del prodotto.

Funzioni presenti:

- elenco progetti salvati
- creazione nuovo progetto
- rinomina progetto
- eliminazione progetto
- export progetto `.imagetool`
- import progetto `.imagetool`

La dashboard oggi sostituisce il vecchio concetto di semplice schermata iniziale del tool:
il prodotto ha gia' una dimensione di gestione progetto, non solo di esecuzione singola.

## 3. Setup progetto

La schermata di setup serve a configurare il lavoro prima di entrare nello studio.

Blocchi principali gia' presenti:

- hero/header con riepilogo rapido
- quick stats su foto, formato foglio e strategia di planning
- sezione sorgente foto
- configurazione foglio e parametri layout
- riepilogo piano generato
- accesso allo studio solo quando il progetto e' pronto

Funzioni attuali:

- caricamento foto reali
- caricamento dataset demo
- selezione delle foto attive del progetto
- scelta preset foglio
- impostazioni `dpi`, margini e gap
- modalita' `desiredSheetCount` o `maxPhotosPerSheet`
- toggle per variazione automatica template
- impostazioni output

## 4. Onboarding wizard

Il progetto include gia' un wizard guidato per la creazione del progetto.

Step attuali:

1. welcome
2. nome progetto
3. caricamento foto
4. selezione foto
5. scelta formato foglio
6. modalita' di planning
7. anteprima finale

Il wizard ha due obiettivi:

- ridurre la frizione per il primo uso
- generare un progetto coerente prima dell'apertura dello studio layout

## 5. Studio layout

Lo studio e' l'area di lavoro principale.

Elementi attuali:

- board centrale con pagine e slot
- toolbar con undo/redo, zoom e fullscreen
- azioni rapide per export, ritorno al setup e creazione foglio
- dock inferiore/tab per foglio, output, warning, statistiche e attivita'
- modali per conferma, anteprima foto ed export progress

Operazioni supportate:

- drag and drop di foto verso slot e fogli
- spostamento foto tra slot
- cambio template per pagina
- creazione foglio da foto non usate
- duplicazione pagina
- riordino pagine
- rimozione pagina
- editing singolo slot

## 6. Pattern UI attivi

Pattern realmente presenti nell'app:

- modali di conferma
- toast/notifiche
- banner dismissible
- pannelli laterali e dock a tab
- quick stats
- context menu
- empty states per dashboard e selezione contenuti
- progress modal per export

## 7. Keyboard e power-user UX

La UI oggi supporta gia' un uso piu' rapido da desktop.

Funzioni presenti:

- undo
- redo
- delete del foglio selezionato
- duplicazione del foglio selezionato
- toggle fullscreen
- escape per chiudere overlay e context menu

Questa direzione conferma che l'app va trattata come editor operativo, non come form lineare.

## 8. Persistenza e feedback

Il sistema UI comunica gia' uno stato applicativo persistente.

Comportamenti presenti:

- autosave del progetto con debounce
- stato di salvataggio in corso / salvato / errore
- recupero immagini da `IndexedDB` quando si riapre un progetto
- activity log per azioni utente e messaggi operativi
- warning panel dedicato

## 9. Gerarchia attuale da mantenere

Per coerenza del prodotto, i nuovi sviluppi dovrebbero mantenere questa gerarchia:

- livello 1: progetto e schermata attiva
- livello 2: azione primaria corrente
- livello 3: board/layout e pannelli di controllo
- livello 4: warning, activity, hint e stato secondario

## 10. Cosa non e' ancora definitivo

Parti ancora in evoluzione:

- design system condiviso tra futuri tool
- microcopy uniforme in tutte le schermate
- accessibilita' completa e rifinita
- standardizzazione finale di toast, banner e empty states
- strategia responsive estrema oltre al layout desktop-first attuale

## 11. Regole UI confermate

Restano valide queste regole:

- una sola azione primaria dominante per contesto
- editing manuale e planning automatico devono convivere senza confondersi
- warning e stato devono restare visibili
- il setup deve essere guidato ma non bloccante
- lo studio deve favorire operazioni veloci da tastiera e mouse

## 12. Direzione successiva consigliata

Le prossime migliorie UI piu' coerenti con l'app attuale sono:

1. uniformare i microcopy e rimuovere testo placeholder residuo
2. migliorare accessibilita' e focus management nei modali
3. consolidare gli indicatori di stato nel dock e nella toolbar
4. raffinare onboarding, ribbon foto e discoverability delle azioni avanzate
