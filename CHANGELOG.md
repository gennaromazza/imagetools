# Changelog

<!--
  FORMATO OBBLIGATORIO PER GLI HEADER DI VERSIONE "FileX Suite"
  ================================================================
  release-filex-suite.bat legge automaticamente da qui la versione piu
  recente della FileX Suite: cerca la prima riga che rispetta ESATTAMENTE
  questo pattern (regex, ancorata a inizio riga):

      ^## YYYY-MM-DD - FileX Suite X.Y.Z

  Esempio valido:
      ## 2026-08-19 - FileX Suite 0.1.38

  Regole da rispettare quando si aggiunge una nuova entry (umano o AI):
  1. Data in formato YYYY-MM-DD.
  2. Nome prodotto ESATTAMENTE "FileX Suite" (case-sensitive). NON usare
     varianti tipo "Filex Suite", "FileX-Suite", "Suite FileX": lo script
     non le riconoscerebbe e tornerebbe al prompt manuale.
  3. Versione in formato semver semplice X.Y.Z. Niente prefisso "v",
     niente suffissi pre-release come "-beta.1" (lo script li scarta).
  4. Le entry degli altri tool del monorepo (FileX Backup Guard, FileX
     Send, ecc.) NON devono contenere la stringa "FileX Suite" nel loro
     header, altrimenti verrebbero lette per errore al posto della Suite.
  5. Le nuove entry vanno sempre aggiunte in cima al file, subito sotto
     questo commento: lo script prende la PRIMA corrispondenza trovata,
     quindi l'ordine cronologico decrescente e' essenziale.

  Se questo formato cambia, aggiornare anche la regex corrispondente in
  release-filex-suite.bat, sezione "4. Richiesta nuova versione".
-->

## 2026-08-25 - FileX Suite 0.1.50

### Installer Windows più affidabili
- La Suite verifica che l'installer del tool sia stato realmente avviato da Windows dopo la richiesta a SmartScreen/UAC.
- Se Windows non apre l'installer, l'aggiornamento termina entro 30 secondi con un messaggio operativo invece di restare bloccato su "Conferma su Windows...".

## 2026-08-25 - FileX Suite 0.1.49

### Aggiornamenti affidabili dei tool
- La Suite chiede ora al solo tool selezionato di chiudersi in modo cooperativo, lasciandogli il tempo di rilasciare file e processi figli prima dell'installazione.
- Se il tool è una versione precedente, resta disponibile il fallback compatibile limitato al suo eseguibile e ai nomi legacy dichiarati, senza chiudere FileX Suite.
- Gli installer Windows hanno un'identità NSIS separata per componente: un aggiornamento tool non può più usare il disinstallatore storico della Suite.

## 2026-08-25 - FileX Backup Guard 0.2.4

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - FileX Send 0.1.14

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - FileX Adobe Cleaner 0.1.3

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - Trova Foto da Lista 0.1.3

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - Image Converter 0.1.3

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - Archivio Flow 0.1.36

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - Batch Print Layout 0.1.3

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - Image Party Frame 0.1.28

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - Image Select Pro 0.1.30

- Aggiunta la chiusura cooperativa richiesta dalla Suite prima dell'aggiornamento, con fallback sicuro per le installazioni precedenti.

## 2026-08-25 - Archivio Flow 0.1.35

- Miniature ricaricate correttamente al cambio data, con coda annullabile, cache più veloce e anteprime incorporate per i file RAW.
- Durante l'aggiunta a un lavoro esistente vengono mostrate le cartelle foto/video già presenti, con suggerimenti contro la creazione di nomi duplicati o molto simili.
- Al termine di un'importazione con foto e video si aprono automaticamente entrambe le cartelle di destinazione per consentire una verifica immediata.

## 2026-08-25 - Archivio Flow 0.1.34

- La rimozione della SD non chiude più Archivio Flow: l'app resta disponibile nell'area di notifica e torna automaticamente alla schermata archivio.
- Il conteggio dei file filtrati per data viene calcolato subito, senza mostrare temporaneamente il totale errato della scheda.
- Destinazione automatica, riepilogo e avanzamento mostrano ora lo stesso percorso effettivo, evitando indicazioni discordanti tra categorie.

## 2026-08-25 - Archivio Flow 0.1.33

- Rilevamento automatico della sostituzione delle SD, aggiornamento della schermata, pulsanti di aggiornamento ed espulsione sicura.
- Anteprime SD scorrevoli con caricamento graduale e miniature più leggere per foto e video.
- Importazione dell'intera SD oppure per data rilevata automaticamente, con il filtro trasferito alla copia dei file.

## 2026-08-24 - FileX Send 0.1.13

- Download multipli diretti per i clienti, con supporto a file di grandi dimensioni e sessioni attive preservate.

## 2026-08-24 - FileX Suite 0.1.48

### Correzione aggiornamenti tool
- Corretto l'errore `toolName is not defined` che poteva interrompere l'aggiornamento di un tool dalla Suite quando era necessario mostrare la finestra di chiusura forzata.

## 2026-08-24 - FileX Send 0.1.12

- Corretto il percorso del logo nell’app pubblicata per garantirne la visualizzazione anche nel pacchetto installato.

## 2026-08-24 - FileX Send 0.1.11

- Drag and drop e selezione ricorsiva di file e cartelle, storico ricercabile e cancellabile, modifica della scadenza dei link e interfaccia aggiornata.

## 2026-08-24 - FileX Suite 0.1.47

### Aggiornamento della Suite
- Esteso il controllo di chiusura dei processi anche all'aggiornamento di FileX Suite.
- Se un tool impedisce l'installazione della Suite, viene mostrato il pulsante “Forza chiusura” direttamente nella Suite, senza richiedere operazioni manuali in Windows.
- Aggiornato il messaggio degli update dei tool per indirizzare l'utente al pulsante di chiusura assistita.

## 2026-08-24 - FileX Suite 0.1.46

### Aggiornamenti e affidabilità
- FileX Suite controlla periodicamente gli aggiornamenti dei tool anche in background e mostra una notifica Windows quando sono disponibili nuove versioni.
- Aggiunto un riepilogo centrale degli aggiornamenti nella Suite, con accesso diretto ai tool da aggiornare.
- Se un tool non si chiude automaticamente prima dell'installazione, la Suite propone il pulsante “Forza chiusura”, senza richiedere Gestione attività o la tray di Windows.
- Dopo una chiusura forzata e l'aggiornamento riuscito, la Suite prova a riaprire automaticamente il tool.

## 2026-08-24 - Archivio Flow 0.1.32

- Aggiunta la schermata Photo First alla lettura della SD, con conteggi distinti di foto e video, verifica di sicurezza e avvio del flusso di importazione.
- Le miniature dei video vengono generate progressivamente con FFmpeg e cache locale; importazione foto e video è organizzata in destinazioni separate.
- Migliorati importazione su lavori esistenti, conteggio preventivo dei file, avanzamento, impostazioni richiudibili, avvio con Windows e collegamento diretto a Backup Guard.

## 2026-08-22 - Archivio Flow 0.1.31

- Riorganizzato il flusso di importazione: archivio iniziale, import guidato, aggiunta rapida dei file e cronologia delle ultime importazioni.

## 2026-08-22 - FileX Suite 0.1.45

### Piattaforma e distribuzione
- completata la preparazione coordinata delle nuove release stabili della Suite e di tutti i tool FileX
- aggiornati i flussi commerciali e l'area account del sito FileX, con test automatici per API, PayPal e rilascio dei componenti

## 2026-08-22 - Image Select Pro 0.1.29

- Pubblicazione coordinata di manutenzione con catalogo stabile e checksum dell'installer verificati.

## 2026-08-22 - Image Party Frame 0.1.27

- Pubblicazione coordinata di manutenzione con catalogo stabile e checksum dell'installer verificati.

## 2026-08-22 - Batch Print Layout 0.1.2

- Pubblicazione coordinata di manutenzione con catalogo stabile e checksum dell'installer verificati.

## 2026-08-22 - Archivio Flow 0.1.30

- Pubblicazione coordinata di manutenzione con catalogo stabile e checksum dell'installer verificati.

## 2026-08-22 - Image Converter 0.1.2

- Pubblicazione coordinata di manutenzione con catalogo stabile e checksum dell'installer verificati.

## 2026-08-22 - Trova Foto da Lista 0.1.2

- Pubblicazione coordinata di manutenzione con catalogo stabile e checksum dell'installer verificati.

## 2026-08-22 - FileX Adobe Cleaner 0.1.2

- Pubblicazione coordinata di manutenzione con catalogo stabile e checksum dell'installer verificati.

## 2026-08-22 - FileX Send 0.1.10

- Aggiornati i flussi di licenza, pagamento e gestione account collegati al servizio FileX Send.

## 2026-08-22 - FileX Backup Guard 0.2.3

- Pubblicazione coordinata di manutenzione con catalogo stabile e checksum dell'installer verificati.

## 2026-08-22 - Archivio Flow 0.1.29

- Aggiornamenti e correzioni del componente.

## 2026-08-22 - Archivio Flow 0.1.28

- Aggiornamenti e correzioni del componente.

## 2026-08-22 - FileX Send 0.1.9

- Aggiornamenti e correzioni del componente.

## 2026-08-22 - FileX Send 0.1.8

- Aggiornamenti e correzioni del componente.

## 2026-08-22 - FileX Send 0.1.7

- Aggiornamenti e correzioni del componente.

## 2026-08-22 - FileX Send 0.1.6

- Aggiornamenti e correzioni del componente.

## 2026-08-22 - FileX Send 0.1.5

- recupero automatico delle sessioni Internet attive e supporto per qualsiasi tipo di file

## 2026-08-21 - FileX Suite 0.1.44

### Aggiornamento dei tool
- prima di aggiornare un tool gia installato, la Suite avvisa che chiudera il tool automaticamente e indica di chiudere anche FileX Suite se l'installer rileva ancora un processo aperto
- la pipeline verifica correttamente gli installer di Batch Print Layout, Image Converter e Trova Foto da Lista, mostrando un errore esplicito per eventuali componenti non supportati
- aggiunto un controllo automatico che confronta tutti i componenti pubblicabili del workflow con quelli supportati dal verificatore, impedendo di aggiungere nuovi tool senza aggiornare anche la verifica dell'installer

## 2026-08-21 - FileX Suite 0.1.43

### Distribuzione e licenze
- corretta la licenza offline firmata: non viene piu mostrata come attiva se non puo' avviare i tool, mentre un'attestazione valida ripristina correttamente l'uso offline
- la cache degli installer elimina i download FileX conclusi o falliti non piu' in uso, senza toccare aggiornamenti attivi
- il catalogo incluso conserva le release tool piu' recenti se il catalogo remoto e' temporaneamente arretrato; ripristinati Adobe Cleaner e Image Select Pro aggiornato
- consentita la pubblicazione senza certificato: la firma si abilita automaticamente quando i secret sono configurati e, in alternativa, l'installer viene aperto visibilmente per permettere la conferma di SmartScreen
- la Suite attende fino a cinque minuti la versione realmente installata e indica chiaramente quando confermare l'avviso di sicurezza di Windows; anche il proprio aggiornamento apre l'installer in modalita visibile

### Dev Console e release indipendenti
- aggiunta la pubblicazione controllata di ogni tool dal pannello Dev, con stato del workflow GitHub e stop selettivo
- il pannello riconosce correttamente le release storiche dai loro asset, senza confondere un tag generico della Suite con una versione gia' pubblicata di un tool
- completata la pipeline per Batch Print Layout, Image Converter e Trova Foto da Lista
- preparate le nuove patch di tutti i tool con note di release e changelog dedicati

## 2026-08-21 - FileX Dev Console

- la release Suite viene proposta soltanto quando il changelog contiene una versione piu nuova dell'ultima pubblicata; rimossa la generazione automatica di patch inesistenti
- campo versione e pulsante di pubblicazione restano disabilitati finche non viene aggiunta una nuova voce FileX Suite al changelog
- la verifica remota delle release ritenta errori HTTP temporanei come 504, elimina i download parziali e controlla nuovamente feed, catalogo e checksum prima di dichiarare un fallimento

## 2026-08-21 - Image Select Pro 0.1.28

- riallineati catalogo stabile e checksum; l'installer non firmato viene confermato tramite l'interfaccia di sicurezza di Windows

## 2026-08-21 - Image Party Frame 0.1.26

- pubblicazione di manutenzione con checksum verificato e installazione visibile su Windows

## 2026-08-21 - Batch Print Layout 0.1.1

- installer Windows avviato visibilmente dalla Suite per consentire la conferma di sicurezza

## 2026-08-21 - Archivio Flow 0.1.27

- pubblicazione di manutenzione con checksum verificato e installazione visibile su Windows

## 2026-08-21 - Image Converter 0.1.1

- installer Windows avviato visibilmente dalla Suite per consentire la conferma di sicurezza

## 2026-08-21 - Trova Foto da Lista 0.1.1

- installer Windows avviato visibilmente dalla Suite per consentire la conferma di sicurezza

## 2026-08-21 - FileX Adobe Cleaner 0.1.1

- ripristinata la distribuzione nel catalogo stabile con checksum verificato

## 2026-08-21 - FileX Send 0.1.4

- pubblicazione di manutenzione con checksum verificato e installazione visibile su Windows

## 2026-08-21 - FileX Backup Guard 0.2.2

- pubblicazione di manutenzione con checksum verificato e installazione visibile su Windows

## 2026-08-20 - FileX Suite 0.1.42

### Dev Console: test e qualità progetto
- riorganizzata la sezione Test in pannelli espandibili per prodotto, con ricerca e descrizioni disponibili al passaggio del mouse
- aggiunto l'audit locale in sola lettura per individuare dipendenze candidate da verificare, TODO/FIXME/HACK e placeholder espliciti
- aggiunta la categoria `Archivio Flow — Caccia bug` con test avversariali su dataset generati, percorsi ostili, nomi riservati Windows e transizioni SQLite vietate
- impedite le transizioni impossibili delle sessioni di importazione e neutralizzati nomi Windows o caratteri bidi che potevano produrre destinazioni non valide
- estesa la Caccia bug a tutti i tool attivi, con sezioni dedicate e comandi eseguibili singolarmente dalla Dev Console
- corretti il parsing dei nomi con virgole tra virgolette, i conteggi progetto obsoleti di Image Party Frame e il riconoscimento multipiattaforma degli output di Image Converter
- formalizzata la regola di repository che rende obbligatoria l'integrazione di ogni nuovo test nella categoria corretta della Dev Console
- resa non distruttiva la verifica dipendenze della release avviata dalla dashboard: non esegue più `npm ci` mentre la Console usa `esbuild` e valida invece workspace, comandi e runtime Electron presenti
- aggiunto il ripristino deterministico del runtime Electron Windows dopo un'installazione pulita, evitando pacchetti presenti ma privi di `electron.exe`
- corretto il launcher Windows della Console per eseguire direttamente gli eseguibili con percorsi contenenti spazi
- rimosso il workspace orfano `AlbumWiew`, non collegato a Suite, dashboard, CI o release

## 2026-08-20 - FileX Suite 0.1.41

### Dev Console e pubblicazione
- la FileX Dev Console propone automaticamente la prossima patch e riunisce preflight, commit, tag, pubblicazione e verifica in un solo pulsante
- le modifiche locali preparate durante lo sviluppo vengono incluse nel commit di release dopo una conferma nel browser, senza richiedere comandi o token manuali
- mantenuto il blocco di sicurezza: la pubblicazione è consentita esclusivamente dal branch `main` e mostra nel log ogni fase del workflow
- corretto il controllo delle dipendenze: un semplice incremento di versione non avvia più `npm ci` mentre la Dev Console è aperta, evitando blocchi di `esbuild`

## 2026-08-20 - FileX Backup Guard 0.2.1

- riconosciute le rinomine non ambigue delle cartelle gia' protette: Backup Guard verifica integralmente i contenuti con SHA-256 e rinomina la cartella direttamente sul clone, senza eliminare o ritrasferire le fotografie
- aggiunto un blocco fail-safe: se struttura, metadati o checksum non corrispondono, la rinomina viene annullata prima di modificare il clone

## 2026-08-20 - FileX Suite 0.1.40

### Affidabilita' dei tool e rilascio
- inclusa nella Suite la correzione di Archivio Flow per l'indicizzazione incrementale, la rinomina osservabile e il registro Google Drive dei soli manifest
- aggiornata l'esperienza di FileX Backup Guard con testata compatta e gestione sicura delle cartelle rinominate
- consolidati controlli e documentazione di release per distinguere gli artefatti locali dai file distribuibili

## 2026-08-20 - FileX Suite 0.1.39

### Google Drive e runtime desktop
- configurato un client OAuth Google di tipo `Desktop app` condiviso dai tool FileX, con Authorization Code, PKCE e callback loopback dinamico su `127.0.0.1`
- aggiunti Client ID e Client Secret alla configurazione locale esclusa da Git e ai secret del workflow Windows; le release vengono ora bloccate se una delle due credenziali manca
- limitato l'accesso allo scope `drive.file`, cifrati i token utente con Electron `safeStorage` e condiviso l'account soltanto fra i tool dello stesso profilo del sistema operativo
- aggiunta la revoca del refresh token durante lo scollegamento dell'account e corretti i messaggi di configurazione OAuth incompleta
- integrati nella shell Electron i servizi StudioFlow di Archivio Flow per stato, riconciliazione, ripresa importazioni, verifica SD e sincronizzazione del registro Drive

### Sviluppo e verifiche
- aggiunta la licenza FileX All Access automatica esclusivamente alle build Electron non pacchettizzate, con override `FILEX_LICENSE_ENFORCEMENT=enforce` per collaudare il percorso commerciale reale
- consolidata FileX Dev Console come dashboard locale per avvio, arresto, riapertura, log e build dei tool Electron
- verificata la build TypeScript della shell con configurazione OAuth Desktop completa

## 2026-08-20 - Archivio Flow 0.1.26

### StudioFlow local-first
- introdotto il database SQLite persistente per lavori, impostazioni, indice archivio, schede, sessioni, prove file e coda di sincronizzazione
- resa l'importazione riprendibile e fail-closed, con file temporanei, verifica finale, fingerprint, SHA-256 nei casi critici e stato sicuro della SD basato su prove locali
- aggiunti mapping categorie guidati, anteprima delle destinazioni, registrazione delle cartelle esterne e correzione assistita dei nomi senza rinomina automatica
- impedita la ricostruzione completa dell'indice a ogni avvio o modifica: un indice SQLite valido viene riutilizzato, mentre importazioni, rinomine e watcher aggiornano soltanto il sottoalbero del lavoro coinvolto
- mantenuti stato e risultato del controllo nomi quando si cambia sezione, con loading visibile, tempo trascorso e indicazione dell'attività nella barra laterale
- resa atomica e osservabile la rinomina confermata: una sola operazione alla volta, avanzamento persistente tra le sezioni e nessuna nuova scansione completa prima o dopo la modifica

### Google Drive e interfaccia
- aggiunta una sezione Google Drive reale per collegare l'account dell'utente, mostrare stato e coda e sincronizzare soltanto manifest StudioFlow, mai fotografie
- condiviso l'account Google autorizzato con gli altri tool FileX nello stesso profilo del computer
- resa compatta la testata laterale e letta la versione reale `0.1.26` dal package del tool

### Verifiche
- completati typecheck, build web, build server e copia del server nella shell Electron
- superati 9 test automatici, inclusi il riuso dell'indice persistito e il blocco delle richieste di rinomina duplicate

## 2026-08-19 - FileX Suite 0.1.38

### Release e aggiornamenti
- aggiunto `release-filex-suite.bat` per automatizzare l'intero ciclo di pubblicazione della FileX Suite
- aggiunti controlli preventivi sullo stato Git, sul branch `main`, sulle modifiche locali e sull'allineamento tra `HEAD` e `origin/main`
- automatizzati aggiornamento della versione, commit, push, creazione del tag `suite-vX.Y.Z` e avvio della GitHub Action ufficiale
- aggiunta l'attesa automatica del workflow GitHub Actions con interruzione della procedura in caso di build o pubblicazione fallita
- aggiunta la verifica finale degli asset della release e del feed `suite-channel-stable/latest.yml`
- verificata la presenza dell'alias permanente `FileX-Suite-stable-x64-setup.exe`, utilizzato sia dal sito sia dal sistema di aggiornamento
- aggiunto il controllo che il `latest.yml` remoto contenga effettivamente la nuova versione prima di considerare conclusa la release
- integrato il deploy del sito FileX tramite `npm run deploy:website`
- normalizzati i link di download del sito verso il canale stabile dedicato, evitando la dipendenza da `releases/latest`
- mantenute indipendenti le versioni e le release dei singoli tool FileX
## 2026-08-14 - FileX Suite 0.1.35

- eliminato il rettangolo grigio residuo dietro la dock ridotta, causato dal `backdrop-filter` della finestra trasparente su Windows
- resi completamente trasparenti sfondo, bordo e contenitore esterno quando la dock e' chiusa, lasciando visibile soltanto l'icona arrotondata
- pubblicata soltanto FileX Suite 0.1.35; le versioni e il catalogo remoto dei tool indipendenti restano invariati

## 2026-08-14 - FileX Backup Guard 0.2.0

- promossa FileX Backup Guard a prima release ufficiale stabile nel catalogo standard di FileX Suite
- mantenute sincronizzazione master-clone verificata, propagazione controllata delle cancellazioni e importazione dei soli file nuovi dal clone
- confermate verifica SHA-256, controllo spazio, velocita, ETA, pausa, annullamento sicuro, verifica profonda e cestino recuperabile
- incluse cronologia ricercabile ed esportabile, gestione dei conflitti, protezione Lightroom e integrazione con Archivio Flow
- pubblicato soltanto FileX Backup Guard 0.2.0 nel catalogo stabile; FileX Suite e gli altri tool restano invariati

## 2026-08-14 - FileX Backup Guard 0.2.0-beta.1

- pubblicata la prima beta indipendente di FileX Backup Guard per i tester FileX
- aggiunte sincronizzazione master-clone, importazione controllata dal clone, propagazione delle cancellazioni e cestino recuperabile
- aggiunti SHA-256, verifica profonda, controllo spazio, velocita, ETA, pausa e annullamento sicuro
- aggiunte gestione esplicita dei conflitti, snapshot Lightroom e collegamento con i nuovi lavori di Archivio Flow
- esteso il workflow Windows e il catalogo beta per costruire e distribuire soltanto Backup Guard
- aggiunta la pagina pubblica di Backup Guard al sito FileX; Suite e versioni degli altri tool restano invariate

## 2026-08-14 - FileX Send 0.1.3

- aggiunta la scelta iniziale tra ricezione e invio di file dal PC al cliente
- introdotta la condivisione tramite QR nella rete locale con download protetto dei soli file selezionati
- introdotta la consegna remota PC → cloud → cliente tramite link temporaneo revocabile
- migliorata la selezione mobile con accessi separati a galleria e altri file, istruzioni e anteprime
- pubblicato soltanto FileX Send 0.1.3; FileX Suite e gli altri tool restano invariati

## 2026-08-14 - FileX Suite 0.1.34

- rimossa l'ombra rettangolare nativa della finestra trasparente della dock su Windows
- alleggeriti ombra, bordo e superficie effetto vetro della dock nei temi chiaro e scuro
- resa piu' compatta la dock ridotta e aggiunti separatore, animazioni di ingresso e focus da tastiera
- ridotta la magnification delle icone per un'interazione piu' stabile e leggibile
- stabilizzata l'installazione delle dipendenze nel runner Windows evitando download Electron concorrenti durante `npm ci`
- pubblicata soltanto FileX Suite 0.1.34; le versioni e il catalogo remoto dei tool indipendenti restano invariati

## 2026-08-14 - FileX Suite 0.1.33

- corretto il comando `Verifica ora` della licenza: mostra lo stato di avanzamento, conferma l'orario della verifica e torna sempre cliccabile anche dopo una richiesta asincrona
- ripristinati logo, categoria e descrizione completa di FileX Backup Guard nel catalogo della Suite
- corretto il creatore amministrativo di licenze prova affinche' riusi in modo temporaneo e sicuro il login Firebase CLI locale
- resa effettiva la modalita' remota `enforce` tramite override esplicito: i tool sono accessibili soltanto con licenza attiva, commerciale o creata manualmente dall'amministratore
- pubblicata soltanto FileX Suite 0.1.33; le versioni e il catalogo remoto dei tool indipendenti restano invariati

## 2026-08-13 - FileX Suite 0.1.32

- introdotto l'entitlement unico FileX All Access per tutti i tool, con due dispositivi, sette giorni di cortesia e attestazione offline firmata valida fino a 14 giorni
- aggiunti attivazione, validazione, disattivazione, webhook Lemon Squeezy firmati, rate limit e retention automatica dei log tecnici
- aggiunta gestione licenza nella Suite e gate per runtime condiviso e applicazioni Electron autonome
- resa obbligatoria nel manifest la strategia licenza di ogni tool e aggiunto il test `test:filex-license-coverage` per proteggere anche i tool futuri
- pubblicati sito, condizioni, privacy, EULA, rimborsi e pagina post-acquisto; configurato Lemon Squeezy Test mode con piani da 12 EUR/mese e 100 EUR/anno
- aggiunto il creatore amministrativo cliccabile di licenze prova, con durata configurabile e copia automatica della chiave
- enforcement mantenuto in `observe` fino all'approvazione e al collaudo live dello store
- pubblicata soltanto FileX Suite 0.1.32; le versioni dei tool indipendenti restano invariate

## 2026-08-11 - Image Select Pro 0.1.27

- impedita l'esecuzione tardiva del polling delle modifiche esterne dopo la chiusura o il rinnovo del relativo effetto
- evitati aggiornamenti asincroni obsoleti delle anteprime quando cambia rapidamente la selezione o viene chiuso il tool
- mantenute invariate le versioni di FileX Suite e degli altri tool

## 2026-08-10 - Image Select Pro 0.1.27

### Image Select Pro
- la scrittura dei sidecar XMP non modifica piu' il file immagine sorgente e conserva data e ora originali
- un sidecar XMP gia' invariato non viene piu' riscritto, evitando tocchi superflui su disco e cartelle recenti
- deduplicati i target sidecar quando sorgente e companion RAWs condividono lo stesso file `.xmp`
- ridotti i ri-render del pannello di classificazione durante i batch di miniature: la memoizzazione dei metadati non dipende piu' dall'identita' dell'array foto
- lo scroll della griglia non torna piu' in alto dopo aggiornamenti asincroni che non cambiano l'insieme filtrato
- aggiunte verifiche automatiche che il sidecar non alteri il sorgente e che non venga riscritto se identico

### Release engineering
- release indipendente di Image Select Pro con tag `photo-selector-app-v0.1.27`, installer Windows x64 e catalogo stabile dedicato
- FileX Suite e gli altri tool mantengono invariata la propria versione

## 2026-08-10 - FileX Send 0.1.2

- corretto l'aggiornamento delle installazioni esistenti che terminava con codice `2`
- aggiunto un percorso NSIS compatibile che preserva i dati e non richiede la disinstallazione manuale
- mostrata stabilmente la versione installata nel titolo della finestra di FileX Send

## 2026-08-10 - FileX Send 0.1.1

- corretto il falso errore `Sessione chiusa o scaduta` dopo il primo gruppo di foto inviato
- lo stesso link remoto accetta ora più invii consecutivi fino alla data e ora impostate dal fotografo
- chiudere FileX Send sul PC continua a lasciare operativo il collegamento; soltanto scadenza o `Archivia invio` lo invalidano
- aggiunto nella pagina cliente il comando `Invia altri file` dopo ogni consegna completata

## 2026-08-09 - FileX Suite 0.1.31

- aggiunto FileX Send al launcher e al Dock della Suite con installazione e aggiornamenti indipendenti
- aggiunta la sezione predefinita `Consegna`, compatibile con le sezioni personalizzabili introdotte nella Suite 0.1.29
- aggiornati catalogo, sito download e workflow Windows per la nuova applicazione

## 2026-08-09 - FileX Send 0.1.0

- aggiunto il nuovo tool per ricevere foto e video dal telefono del cliente sulla rete locale del negozio tramite QR code
- introdotte sessioni locali isolate e link cloud con scadenza configurabile da 15 minuti a 7 giorni
- aggiunti upload a flusso fino a 25 GB per file, file temporanei protetti e rinomina automatica dei duplicati
- realizzate l'interfaccia desktop per il fotografo e la pagina mobile senza app o account
- aggiunto il flusso guidato a due QR: connessione Wi-Fi con credenziali incorporate e successiva apertura della pagina di invio
- aggiunto il rilevamento automatico del profilo Wi-Fi Windows, con riuso via Ethernet e password memorizzata tramite cifratura Windows
- aggiunta la scelta iniziale `Qui con me` / `A distanza`, mantenendo invariato il flusso locale
- introdotto FileX Cloud con link attivi anche a PC spento, upload via Internet e download automatico alla riapertura di FileX Send
- mantenuti nel cloud i file non ancora scaricati e programmata la cancellazione un'ora dopo il download locale verificato
- creato FileX Cloud su Firebase con Hosting HTTPS, Functions europee, Firestore privato, Storage europeo e pulizia automatica
- aggiunta la ripresa della sessione remota dopo il riavvio del PC, con token cifrato tramite Windows DPAPI e notifica Windows alla ricezione
- aggiunta un'identità Firebase anonima per installazione, creata automaticamente e conservata cifrata tramite Windows DPAPI
- verificato il flusso cloud end-to-end reale: scadenza personalizzata, upload con desktop inattivo, recupero, download integro, conferma e retention di 60 minuti
- integrati catalogo e Dock della Suite, branding, build indipendente, test e controlli CI
- documentata la configurazione consigliata con access point dedicato e i limiti dell'MVP

## 2026-08-09 - FileX Suite 0.1.30

- corretta la rinomina delle sezioni personali nel launcher Electron
- sostituito il prompt nativo non supportato con un editor integrato nella finestra `Organizza sezioni`
- aggiunti salvataggio con `Invio` o pulsante di conferma e annullamento con `Esc`

## 2026-08-09 - FileX Suite 0.1.29

- spostato FileX Adobe Cleaner nella sezione generale `Utility`, eliminando la categoria separata `Utility Adobe`
- aggiunte sezioni personali persistenti, creabili, rinominabili, riordinabili ed eliminabili dall'utente
- consentita l'assegnazione dello stesso tool a più sezioni tramite selezione multipla o trascinamento
- aggiunto il ripristino sicuro dell'organizzazione predefinita senza disinstallare o modificare alcun tool

## 2026-08-09 - FileX Adobe Cleaner 0.1.0

### FileX Adobe Cleaner
- aggiunto il nuovo tool Windows per rilevare le applicazioni Adobe installate e pulire soltanto cache esplicitamente supportate
- chiarito nell'interfaccia, nella Suite e nei testi marketing che il tool lavora esclusivamente sui programmi Adobe e non è un pulitore generico del PC
- introdotti profili consigliato, personalizzato e profondo con anteprima dello spazio, conseguenze e conferma prima della cancellazione
- la chiusura dei processi Adobe coinvolti avviene prima in modalita normale; la terminazione forzata richiede una seconda conferma
- aggiunte protezioni sui percorsi, blocco dei processi ancora attivi e report degli elementi eliminati, saltati o non accessibili
- corretto il formato CommonJS del preload sandboxed, rendendo disponibile il bridge nativo anche nella build Windows pacchettizzata
- adottato il nome FileX Adobe Cleaner e chiarito il posizionamento esclusivamente dedicato alle applicazioni Adobe
- aggiunto il rilevamento conservativo delle vecchie versioni affiancate e la rimozione tramite Adobe HDBox con preferenze conservate e conferma UAC

### Release engineering
- aggiunti workspace, branding, build indipendente, installer Windows selettivo e controlli CI per il canale stabile

## 2026-08-09 - FileX Suite 0.1.28

- aggiunto FileX Adobe Cleaner al launcher e al Dock della Suite con installazione e aggiornamenti indipendenti
- il catalogo riconosce `cache-sweep` e richiede FileX Suite 0.1.28 o successiva
- aggiornati sito download, documentazione e workflow Windows per la nuova applicazione

## 2026-08-09 - FileX Suite 0.1.27

- corretta la verifica della versione dei tool installati: la Suite legge prima `package.json` tramite il filesystem ASAR virtuale di Electron
- mantenuto il reader ASAR esplicito come fallback per test, diagnostica e installazioni non eseguite dentro Electron
- eliminato il falso errore "il tool è stato installato ma non è stato possibile verificarne la versione" dopo un aggiornamento riuscito
- Image Select Pro e gli altri tool mantengono invariata la propria versione

## 2026-08-09 - Image Select Pro 0.1.26

### Image Select Pro
- la schermata Sfoglia permette ora di scorrere tutte le cartelle e i progetti recenti mantenendo fissa la testata
- la modalita Confronta usa da 2 a 4 foto selezionate e visibili nella griglia, conserva l'ordine corrente e resta accessibile anche nei pannelli stretti
- aggiunta la scorciatoia `Ctrl+B` per aprire e chiudere rapidamente il confronto
- durante lo scorrimento della griglia le ombre diffuse delle card vengono sospese, mantenendo visibili bordi di selezione ed etichette colore

### Release engineering
- prima release indipendente di Image Select Pro con tag `photo-selector-app-v0.1.26`, installer Windows x64, requisito minimo FileX Suite `0.1.26` e catalogo stabile dedicato
- FileX Suite e gli altri tool mantengono invariata la propria versione

## 2026-08-09 - FileX Suite 0.1.26

- versionamento separato per FileX Suite, Image Select Pro, Image Party Frame e Archivio Flow
- build Windows selettiva del solo componente pubblicato
- feed Suite e catalogo tool separati dagli alias GitHub `releases/latest`
- tag namespaced e controllo aggiornamenti distinto nell'interfaccia della Suite

## 2026-08-08 - FileX Suite 0.1.25

### Image Select Pro
- l'anteprima rapida ora copre correttamente la testata dell'applicazione, evitando comandi e contenuti nascosti sotto il layout principale
- aggiunto un interruttore visibile e accessibile `Avanza dopo classificazione`: in `OFF` stelle, Pick/Scarta, colori ed etichette restano sulla foto corrente, mentre le frecce continuano a navigare manualmente
- la preferenza di avanzamento automatico viene conservata tra le sessioni
- i conteggi distinguono chiaramente selezioni nella cartella, selezioni complessive del progetto e fotografie visibili con i filtri
- il filtro stelle mostra sia il numero minimo (`1 stella o piu`) sia il totale esatto della singola valutazione

### Release engineering
- FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow vengono riallineati alla versione `0.1.25` con installer per-user, blockmap, `latest.yml` e manifest stabile verificato

## 2026-08-08 - FileX Suite 0.1.24

### Aggiornamento dei tool
- corretto il lock di `resources/app.asar` causato dalla lettura della versione installata: FileX Suite non mantiene piu' aperti i file di Image Select Pro e degli altri tool
- l'installer silenzioso non resta piu' sospeso dietro una finestra di errore; restituisce alla Suite il codice di file occupato, che viene ritentato con attese progressive
- la chiusura della Suite ora attende i servizi nativi prima di terminare, riducendo i processi residui e i file ancora in uso
- aggiunto un test di regressione Windows che legge la versione dall'ASAR e verifica che l'archivio possa essere rinominato immediatamente

### Release engineering
- FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow vengono riallineati alla versione `0.1.24` con installer per-user, blockmap, `latest.yml` e manifest stabile verificato

## 2026-08-08 - FileX Suite 0.1.23

### Image Select Pro
- nuova area di lavoro modulare: pannelli Selezione, Vista, Filtri e Statistiche sono compatti, richiudibili e riposizionabili senza coprire la griglia
- barra superiore e comandi contestuali riorganizzati per ridurre ingombro e clic ripetuti; corretti contenuti tagliati, sovrapposizioni e livelli dei modali
- caricamento esplicito per servizi con migliaia di fotografie, rendering alleggerito e diagnostica reale dell'accelerazione hardware nel pannello impostazioni
- in anteprima rapida l'avanzamento dopo una classificazione e' ora disattivabile direttamente con `Avanza: ON/OFF`; eliminato il doppio salto causato dall'interazione con i filtri attivi
- navigazione manuale avanti/indietro preservata anche quando la classificazione corrente non soddisfa piu' il filtro visibile
- riconnessione Google Drive disponibile quando il refresh del token scade o viene revocato, con messaggio operativo al posto dell'errore generico 400
- sincronizzazione XMP resa piu' robusta e verificabile sulle varianti di metadati usate dai principali software fotografici

### FileX Suite e aggiornamenti
- FileX Suite e i tool Windows distribuiti vengono riallineati alla versione `0.1.23` tramite un'unica release stabile
- installer per-user, blockmap, `latest.yml` e manifest `stable.json` sono pubblicati insieme per consentire l'aggiornamento sia della Suite sia di Image Select Pro dalle installazioni precedenti
- rilevamento processi, chiusura ordinata e individuazione degli eseguibili installati resi piu' affidabili durante gli aggiornamenti

## 2026-08-07 - FileX Suite 0.1.22 (per-user)

### Aggiornamenti senza privilegi amministrativi
- gli installer dei tool passano a NSIS one-click per-user (`perMachine: false`): installazione in `%LOCALAPPDATA%\Programs\<ToolName>` senza UAC
- `packElevateHelper: false`: nessun helper di elevazione incorporato negli installer
- l'aggiornamento di un tool chiude SOLO quel tool, esegue l'installer con `/S` e riapre il tool se era in esecuzione; la Suite e gli altri tool restano aperti
- eliminato PowerShell dal flusso di aggiornamento: chiusura processi via `tasklist`/`taskkill`, lettura versione da `resources/app.asar/package.json`
- rimosse le funzioni NSIS di disinstallazione legacy HKLM/HKCU (`uninstallLegacyVersions`, `uninstallByDisplayName`, `loop_hkcu`, `loop_hklm`)
- `extraMetadata.name` impostato sull'`executableName` di ogni tool: con one-click per-user electron-builder deriva la cartella di installazione dal nome del package, che era condiviso tra tutti i tool e causava installazioni sovrapposte in `@photo-toolsfilex-desktop`
- ogni finestra mostra nel titolo il nome del tool e la versione installata, letta direttamente dal package Electron

### Migrazione
- le installazioni precedenti in `C:\Program Files\...` possono restare temporaneamente: la Suite cerca sia `%LOCALAPPDATA%\Programs` sia `Program Files` e sceglie la versione più recente
- dopo la verifica della nuova architettura, rimuovere manualmente le vecchie installazioni per-machine

## 2026-08-05 - FileX Suite 0.1.20

### FileX Suite
- corretto il completamento del download degli aggiornamenti: l'installer viene usato solo dopo la chiusura del file temporaneo e la rinomina effettiva in `.exe`
- gli errori transitori di lock di Windows vengono ritentati prima della verifica SHA-256, evitando riavvii o richieste UAC su installer non disponibili

### Release engineering
- FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow vengono ripubblicati alla versione `0.1.20` con manifest stabile, installer, blockmap e `latest.yml` coerenti

## 2026-08-05 - FileX Suite 0.1.19

### Image Select Pro
- anteprima rapida in modalita focus con filtri e dock richiudibili per dedicare piu spazio allo scatto
- controllo zoom diretto e pulsanti di spostamento disponibili quando l'immagine e' ingrandita

### Release engineering
- FileX Suite, Image Party Frame, Image Select Pro e Archivio Flow vengono pubblicati insieme alla versione `0.1.19`
- manifest stabile, installer, blockmap e `latest.yml` sono distribuiti dalla stessa GitHub Release per gli aggiornamenti nel launcher

## 2026-08-04 - FileX Suite 0.1.18

### FileX Suite
- descrizioni operative complete per tutti i software presenti nel launcher
- dettagli della nuova versione mostrati direttamente nella scheda prima del pulsante `Aggiorna`
- note di rilascio obbligatorie per ogni tool: il manifest non viene generato se le novità non sono specificate

### Aggiornamenti coordinati
- chiusura dell'intera famiglia di processi FileX prima di aggiornare la Suite o un singolo tool
- tentativo di chiusura ordinata seguito dalla terminazione dei soli processi rimasti bloccati
- riavvio automatico di FileX Suite al termine dell'installer
- ripristino automatico dei tool che erano aperti prima dell'aggiornamento

### Release engineering
- Image Party Frame entra nella pipeline insieme a FileX Suite, Image Select Pro e Archivio Flow
- manifest stabile completo di versione, checksum, URL e novità per ciascun tool pubblicato
- chiusura processi già predisposta anche per Batch Print Layout, Image Converter e Trova Foto da Lista quando torneranno disponibili i relativi workspace applicativi

## 2026-08-04 - FileX Suite 0.1.17

### Archivio Flow
- mappatura persistente delle cartelle archivio create fuori da Archivio Flow
- nuovo modulo guidato per correggere nome e data e riallineare in sicurezza i nomi delle cartelle
- anteprima, selezione esplicita, controllo collisioni, rollback e scrollbar sempre visibile nel modulo di riallineamento
- import piu' sicuro: blocco destinazioni interne alla SD, gestione link, confronto contenuti e risultati parziali espliciti
- generazione BASSA_QUALITA piu' robusta e riutilizzabile anche sui file gia' importati
- icona Windows corretta al posto dell'icona Electron

### Integrazione FileX Suite e Image Select Pro
- rilevamento esteso delle installazioni attuali e legacy di Image Select Pro
- apertura automatica della cartella selezionata da Archivio Flow
- cambio cartella affidabile quando Image Select Pro e' gia' aperto, senza creare finestre duplicate
- forwarding Windows irrobustito tramite dati single-instance e argomento `--open-folder=...`

### Release engineering
- FileX Suite, Image Select Pro e Archivio Flow pubblicati insieme al manifest stabile aggiornato
- contratto permanente "pubblica e builda" documentato per versioni, changelog, sito, installer e verifica updater

## 2026-08-01 - FileX Suite 0.1.5

### Aggiornamento automatico della Suite
- controllo automatico della versione stabile all'avvio
- download in background con avanzamento e velocità visibili nel launcher
- verifica SHA-512 dell'installer tramite electron-updater
- installazione automatica con conto alla rovescia, possibilità di installare subito o rimandare
- gestione non bloccante delle connessioni lente o temporaneamente assenti
- pubblicazione obbligatoria di `latest.yml` e blockmap nelle release future

## 2026-08-01 - FileX Suite 0.1.4

### Dock adattiva
- avvio ridotto a icona anche per gli utenti provenienti dalle versioni precedenti
- tema chiaro o scuro sincronizzato automaticamente con Windows
- animazione di ingrandimento più fluida e progressiva in stile macOS
- riordino delle icone tramite trascinamento con ordine persistente
- finestra trasparente ridimensionata al contenuto per limitare l'area occupata e l'intercettazione del mouse
- riduzione automatica dopo l'avvio di un tool o un breve periodo di inattività

## 2026-08-01 - FileX Suite 0.1.3

### Pulizia strumenti dismessi
- rimossi definitivamente dal launcher ImageAlbumMaker, Ripara Disco Rete e Image ID Print
- la Suite distribuita mostra esclusivamente i sei strumenti supportati
- mantenuta la gestione degli installer tramite manifesto remoto con URL di release versionati

## 2026-03-27 - Desktop workflows, performance e branding

Commit: `01e61e7` - `feat: improve desktop workflows and suite branding`

### Image Select Pro
- migliorata in modo sostanziale la velocita' di browsing su griglie grandi e quick preview
- aggiunte pipeline piu' native per RAW, thumbnail e preview con cache piu' aggressive
- resa piu' coerente la navigazione tra griglia e preview `Space`
- aggiunti filtri label custom, scorciatoie, assegnazione piu' solida e drag/drop desktop
- aggiunto suggerimento smart per spostare la cache pesante su un disco piu' capiente con migrazione guidata

### Image ID Print
- introdotto editor di refine scontorno con pennello, undo/redo, hardness, zoom e pan
- migliorata la logica di recupero soggetto e refine dei bordi
- aggiunta stampa DNP RX1 con pipeline dedicata e fix di export/preview
- corretti bug su upload, export, crop reset, auto-align e preview ruotate

### Desktop shell e packaging
- branding unificato per le app della suite e uso corretto dei loghi nei bundle
- packaging Windows migliorato con icone, naming coerente e script multi-tool
- migliorata integrazione con editor esterni e rilevamento Photoshop
- rafforzata la cache desktop thumbnail/preview e la gestione dei percorsi

### Auto Layout e integrazioni
- preparata integrazione piu' stretta con `Image Select Pro` tramite etichette custom e metadati condivisi
- aggiornati storage/export per supportare meglio il flusso di selezione reale
