# Image Select Pro — Audit e test

Questo documento definisce il contratto UX del tool e la matrice minima da ripetere dopo ogni modifica alla navigazione o alla selezione.

## Flusso canonico

1. **Sfoglia**: scelta esplicita tra Selezione libera e Progetto master, oppure ripresa di una cartella recente.
2. **Selezione**: scelta, classificazione e revisione delle foto.
3. **Riepilogo**: vista rapida dello stato della selezione.
4. **Esporta**: export della selezione o di formati secondari.

La diagnostica cartella è un contesto persistente compatto. I dettagli si aprono solo su richiesta. Impostazioni, cache, editor esterno e scorciatoie sono funzioni secondarie.

## Modalità operative

Image Select Pro distingue il modo di aprire le fotografie dal lavoro eseguito sulla selezione. Griglia, confronto, rating, pick, etichette, riepilogo ed export restano disponibili in entrambe le modalità.

| Modalità | Quando usarla | Ambito e persistenza |
|---|---|---|
| **Selezione libera** | Cartelle locali, schede SD, dischi rimovibili o selezioni rapide che non devono diventare un progetto | Non crea né associa un progetto master. La selezione e le classificazioni vengono conservate automaticamente nell’archivio locale dell’app e possono essere salvate e ripristinate manualmente tramite Google Drive; il backup non contiene le fotografie. Gli XMP restano disponibili quando la sorgente è scrivibile. |
| **Progetto master** | Matrimoni, servizi strutturati, lavori con sottocartelle e attività avviate da Archivio Flow | Mantiene un’identità stabile del lavoro, comprende la gerarchia prevista dal master e conserva il flusso progetto esistente. Archivio Flow apre sempre questa modalità. |

### Contratto UX

- La schermata Sfoglia presenta le due modalità come scelte separate, con esempi d’uso e CTA non ambigue.
- “Modalità libera” non significa soltanto scheda SD: è valida per qualsiasi cartella o disco che non debba essere associato a un progetto.
- L’header mostra sempre un badge `Modalità libera` o `Progetto master` quando un lavoro è aperto.
- Rinomina e correzione del master compaiono soltanto per un progetto; Selezione e Riepilogo dipendono invece dall’esistenza di un workspace aperto.
- Il dialogo “Cartella senza progetto” espone l’azione libera soltanto quando il chiamante passa `allowFreeMode=true`. Il percorso proveniente da Archivio Flow mantiene il valore predefinito `false`.
- Le cartelle recenti vengono riaperte con la modalità salvata (`free` o `project`); per i record precedenti privi del campo viene emesso l’intento di compatibilità `resume`.

### Contratto dei componenti

- `FolderBrowser.onFolderOpened(result, intent)` riceve `intent: "free" | "project" | "resume"`. La CTA Selezione libera emette `free`; una cartella recente emette la modalità salvata oppure `resume` per i record legacy.
- `AppHeader.workspaceMode` riceve `"free" | "project" | null`. `lastDriveUrl` è opzionale e, quando presente, rende disponibile il link all’ultimo backup Drive.
- `UnassignedFolderChoice` include `open-free`; `UnassignedFolderModal.allowFreeMode` è opzionale e vale `false` per default.

## Audit automatico

Eseguire dalla root del repository:

    npm run audit:photo-selector

Per rendere il typecheck bloccante:

    powershell -ExecutionPolicy Bypass -File scripts/audit-photo-selector.ps1 -StrictTypecheck

Il controllo statico verifica:

- contratto della navigazione e del Riepilogo rapido;
- presenza della diagnostica richiudibile;
- assenza della diagnostica duplicata nel caricamento;
- raggruppamento degli export secondari;
- assenza di riferimenti a funzioni rimosse;
- regole responsive dell’header;
- stato del typecheck, oggi informativo finché non vengono risolti gli errori preesistenti.

## Matrice manuale

| ID | Scenario | Risultato atteso |
|---|---|---|
| NAV-01 | Avvio senza cartella | Solo Sfoglia è operativa; nessuna diagnostica visibile. |
| NAV-02 | Apertura cartella con foto | L’app entra in Selezione; il caricamento resta non bloccante. |
| NAV-03 | Cambio cartella | Selezione e diagnostica vengono sostituite dalla nuova cartella. |
| NAV-04 | Cartella vuota | Si resta in Sfoglia con messaggio chiaro e diagnostica sintetica. |
| NAV-05 | Riepilogo con selezione | Mostra statistiche e CTA Esporta selezione. |
| NAV-06 | Riepilogo con zero selezioni | Mostra stato vuoto e invito a tornare alla Selezione. |
| FOLDER-01 | Diagnostica chiusa | Mostra solo cartella, numero foto, eventuale avviso e Dettagli. |
| FOLDER-02 | Diagnostica aperta | Mostra i conteggi senza duplicare il pannello di caricamento. |
| FOLDER-03 | Disco con una sottocartella protetta o non leggibile | La sola sottocartella viene saltata; le altre foto si aprono e diagnostica e toast indicano quante cartelle non sono state lette. |
| FILTER-01 | Nessun risultato filtro | Mostra azione evidente per azzerare i filtri. |
| FILTER-02 | Filtri avanzati chiusi/aperti | La riga base resta leggibile; i filtri secondari compaiono solo su richiesta. |
| SELECT-01 | Selezione parziale | Conteggi header, toolbar e fondo pagina coincidono. |
| SELECT-02 | Selezione con filtri attivi | È chiaro se un’azione sostituisce, aggiunge o rimuove foto. |
| SELECT-03 | Da 2 a 4 foto selezionate nella griglia | Compare `Confronta (N)` anche se il progetto contiene selezioni non visibili; la modale rispetta l'ordine della griglia. |
| SELECT-04 | `Ctrl+B` nella griglia | Apre e richiude Confronta; con meno di 2 o più di 4 foto visibili mostra un messaggio operativo. |
| SELECT-05 | Scroll con foto selezionate o colorate | I bordi restano visibili e le ombre diffuse vengono sospese fino al termine dello scroll. |
| BROWSE-01 | Elenco cartelle recenti più alto della finestra | La pagina scorre fino all'ultima cartella mantenendo visibile la testata. |
| MODE-01 | Avvio senza cartella | Selezione libera e Progetto master sono presentati come percorsi distinti, leggibili da tastiera e screen reader. |
| MODE-02 | Apertura con CTA Selezione libera | Il callback riceve intento `free`; l’header mostra `Modalità libera` e non propone rinomina o correzione master. |
| MODE-03 | Creazione o apertura master | L’header mostra `Progetto master`; sottocartelle e azioni progetto restano disponibili. |
| MODE-04 | Apertura proveniente da Archivio Flow | La modalità resta progetto e il dialogo cartella non assegnata non mostra l’azione libera. |
| MODE-05 | Ripresa di una cartella recente | Il callback riceve la modalità salvata; un record legacy riceve `resume` e viene risolto senza perdere il master esistente. |
| MODE-06 | Riuso della stessa scheda con un inventario differente | Lo stato precedente viene riapplicato soltanto ai file invariati verificati tramite chiave sorgente; le altre foto restano senza vecchie classificazioni. |
| MODE-07 | Errore del salvataggio locale libero | L’app non crea file progetto nella sorgente e mostra un solo avviso operativo, senza bloccare la selezione o gli XMP già riusciti. |
| EXPORT-01 | Export principale | Scarica un JSON con il numero corretto di foto attive. |
| EXPORT-02 | Export secondari | Sono disponibili senza occupare la prima riga delle CTA. |
| DRIVE-01 | Backup Drive in modalità libera | Salva selezione e classificazioni, non le fotografie; il link all’ultimo backup compare quando disponibile. |
| DRIVE-02 | Ripristino Drive in modalità libera | Richiede una scelta manuale della versione e non converte la cartella in progetto. |
| LOAD-01 | Anteprime ancora in caricamento | L’utente può continuare a selezionare e può riaprire lo stato caricamento. |
| XMP-01 | Cartella senza scrittura | L’avviso è comprensibile e non blocca la selezione. |
| XMP-02 | Modalità libera su sorgente scrivibile | Rating, pick ed etichette continuano a usare gli XMP secondo la policy esistente. |

## Scheda evidenze

Per ogni regressione annotare:

- ID scenario;
- cartella e numero immagini;
- profilo anteprime;
- stato iniziale della selezione;
- passaggi eseguiti;
- risultato atteso e risultato effettivo;
- screenshot o log desktop;
- severità: bloccante, alta, media, bassa.

## Audit prestazioni e fluidità

Questa sezione raccoglie i colli di bottiglia individuati nel percorso reale di apertura cartella, generazione thumbnail, scroll della griglia e navigazione nella preview. Le priorità indicano l'ordine consigliato di intervento, non la gravità funzionale.

### Difese già presenti

L'implementazione parte da una base solida e non va semplificata eliminando queste protezioni:

- griglia virtualizzata per righe con overscan limitato;
- dispatch degli ID visibili accorpato con `requestAnimationFrame`;
- modalità `scroll-lite`, che sospende ombre, transizioni e animazioni delle card durante lo scroll;
- caricamento iniziale limitato alle prime thumbnail e warmup successivo a blocchi;
- cache thumbnail su disco, cache preview e deduplicazione delle richieste preview in corso;
- import XMP ritardato, progressivo e con concorrenza limitata;
- revoca degli Object URL sostituiti e polling delle modifiche esterne limitato a un massimo di 28 foto.

### Registro dei colli di bottiglia

| ID | Priorità | Area | Evidenza nel codice | Effetto probabile | Intervento consigliato |
|---|---|---|---|---|---|
| PERF-01 | P0 | Coda thumbnail | `ThumbnailPipeline` ordina l'intero array a ogni enqueue/riprioritizzazione e lo consuma con `shift()` | Costo `O(n log n)` durante lo scroll e `O(n)` per ogni estrazione su cartelle molto grandi | Sostituire l'array ordinato con code separate `visible`, `nearby`, `background`, consumate tramite cursore/deque e senza sort globale |
| PERF-02 | P0 | React e thumbnail | Ogni incremento di `thumbnailViewVersion` esegue `allAssets.map(...)`; quando le thumbnail sono disponibili crea un nuovo oggetto per ogni asset. `PhotoSelector` ricostruisce poi `assetById` da tutto l'array | Allocazioni e scansioni `O(n)` a ogni batch thumbnail; possibile GC e micro-lag anche se le card sono memoizzate | Passare gli asset base invariati e sottoscrivere ogni card alla sola thumbnail del proprio ID, oppure materializzare le view esclusivamente per gli ID renderizzati |
| PERF-03 | P0 | Concorrenza | Thumbnail, preview, RAW warmup e XMP hanno limiti indipendenti basati in parte su `hardwareConcurrency` | Saturazione simultanea di disco, decoder nativi e IPC; una foto appena visibile può attendere task background già avviati | Introdurre uno scheduler condiviso con budget per tipo di lavoro, slot riservati al viewport e pausa del background durante interazione |
| PERF-04 | P1 | Preview fullscreen | La preview riceve l'array foto rimaterializzato; filtri, indice, gruppi e navigazione possono essere ricalcolati mentre le thumbnail background continuano | Navigazione meno stabile nelle cartelle grandi e render inutili dietro la modale | Rendere stabili gli asset metadata durante il caricamento thumbnail e sospendere i commit non visibili mentre preview o confronto sono aperti |
| PERF-05 | P1 | CSS/compositing | Quick preview e confronto applicano `backdrop-filter: blur(6px)` su tutta la finestra | Il compositor deve rielaborare la griglia sottostante a ogni aggiornamento; costo particolarmente inutile con overlay quasi opaco | Rimuovere il blur fullscreen o abilitarlo solo su superfici piccole; usare un fondo opaco o semiopaco equivalente |
| PERF-06 | P1 | Animazioni card | Le animazioni di feedback vengono riavviate leggendo `offsetWidth` su ogni card | Forced synchronous layout; nelle classificazioni batch più card possono alternare letture e scritture di layout | Riavviare l'animazione tramite token/keyframe Web Animations API o classi con generazione, senza letture forzate del layout |
| PERF-07 | P1 | Priorità viewport | Ogni cambio degli ID visibili può attraversare e riordinare tutta la coda, quindi il throttling a un frame non limita il costo del singolo aggiornamento | Picchi sul main thread durante scroll rapido, soprattutto con migliaia di miss in cache | Aggiornare soltanto gli ID entrati/usciti dal viewport e mantenere le priorità per bucket |
| PERF-08 | P2 | CSS/GPU | Ogni wrapper immagine usa sempre `transform: translateZ(0)` oltre a `contain: layout paint` | Possibile proliferazione di layer GPU e memoria su viewport densi o schermi ad alta risoluzione | Misurare layer count e memoria GPU; mantenere `contain`, applicare la promozione solo alle card che animano se il benchmark conferma il costo |
| PERF-09 | P2 | UI hover | Il passaggio del mouse monta/smonta la toolbar completa della card e avvia il preload della preview | Render e decode inutili quando il puntatore attraversa rapidamente più card senza intenzione di aprirle | Aggiungere hover intent breve, annullabile, e avviare il preload solo dopo la soglia o su focus intenzionale |
| PERF-10 | P2 | Filtri e gruppi | Ordinamento, filtri, mappe dei gruppi e opzioni filtro percorrono l'intero dataset; alcuni dati di gruppo vengono calcolati in passaggi separati | Pausa percepibile al cambio filtro, ordinamento o import metadata su cartelle molto grandi | Costruire un indice metadata incrementale e fondere i passaggi di aggregazione; valutare un worker solo dopo il profiling |
| PERF-11 | P2 | XMP | Ogni blocco può copiare l'intero array asset con `prev.slice()` e compete con le letture thumbnail sullo stesso storage | Picchi periodici di allocazione e I/O durante la navigazione iniziale | Applicare patch metadata per ID e far avanzare XMP soltanto quando la coda interattiva è vuota |
| PERF-12 | P3 | Cache | Le cache decoded image e quick preview sono limitate a 64 elementi, indipendentemente dalle dimensioni reali | Su file grandi 64 elementi possono occupare troppa memoria; su thumbnail piccole possono essere troppo pochi e causare churn | Usare un budget approssimativo in byte e separare le quote per thumbnail, fit preview e detail preview |

Nota: il polling delle modifiche esterne e la gestione degli Object URL non risultano oggi prioritari. Il codice limita frequenza e numero di target e contiene già cleanup espliciti; vanno promossi di priorità soltanto in presenza di crescita memoria misurata.

### Rischi CSS e UI da verificare

- Le ombre colorate delle card sono già disabilitate durante lo scroll: mantenerle fuori dalla prima fase di ottimizzazione.
- La transizione di `grid-template-columns` della quick preview forza layout per tutta la durata dell'animazione. Se il toggle focus mostra frame irregolari, sostituirla con una trasformazione della sidebar e un cambio layout istantaneo.
- I blur su header, menu e toast hanno superfici ridotte e sono secondari rispetto ai blur fullscreen.
- `prefers-reduced-motion` disattiva correttamente animazioni e parte dei blur, ma non rappresenta il percorso standard da ottimizzare.
- La virtualizzazione CSS con `content-visibility` è volutamente disattivata perché in precedenza causava jitter della scrollbar; non riattivarla sopra la virtualizzazione a righe senza un test dedicato.

## Piano operativo prestazioni

### Fase 0 — Baseline ripetibile

Registrare per ogni prova:

- dataset da circa 300, 3.000 e 20.000 immagini;
- mix JPEG, RAW e RAW+JPEG;
- cache fredda e cache calda;
- NVMe locale, storage USB e percorso di rete quando disponibile;
- profilo thumbnail selezionato e dimensione della card;
- p50/p95 della latenza thumbnail visibile e della preview;
- long task oltre 50 ms, frame persi, durata massima frame e memoria renderer;
- lunghezza delle code e task attivi distinti per thumbnail, preview, RAW e XMP.

Obiettivi iniziali, da calibrare dopo la prima baseline:

- nessun long task ripetitivo durante 10 secondi di scroll continuo;
- input-to-paint p95 sotto 50 ms per selezione e classificazione;
- nessuna crescita continua della memoria dopo tre cicli apertura/chiusura cartella;
- una richiesta viewport non deve restare dietro a lavoro background già accodato.

### Fase 1 — Percorso critico

1. Implementare PERF-01 e PERF-07 con code a bucket e aggiornamenti incrementali del viewport.
2. Implementare PERF-02 eliminando la materializzazione globale delle thumbnail a ogni batch.
3. Implementare PERF-03 con un budget condiviso e slot interattivi riservati.
4. Ripetere la baseline prima di intervenire su CSS o cache.

### Fase 2 — Fluidità UI

1. Eliminare i blur fullscreen di PERF-05 e misurare preview e confronto.
2. Rimuovere i forced layout di PERF-06.
3. Introdurre hover intent per PERF-09.
4. Verificare PERF-08 con layer count e memoria GPU prima di cambiare `translateZ(0)`.

### Fase 3 — Dataset grandi e background

1. Ridurre le scansioni complete di PERF-10 con indici metadata incrementali.
2. Coordinare e rendere incrementali le patch XMP di PERF-11.
3. Convertire le cache a budget in byte soltanto dopo aver misurato hit rate e picco memoria.

### Fase 4 — Regressione automatica

Ogni test prestazionale aggiunto deve essere eseguibile dalla FileX Dev Console. Il test deve avere uno script root `test:*`, una categoria Image Select Pro e una descrizione che specifichi dataset, metrica e regressione rilevata.

## Matrice manuale prestazioni

| ID | Scenario | Risultato atteso |
|---|---|---|
| PERF-GRID-01 | Scroll continuo con 20.000 foto e cache fredda | La scrollbar resta stabile; le thumbnail visibili superano sempre il background; nessun blocco prolungato del puntatore. |
| PERF-GRID-02 | Scroll avanti e immediato ritorno indietro | Le foto appena rivisitate arrivano dalla cache senza nuova coda duplicata. |
| PERF-GRID-03 | Cambio rapido di dimensione card | Nessuna tempesta di sort/riprioritizzazione e nessun salto persistente della posizione. |
| PERF-FILTER-01 | Ricerca digitata rapidamente su 20.000 foto | L'input resta fluido e viene applicato soltanto il valore differito più recente. |
| PERF-FILTER-02 | Cambio ordinamento con caricamento thumbnail attivo | L'ordine non oscilla a ogni thumbnail e l'interazione resta disponibile. |
| PERF-PREVIEW-01 | Navigazione rapida avanti/indietro per 30 foto | Nessun flash di una foto precedente; i task obsoleti non rallentano la foto corrente. |
| PERF-PREVIEW-02 | Apertura preview mentre la griglia è ancora in caricamento | La preview mantiene frame regolari e il background riduce automaticamente la propria attività. |
| PERF-UI-01 | Classificazione batch di tutte le card visibili | Nessun forced layout ripetuto e feedback visivo sincronizzato. |
| PERF-UI-02 | Movimento rapido del mouse sopra la griglia | Nessuna sequenza di decode o mount toolbar per hover involontari. |
| PERF-CSS-01 | Apertura/chiusura quick preview e confronto su GPU integrata | Nessun picco evidente del compositor e nessuna coda di frame dopo la chiusura. |
| PERF-MEM-01 | Tre aperture successive di cartelle diverse | La memoria torna vicino alla baseline dopo cleanup e garbage collection naturale. |

## Audit del tab Impostazioni — Prestazioni e cache

Verifica statica completata sull'intera catena UI → preferenze → preload Electron → IPC → servizi nativi. L'esito distingue il funzionamento nominale dai limiti che possono rendere il dato mostrato incompleto o l'azione diversa da quanto l'utente si aspetta.

### Esito per controllo

| Controllo | Esito | Comportamento verificato | Limite o difetto rilevato |
|---|---|---|---|
| Profilo anteprime | Funzionante con limiti | Persiste nel database desktop; aggiorna dimensione, qualità e opzioni della pipeline attiva; invalida viewport e priorità; modifica subito i limiti della quick preview | Le thumbnail non visibili già completate restano nel vecchio profilo fino alla riapertura; i task nativi già partiti non sono cancellati realmente |
| Sort cache | Funzionante | Persiste il toggle; abilita/disabilita hydration, lettura e salvataggio dell'ordine; la firma include i dati rilevanti per il tipo di sort | Il cache hit evita il sort ma richiede comunque firma e validazione `O(n)`; manca un comando per pulire la sort cache |
| Auto-advance | Funzionante | Persiste e viene condiviso tra griglia e quick preview | Non è un controllo prestazionale; correttamente non modifica cache o pipeline |
| Stato GPU | Funzionante, informativo | Deriva dai dati Electron reali per compositing, WebGL, raster e dispositivo | Non è un interruttore: il tab non può abilitare o disabilitare la GPU |
| Metriche cartella | Parzialmente funzionante | Tempi prima thumbnail/griglia, hit della cartella e byte letti vengono aggiornati e persistiti | Le statistiche native della cache disco e `RAW render cache hit` vengono lette soprattutto all'avvio o dopo azioni manuali, quindi diventano obsolete durante la sessione |
| Budget RAM | Funzionante con difetti UI | Il preset viene applicato live al servizio nativo, salvato separatamente e ripristinato prima delle prime richieste thumbnail al riavvio | Ridurre il budget non forza il trim immediato delle cache esistenti; un fallimento viene assorbito senza feedback; dopo alcune operazioni percorso la sezione può sparire perché la risposta IPC non include i limiti RAM |
| Percorso cache — Applica | Funzionante ma non migra | Valida/crea la nuova directory, salva il percorso e la usa per le richieste successive | I file nel vecchio percorso restano orfani; il testo del pannello può far pensare che vengano spostati |
| Percorso cache — Sfoglia | Funzionante ma non migra | Apre il selettore nativo e cambia directory | Stesso limite di `Applica`: non copia né elimina la cache precedente |
| Percorso consigliato | Funzionante con rischio concorrenza | Copia cache, verifica il target, cambia percorso e prova a rimuovere la sorgente | Nessuna pausa delle scritture thumbnail: durante caricamento possono comparire file mancanti, riscritti o lasciati nel vecchio percorso; manca avanzamento e annullamento per cache grandi |
| Ripristina Default | Funzionante ma non pulisce | Rimuove il percorso personalizzato e torna alla directory predefinita | Non migra e non rimuove la cache personalizzata precedente |
| Svuota cache | Parzialmente funzionante | Elimina e ricrea l'intera directory attiva, quindi rimuove sia `.thumb` sia `.preview` su disco | Non pulisce cache RAM, frame quick preview o view renderer; scritture attive possono ricreare file subito dopo lo svuotamento |
| Suggerimento percorso | Funzionante | Controlla spazio e volume su Windows; snooze vale per la sessione; dismiss è persistente | La scansione volumi può aggiungere lavoro all'avvio; non sostituisce una policy di limite della cache |

### Difetti confermati da correggere

| ID | Priorità | Difetto | Correzione attesa |
|---|---|---|---|
| SETTINGS-01 | P0 | `get-thumbnail-cache-info` aggiunge i limiti RAM, mentre choose/set/reset/migrate restituiscono il solo oggetto della cache disco. Dopo queste azioni `systemTotalMemoryBytes` e i limiti effettivi spariscono dallo stato UI | Normalizzare tutte le risposte IPC con una singola funzione che unisca cache disco e limiti RAM |
| SETTINGS-02 | P0 | La cache su disco non ha limite massimo, TTL o eviction. I cambi profilo/dimensione generano chiavi diverse e fanno crescere il numero di file indefinitamente | Aggiungere budget disco configurabile, LRU/last-access approssimato e pruning incrementale in background |
| SETTINGS-03 | P1 | Dimensione cache e contatore RAW hit non vengono aggiornati mentre l'app genera o usa anteprime | Aggiornare metriche a intervalli leggeri solo quando Impostazioni è aperto, oppure pubblicare contatori incrementali senza scansione directory |
| SETTINGS-04 | P1 | `summarizeCacheDirectory` esegue un `lstat` sequenziale per ogni file e viene richiamato anche durante inizializzazione e cambi impostazione | Conservare un indice/contatore persistente o calcolare le statistiche a blocchi con cache e invalidazione |
| SETTINGS-05 | P1 | Svuotamento e migrazione non coordinano le scritture cache attive | Introdurre lock/generazione della cache: pausa nuove scritture, attesa delle due in corso, operazione atomica, ripresa sul nuovo percorso |
| SETTINGS-06 | P1 | “Svuota cache” non invalida cache RAM/native/renderer e può mostrare successo pur lasciando dati servibili dalla sessione | Esporre un'operazione unica che pulisca disco, memoria nativa, token quick preview, image cache renderer e thumbnail view applicabili |
| SETTINGS-07 | P2 | Salvataggi preferenze e preset RAM assorbono gli errori; alcuni controlli aggiornano ottimisticamente la UI senza conferma persistente | Restituire un risultato esplicito, mostrare errore e ripristinare il valore precedente in caso di fallimento |
| SETTINGS-08 | P2 | Applica, Sfoglia e Default cambiano directory senza gestire la cache precedente | Distinguere chiaramente “Cambia percorso” da “Migra cache” e offrire una scelta per eliminare il vecchio contenuto |
| SETTINGS-09 | P2 | Abbassare il budget RAM aggiorna i limiti ma non riduce immediatamente le cache già sopra soglia | Eseguire il trim subito dopo l'applicazione, preservando gli elementi più recenti e i frame attualmente referenziati |

### Verifiche eseguite

- `npm run audit:photo-selector`: superato, inclusi controlli GPU, budget RAM e typecheck.
- `npm run test:photo-selector-workflow`: superato.
- `npm --workspace @photo-tools/photo-selector-app run build`: superato con Vite 6.3.5 e 81 moduli trasformati.
- La build segnala un bundle JavaScript di circa 503 kB non compresso: non blocca il tab Impostazioni, ma va incluso nel successivo audit del tempo di avvio.

Non esiste ancora un test automatico end-to-end che cambi realmente percorso, migri file, riduca il budget RAM, riavvii Electron e verifichi la persistenza. Finché tale test non viene aggiunto alla Dev Console, la verifica runtime completa resta manuale.

### Matrice manuale Impostazioni

| ID | Scenario | Risultato atteso |
|---|---|---|
| SETTINGS-MAN-01 | Cambiare profilo con thumbnail ancora attive | Le foto visibili vengono rigenerate con il nuovo profilo senza duplicazioni o blocchi; al riavvio il profilo resta selezionato. |
| SETTINGS-MAN-02 | Disabilitare e riabilitare Sort cache | Il primo sort senza cache produce lo stesso ordine del successivo cache hit; il toggle resta persistente. |
| SETTINGS-MAN-03 | Selezionare ciascun preset RAM e riavviare | Il preset, i byte dichiarati e i limiti effettivi coincidono prima e dopo il riavvio. |
| SETTINGS-MAN-04 | Ridurre RAM da Massimo a Conservativo | La memoria cache scende al nuovo limite senza attendere nuove allocazioni e senza invalidare frame in uso. |
| SETTINGS-MAN-05 | Cambiare percorso con cache popolata | La sezione Budget RAM resta visibile e i valori non diventano `null`; nuove thumbnail finiscono soltanto nel nuovo percorso. |
| SETTINGS-MAN-06 | Migrare cache durante caricamento attivo | Nessun file viene perso o ricreato nel percorso vecchio; la UI mostra avanzamento e resta coerente. |
| SETTINGS-MAN-07 | Svuotare cache durante una cartella aperta | Disco e RAM vengono azzerati; la UI aggiorna subito conteggi e le anteprime necessarie vengono rigenerate in modo controllato. |
| SETTINGS-MAN-08 | Simulare directory non scrivibile | L'impostazione precedente resta attiva e viene mostrato un errore operativo. |
| SETTINGS-MAN-09 | Accumulare cache di più profili fino al limite | Il pruning mantiene il budget disco e non rimuove file attualmente in uso. |

## Stato implementazione prestazioni e Impostazioni (2026-08-28)

Il piano sopra è stato applicato al codice. La tabella mantiene il collegamento tra i rischi rilevati e le difese ora presenti.

| Area | Stato implementato | Verifica automatica |
| --- | --- | --- |
| PERF-01 / PERF-07 | `ThumbnailPipeline` e `PreviewWarmupPipeline` usano bucket indicizzati con promozione per ID; non eseguono più `sort()`, `shift()` o scansioni complete della coda durante lo scroll. | `test:photo-selector-performance`, incluso scenario sintetico da 50.000 entry. |
| PERF-02 / PERF-04 | Le thumbnail sono pubblicate tramite store per-ID e `useSyncExternalStore`; gli asset metadata passati a `PhotoSelector` restano stabili durante i batch. | Test notifiche isolate e controllo anti-rimaterializzazione globale. |
| PERF-03 / PERF-11 | Thumbnail, preview e XMP condividono un coordinatore con due slot riservati ai lavori interattivi e priorità promuovibili. | Test deterministico di riserva, ordine e promozione. |
| PERF-05 / PERF-06 / PERF-08 / PERF-09 | Rimossi blur fullscreen, transizione di `grid-template-columns`, forced reflow e `translateZ(0)` permanente; aggiunto hover intent annullabile da 90 ms. | Controlli statici CSS/DOM più strict typecheck. |
| PERF-10 | Asset map, testo di ricerca e conteggi serie/tempo/label sono costruiti in un singolo indice metadata; confronto e conteggi selezione percorrono gli ID selezionati. | Strict typecheck e invarianti della suite prestazioni. |
| PERF-12 / SETTINGS-01..09 | Budget disco 2/8/24 GB o illimitato, pruning LRU approssimato, statistiche concorrenti e cacheate, gate scritture/migrazione, migrazione automatica, trim RAM immediato, pulizia disco+RAM+quick preview e risposte IPC uniformi. | Test policy/gate, build shell Electron e controlli di wiring IPC. |
| QUICK-PAN-01 | Il trascinamento della foto zoomata aggiorna `transform` direttamente in un solo `requestAnimationFrame`, conserva la posizione in un ref e sincronizza React soltanto al rilascio; i limiti usano il viewport osservato senza letture layout nel `pointermove`. Il `ResizeObserver` viene collegato anche quando la foto arriva dopo il mount, evitando limiti bloccati a zero. La preview detail viene sospesa durante il pan e decodificata in modo asincrono; il drag nativo della foto resta disabilitato finche lo zoom e attivo. | `test:photo-selector-performance`, audit `QUICK-005..010` e build dell'app. |
| QUICK-RAW-01 | Lo sfogliamento usa un warmup direzionale limitato a tre foto invece di sette richieste concorrenti. La shell prepara i RAW in sequenza e interrompe le code obsolete quando cambia nuovamente la foto, lasciando libera la capacita di decodifica per la preview corrente. | `test:photo-selector-performance`, audit `QUICK-011..012`, build frontend e build shell Electron. |
| CACHE-DEV-01 | La shell avviata con `FILEX_RENDERER_MODE=dev` usa `%LOCALAPPDATA%\FileX\Development\ThumbnailCache` e `desktop-settings.dev.json`; release installata e sviluppo non condividono piu percorso personalizzato, budget, contatori o invalidazioni. | `test:photo-selector-performance`, audit `PERF-003..004` e build shell Electron. |
| SETTINGS-FEEDBACK-01 | Le modifiche al budget RAM e al limite disco mostrano un toast con preset e dimensione effettivamente restituiti dalla shell; lo stesso esito resta visibile nel tab Impostazioni tramite uno stato accessibile `aria-live`. Testo fisso e conferme dichiarano che RAM, profilo anteprime, limite e percorso cache diventano attivi subito e non richiedono riavvio. | `test:photo-selector-performance`, audit `PERF-005..008` e build dell'app. |

Comando canonico:

```powershell
npm run test:photo-selector-performance
```

Il test è disponibile anche nella FileX Dev Console, categoria **Image Select Pro**. La matrice manuale resta necessaria per misurare frame time, memoria GPU e comportamento con hardware/fotografie reali; non è sostituita dai test deterministici.
