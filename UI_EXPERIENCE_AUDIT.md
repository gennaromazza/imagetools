# Audit UX/UI completo - `auto-layout-app`

Data audit: 14 aprile 2026  
Ambito: esperienza desktop per operatore interno ad alta frequenza d'uso  
App analizzata: `apps/auto-layout-app`

## Summary

L'app ha una base forte: il prodotto copre davvero il ciclo completo progetto -> selezione -> impaginazione -> revisione -> export, con un'impostazione chiaramente orientata a utenti operativi desktop. I punti migliori da preservare sono il wizard guidato, il supporto a flussi auto e manuali, il drag and drop cross-zona, l'editing fine per pagina/slot e il doppio export JPG/PSD.

L'esperienza oggi perde efficacia soprattutto in tre punti:

1. il percorso ha una duplicazione tra wizard e setup che rallenta invece di chiarire;
2. lo studio concentra troppe decisioni e troppi pannelli concorrenti nello stesso momento;
3. feedback, warning e prossima azione sono spesso separati dal contesto in cui l'utente sta lavorando.

Il risultato non e' un prodotto confuso in assoluto, ma un prodotto potente che non orchestra ancora bene priorita', stati e gerarchia operativa. Il miglioramento piu' importante non e' aggiungere altre funzioni: e' rendere piu' leggibile il percorso che le funzioni gia' supportano.

## Metodo ed evidenze

Audit basato su:

- lettura del codice in `apps/auto-layout-app`
- ricostruzione del flusso da `App.tsx` e componenti principali
- verifica build con `cmd /c npm run build`: riuscita
- verifica test E2E con `cmd /c npm run test:e2e`: suite presente ma non eseguibile integralmente per assenza browser Playwright installato nel sistema

Componenti e aree analizzate:

- `ProjectDashboard`
- `OnboardingWizard`
- `InputPanel`
- `PhotoSelector`
- `LayoutPreviewBoard`
- `WarningsPanel`
- `ResultPanel`
- `OutputPanel`

Gesti critici verificati nel codice e nei test:

- drag da ribbon a slot
- drag slot -> slot
- drop su tab o header di pagina
- creazione foglio via drag and drop
- cambio template
- rebalance
- gestione immagini non assegnate
- export fogli e PSD

## Mappa del flusso A->Z

## 1. Dashboard progetti

Passi utente:

1. apre l'app
2. vede progetti esistenti oppure empty state
3. puo' creare, aprire, rinominare, esportare o importare un progetto

Decisioni richieste:

- creare un progetto nuovo o riaprire uno esistente
- capire differenza tra aprire progetto ed esportare progetto

Modali/deviazioni:

- conferma eliminazione progetto
- import file `.imagetool`

Valutazione:

- Chiarezza del passo corrente: buona
- Carico cognitivo: basso
- Priorita' visiva: buona
- Feedback di sistema: buono
- Problema principale: manca una distinzione piu' netta tra "gestione progetto" e "inizio impaginazione"

Note:

- il dashboard e' visivamente convincente e comunica bene l'idea di workspace
- la CTA primaria e' chiara
- il titolo e' forte, ma non racconta cosa succede subito dopo il click su "Nuovo progetto"

## 2. Wizard onboarding

Passi utente:

1. benvenuto
2. nome progetto
3. scelta workflow `auto` o `manuale`
4. caricamento foto
5. selezione foto
6. scelta formato foglio
7. planning, solo in auto
8. anteprima progetto
9. accesso allo studio

Decisioni richieste:

- che workflow scegliere
- quante foto usare
- quale preset foglio usare
- se ragionare per numero fogli o foto per foglio

Modali/deviazioni:

- caricamento foto demo
- folder picker
- photo selector con filtri, rating, pick status e colori

Valutazione:

- Chiarezza del passo corrente: molto buona
- Carico cognitivo: medio ma gestito bene
- Priorita' visiva: buona
- Feedback di sistema: buono
- Accessibilita' operativa: discreta, migliorabile nei comandi della selezione foto

Note:

- il wizard e' il pezzo piu' pedagogico dell'app
- la separazione tra auto e manuale e' corretta
- il photo selector e' potente ma introduce gia' nel wizard un livello "power-user" molto alto

## 3. Setup progetto

Passi utente:

1. esce dal wizard
2. ritrova un secondo layer di riepilogo e configurazione
3. puo' riaprire selezione foto
4. puo' cambiare formato o modalita'
5. puo' aprire impostazioni avanzate
6. puo' entrare nello studio

Decisioni richieste:

- capire se il setup e' ancora obbligatorio o solo facoltativo
- capire cosa conviene modificare qui e cosa invece fare nello studio

Modali/deviazioni:

- photo selector progetto
- sezione avanzata collassabile

Valutazione:

- Chiarezza del passo corrente: bassa
- Carico cognitivo: medio-alto
- Priorita' visiva: debole
- Feedback di sistema: sufficiente
- Problema principale: ridondanza con il wizard

Note:

- oggi il setup appare come un "secondo onboarding" dopo il wizard
- l'utente che ha gia' configurato il progetto deve reinterpretare di nuovo stato, formato e planning
- la sezione avanzata contiene informazioni utili, ma non sono gerarchizzate rispetto all'obiettivo del passo

## 4. Studio layout

Passi utente:

1. entra nello studio
2. vede board, topbar, dock, tab di pagina, ribbon foto, inspector e controlli pagina
3. modifica slot, template, sfondi, bordi, righelli, zoom, fullscreen
4. crea o rimuove fogli
5. lavora sulle immagini libere

Decisioni richieste:

- dove guardare prima
- dove si trova la prossima azione consigliata
- se usare ribbon, tab, dock o controlli della singola pagina
- come distinguere azioni di pagina, slot, output e quality control

Modali/deviazioni:

- crop editor
- slot photo editor
- quick preview foto
- replace modal
- context menu
- conferma cambio template
- conferma eliminazione foglio

Valutazione:

- Chiarezza del passo corrente: media
- Carico cognitivo: alto
- Priorita' visiva: media
- Affordance drag and drop: buona nel modello mentale, incompleta nel feedback
- Recupero errore: discreto
- Accessibilita' operativa: buona su shortcut, debole sulla discoverability

Note:

- lo studio e' potente, ma oggi e' piu' una "control room" che un percorso operativo guidato
- il sistema offre tanti strumenti, ma non rende abbastanza visibile la gerarchia tra "modifica attuale", "stato qualitativo" e "prossimo passo"

## 5. Controllo qualita'

Passi utente:

1. controlla warning
2. guarda statistiche
3. legge activity log
4. interpreta immagini libere e stati pagina

Decisioni richieste:

- capire se il progetto e' davvero pronto
- capire quale foglio richiede attenzione prima

Valutazione:

- Chiarezza del passo corrente: medio-bassa
- Carico cognitivo: medio
- Feedback di sistema: frammentato
- Problema principale: quality control distribuito in pannelli secondari

Note:

- `WarningsPanel`, `QuickStats`, `ResultPanel` e activity log contengono informazioni utili
- il problema non e' l'assenza di segnali, ma il fatto che i segnali sono laterali rispetto al canvas e non guidano la revisione

## 6. Export

Passi utente:

1. apre tab output oppure usa CTA export dalla topbar
2. imposta cartella, formato, quality, preset
3. avvia export fogli oppure PSD
4. legge stato nel modal di progress

Decisioni richieste:

- export normale o PSD
- cartella reale o download browser
- quale preset usare

Valutazione:

- Chiarezza del passo corrente: buona
- Feedback di sistema: buono
- Recupero errore: buono
- Problema principale: la relazione tra "progetto pronto" e "puoi esportare adesso" non e' abbastanza esplicita prima del click

## Percorsi supportati

### Percorso Auto

Sequenza:

1. selezione foto
2. formato foglio
3. criterio fogli o foto per foglio
4. generazione
5. rifinitura in studio
6. export

Valutazione:

- efficace per partire veloce
- meno efficace nel comunicare cosa cambiera' quando si toccano planning e template dopo la generazione

### Percorso Manuale

Sequenza:

1. numero fogli iniziali
2. caricamento e selezione foto
3. ingresso in studio
4. inserimento immagini e gestione pagine
5. rifinitura
6. export

Valutazione:

- coerente con un operatore esperto
- e' anche il percorso piu' adatto a demo e test
- soffre di piu' la densita' dello studio, perche' l'utente deve costruire piu' passaggi da solo

## Findings prioritizzati

## Alta priorita'

### 1. Ridondanza tra wizard e setup

- Fase: onboarding -> setup
- Evidenza: dopo il wizard l'utente atterra in un secondo layer di riepilogo e configurazione invece di entrare direttamente nel lavoro
- Problema osservato: il percorso ha due momenti consecutivi che sembrano entrambi "fase di preparazione"
- Impatto operativo: rallenta l'avvio, genera dubbio su cosa sia gia' stato confermato, aumenta il rischio di modifiche ridondanti
- Causa UX/UI: separazione poco netta tra "decisioni iniziali" e "rifiniture facoltative"
- Raccomandazione: trasformare il setup in checkpoint leggero o pannello opzionale pre-studio; l'uscita naturale del wizard dovrebbe essere lo studio, con un riepilogo compatto e un link a impostazioni avanzate

### 2. Studio troppo denso e con priorita' concorrenti

- Fase: studio layout
- Evidenza: topbar, board, tab pagina, ribbon, controlli header pagina, dock inferiore, inspector e modali condividono lo stesso momento operativo
- Problema osservato: l'utente deve continuamente decidere dove guardare e dove agire
- Impatto operativo: rallenta editing, aumenta i miss-click, rende piu' faticoso insegnare l'app a un nuovo operatore
- Causa UX/UI: troppe superfici di controllo contemporanee senza una gerarchia primaria/secondaria esplicita
- Raccomandazione: definire una struttura a tre livelli chiari: canvas attivo, inspector contestuale, quality/output dock; ridurre comandi sempre visibili e spostare il resto in azioni progressive

### 3. Warning e stato progetto sono fuori dal contesto di lavoro

- Fase: studio -> controllo qualita'
- Evidenza: warning, statistiche e activity sono tab secondari; il canvas non racconta bene quali fogli richiedono attenzione prima
- Problema osservato: il quality control esiste ma non guida il percorso
- Impatto operativo: l'utente esporta senza aver fatto una vera revisione o deve fare scanning manuale di piu' pannelli
- Causa UX/UI: segnali di qualita' separati dal punto in cui si eseguono le correzioni
- Raccomandazione: portare warning e readiness nel contesto del foglio attivo e della navigazione tra fogli; mostrare stato pagina direttamente nei tab o negli header delle pagine

### 4. Microcopy, encoding e naming incoerenti degradano fiducia e leggibilita'

- Fase: trasversale
- Evidenza: presenza di stringhe con encoding errato e terminologia alternata tra `fogli`, `pagine`, `layout`, `studio`, `progetto`
- Problema osservato: il prodotto appare meno rifinito di quanto sia realmente
- Impatto operativo: riduce fiducia, aumenta il carico interpretativo e sporca la percezione professionale del tool
- Causa UX/UI: assenza di revisione sistematica di copy, encoding e glossario
- Raccomandazione: fare un passaggio dedicato di normalizzazione lessicale e di pulizia encoding prima di ulteriori evoluzioni visuali

## Media priorita'

### 5. Il drag and drop ha un buon modello mentale ma feedback incompleto

- Fase: studio layout
- Evidenza: i test E2E coprono bene i gesti critici, ma l'interfaccia non enfatizza abbastanza target, esito e trasformazione risultante
- Problema osservato: trascinare funziona, ma non sempre comunica bene dove conviene droppare e cosa succedera' dopo
- Impatto operativo: riduce velocita' e sicurezza nei task piu' frequenti
- Causa UX/UI: affordance discreta, feedback di hover/drop limitato, esito poco teatralizzato
- Raccomandazione: evidenziare target validi, dare feedback piu' forte sul punto di rilascio e mostrare l'esito con micro-animazione o badge temporaneo

### 6. Il photo selector e' ricco ma troppo "avanzato" dentro il wizard

- Fase: wizard -> selezione foto
- Evidenza: filtri, rating, pick status, colori e shortcut compaiono gia' in un momento in cui l'utente dovrebbe solo confermare il set di lavoro
- Problema osservato: il passo di selezione puo' diventare un mini-tool dentro il wizard
- Impatto operativo: rallenta il primo avvio e sposta attenzione su decisioni secondarie
- Causa UX/UI: il componente e' potente ma non cambia modalita' tra uso onboarding e uso avanzato
- Raccomandazione: semplificare la versione wizard del selector, lasciando i controlli avanzati a un livello espandibile o allo studio

### 7. Il setup comunica riepilogo ma non comunica "prossimo passo"

- Fase: setup
- Evidenza: card e pannelli raccontano stato e configurazione, ma non guidano una singola azione prioritaria
- Problema osservato: il setup sembra un cruscotto, non un checkpoint
- Impatto operativo: aumenta permanenza in una fase che dovrebbe essere breve
- Causa UX/UI: troppi elementi di riepilogo sullo stesso piano della CTA verso lo studio
- Raccomandazione: ripensare il setup come review page breve con 2-3 blocchi essenziali e una CTA dominante

### 8. Il dock inferiore ha contenuti utili ma bassa discoverability

- Fase: studio
- Evidenza: warning, output, attivita' e statistiche sono disponibili, ma il tab attivo non comunica abbastanza il valore degli altri tab
- Problema osservato: l'utente apre quasi solo cio' che gia' conosce
- Impatto operativo: funzioni utili restano sottoutilizzate
- Causa UX/UI: tab poco parlanti e privi di stato
- Raccomandazione: aggiungere badge, contatori, stato attivo e testo di supporto sulle schede piu' importanti

## Bassa priorita'

### 9. Dashboard forte ma poco connessa al lavoro successivo

- Fase: dashboard
- Problema osservato: ottima presenza visiva, ma poco orientamento su cosa succede dopo "Nuovo progetto"
- Raccomandazione: aggiungere una riga operativa sotto CTA o un mini-percorso visuale

### 10. Export ben costruito ma poco legato al concetto di readiness

- Fase: export
- Problema osservato: l'export funziona bene, ma non e' preceduto da un controllo di "pronto / non pronto" ben visibile
- Raccomandazione: introdurre uno stato progetto pre-export con blocchi e warning chiari

## Aree forti da preservare

- wizard guidato, lineare e comprensibile
- orientamento desktop power-user
- drag and drop cross-zona come gesto centrale del prodotto
- editing puntuale per pagina e slot
- presenza di modali dedicate per compiti complessi invece di overload del canvas
- supporto export multiplo e progress modal
- supporto a workflow auto e manuale senza fork architetturale eccessivo

## Backlog di miglioramento

## Quick wins

### 1. Normalizzazione copy ed encoding

- correggere stringhe con caratteri corrotti
- scegliere un glossario unico: `foglio` come unita' operativa, `progetto` come contenitore, `studio` come fase di editing
- riallineare titoli, CTA e helper text

### 2. Rendere il setup un checkpoint leggero

- ridurre le card a riepilogo essenziale
- spostare i controlli avanzati dietro una CTA secondaria
- dare massima evidenza a "Entra nello studio"

### 3. Dare stato ai tab del dock

- badge con numero warning
- badge con count attivita'
- evidenza del tab output quando il progetto non ha ancora destinazione o preset coerente

### 4. Migliorare feedback su drag and drop

- highlight chiaro dei target validi
- stato visibile del target attivo
- conferma visiva di assegnazione appena il drop va a buon fine

### 5. Empty state migliori nello studio

- slot vuoto
- nessun warning
- nessuna foto visibile con filtri attivi
- nessun progetto

## Miglioramenti strutturali di IA/layout

### 6. Accorpare wizard e setup in un flusso piu' lineare

- uscita del wizard verso studio
- setup avanzato come pannello opzionale, non come step quasi obbligatorio

### 7. Ristrutturare lo studio per priorita'

- area 1: canvas e pagine
- area 2: inspector contestuale
- area 3: quality/output

L'utente deve capire in meno di 2 secondi:

- quale foglio sta modificando
- quale slot sta modificando
- se il progetto e' pronto
- quale azione viene consigliata dopo

### 8. Portare il quality control dentro la navigazione pagine

- stato per foglio nei tab
- warning inline nella card pagina
- focus immediato sul primo foglio problematico

### 9. Distinguere modalita' base e avanzata del photo selector

- modalita' semplice nel wizard
- modalita' completa in revisione progetto o studio

## Semplificazioni del flusso

### 10. Ridurre decisioni simultanee in studio

- non mostrare tutte le opzioni di pagina sempre aperte
- rendere secondarie le impostazioni decorative rispetto alle azioni di impaginazione

### 11. Rendere piu' chiaro il passaggio a export

- stato globale progetto: `da rivedere`, `quasi pronto`, `pronto export`
- CTA export accompagnata da readiness summary

## Interventi di copy e feedback

### 12. Riscrivere microcopy operative

- CTA corte e consistenti
- label orientate ad azione
- helper text che dicono cosa succede dopo, non solo cosa fa il campo

### 13. Rendere piu' esplicito l'effetto delle azioni complesse

- cambio template
- rebalance
- elimina foglio
- export PSD vs export fogli

## Redesign guidance

## Flusso target consigliato

### Versione target

1. `Dashboard`
2. `Wizard`
3. `Studio`
4. `Review & Export`

### Comportamento target

- Il wizard resta la vera fase di configurazione iniziale.
- Il setup attuale non sparisce del tutto, ma diventa un pannello "Configurazione avanzata" apribile dallo studio.
- Lo studio diventa il centro unico di lavoro, con una chiara distinzione tra editing e quality control.
- La revisione finale emerge come stato del progetto, non come insieme di tab secondari.

## Layout target dello studio

### Header

- nome progetto
- stato progetto
- CTA principali: `Configura`, `Rivedi`, `Esporta`

### Corpo

- colonna principale: canvas e pagine
- colonna laterale: inspector contestuale a pagina o slot

### Fascia inferiore o laterale secondaria

- warning
- immagini libere
- activity
- output

Questi contenuti devono mantenere visibilita', ma non competere con il canvas durante l'editing normale.

## Principi guida da mantenere

- modello desktop produttivo
- interazione rapida
- drag and drop come gesto principale
- controllo preciso per utenti esperti

## Principi guida da introdurre meglio

- una sola fase primaria per volta
- una sola prossima azione chiara
- feedback di stato piu' vicino all'oggetto modificato
- distinzione netta tra configurare, impaginare, verificare, esportare

## Priorita' suggerita di implementazione

### Fase 1

- fix copy, encoding e naming
- badge/stato nel dock
- feedback drag and drop
- empty state piu' chiari

### Fase 2

- alleggerimento setup
- semplificazione photo selector nel wizard
- warning piu' vicini al foglio attivo

### Fase 3

- ripensamento studio come workspace a priorita' esplicite
- readiness review prima dell'export
- consolidamento del flusso wizard -> studio -> review -> export

## Sintesi finale

`auto-layout-app` non ha un problema di mancanza di funzioni. Ha un problema di orchestrazione. Il prodotto sa gia' fare molto, ma oggi chiede all'utente di assemblare mentalmente il flusso in piu' punti del percorso. L'audit suggerisce quindi di investire meno in nuove superfici e piu' in:

- riduzione della ridondanza
- gerarchia visiva
- stato del progetto
- vicinanza tra problema, azione e feedback

Se questi interventi vengono fatti bene, l'app puo' migliorare molto senza perdere il suo carattere da strumento operativo veloce e potente.
