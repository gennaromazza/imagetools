# Photo Tools for Photographers

## 02. UI System & Product Interface Guidelines

Questo documento definisce il sistema UI dell'applicazione.

Non descrive solo l'aspetto visivo, ma soprattutto:

- struttura dell'interfaccia
- gerarchia delle informazioni
- comportamento dei pannelli
- pattern condivisi tra i tool
- esperienza d'uso coerente
- regole da rispettare quando si disegna o si implementa la UI

L'obiettivo non e creare un plugin "bello" in modo astratto, ma un'interfaccia professionale, chiara e credibile per workflow fotografici reali.

Questo file va letto prima di costruire qualsiasi schermata UI del progetto.

## 1. Obiettivo del sistema UI

La UI deve trasmettere queste qualita:

- chiarezza
- controllo
- affidabilita
- velocita operativa
- professionalita

Il prodotto non deve sembrare:

- una demo tecnica
- una dashboard generica
- una raccolta di form scollegati
- una UI "creativa" che ostacola il lavoro

Deve sembrare invece:

- uno strumento da studio fotografico
- un hub operativo serio
- un pannello pulito, leggibile e rapido

## 2. Filosofia di design

La direzione visiva consigliata e:

- sobria
- tecnica
- elegante
- ordinata
- orientata alla leggibilita

La UI deve avere personalita, ma senza rumore.

Principio chiave:

- meno decorazione gratuita
- piu gerarchia visiva reale

La sensazione generale deve essere quella di un ambiente di lavoro professionale, non di un'app consumer giocosa.

## 3. Principi UX principali

### Immediatezza

L'utente deve capire subito:

- dove si trova
- che tool sta usando
- cosa deve compilare
- cosa succedera premendo il pulsante principale

### Progressivita

Le opzioni essenziali devono essere visibili subito.
Le opzioni avanzate devono esistere, ma non appesantire il primo sguardo.

### Predictability

Ogni tool deve comportarsi nello stesso modo per:

- input
- preset
- esecuzione
- log
- errori
- output

### Densita controllata

L'utente professionale tollera una UI densa, ma non il disordine.

La densita deve essere:

- informativa
- ben allineata
- leggibile
- sempre segmentata in blocchi chiari

### Riduzione dell'ansia operativa

La UI deve rassicurare l'utente su tre punti:

- cosa verra fatto
- con quali impostazioni
- dove finira l'output

## 4. Ruolo della UI nell'architettura

La UI non deve contenere la logica di business.

La UI deve:

- raccogliere input
- mostrare configurazioni
- rendere chiari preset e stato
- visualizzare log, warning, errori e risultati
- accompagnare l'utente nell'esecuzione

La UI non deve:

- prendere decisioni algoritmiche nascoste
- duplicare validazioni di dominio gia presenti nel core
- incorporare regole proprie non serializzate

## 5. Struttura generale dell'app

L'applicazione va progettata come un hub di strumenti.

Struttura base:

```text
+--------------------------------------------------------------------+
| Header / Product Title / Active Tool                               |
+--------------------------------------------------------------------+
| Quick Presets / Session Info / Context Bar                         |
+------------------------+-------------------------------------------+
| Tool Navigation        | Active Tool Workspace                     |
|------------------------|-------------------------------------------|
| Layout                 | Section: Input                            |
| Export                 | Section: Options                          |
| Batch                  | Section: Advanced                         |
| Proof                  | Section: Output                           |
| Workflow               | Section: Execute                          |
+------------------------+-------------------------------------------+
| Progress / Log / Result Summary                                    |
+--------------------------------------------------------------------+
```

Questa struttura deve restare stabile anche quando cresceranno i tool.

## 6. Layout principale dell'interfaccia

### Header

Il top dell'interfaccia deve contenere:

- nome prodotto
- nome tool attivo
- eventuale sottotitolo operativo breve
- stato generale del tool o della sessione

Il titolo non deve essere puramente decorativo. Deve aiutare l'orientamento.

### Context Bar

Subito sotto l'header va prevista una barra contestuale leggera per:

- preset rapidi
- stato cartella sorgente
- stato output
- eventuali messaggi di contesto non critici

Questa barra evita di spargere informazione importante dentro il form.

### Navigation Panel

La colonna sinistra ospita:

- categorie tool
- elenco tool
- eventuale stato selezione
- eventuale badge di disponibilita futura

La navigazione deve essere:

- verticale
- stabile
- sempre visibile
- molto leggibile

### Active Workspace

Il pannello principale contiene il tool selezionato.

La sua struttura interna deve essere sempre riconoscibile:

1. Input
2. Opzioni principali
3. Opzioni avanzate
4. Output
5. Azione primaria

### Footer operativo o log area

L'area bassa della UI deve mostrare:

- log live
- progresso
- warning
- esito finale
- link o path dell'output

Questa sezione e parte del workflow, non un accessorio.

## 7. Gerarchia visiva

La gerarchia deve essere fortemente leggibile senza affidarsi a effetti grafici aggressivi.

Strati di gerarchia:

- livello 1: tool attivo e azione principale
- livello 2: sezioni del form
- livello 3: gruppi di controlli
- livello 4: hint, note e testo di supporto

Tecniche consigliate:

- differenza chiara di peso tipografico
- spaziatura generosa tra sezioni
- superfici pannello ben separate
- uso misurato del contrasto

Da evitare:

- troppi bordi
- troppe card identiche
- pulsanti secondari che competono con quello principale
- icone senza funzione reale

## 8. Direzione visiva consigliata

La UI dovrebbe ispirarsi a strumenti professionali di editing e prepress, ma con maggiore pulizia.

Direzione consigliata:

- base neutra scura o antracite morbida
- superfici differenziate ma non rumorose
- accento caldo e tecnico, ad esempio arancio rame, sabbia calda o blu petrolio desaturato
- contrasto alto sui testi
- evidenze controllate per stati attivi e azioni

Importante:

- niente look generico viola-on-white
- niente cromie da SaaS standard
- niente estetica gamer o futuristica eccessiva

Il visual deve suggerire precisione, stampa, editing, controllo.

## 9. Token visivi di massima

Questi token sono indicativi e servono a definire la direzione.

### Palette consigliata

- background principale: carbone profondo
- pannello secondario: grigio grafite
- superficie elevata: antracite medio
- testo primario: quasi bianco caldo
- testo secondario: grigio chiaro neutro
- accent: rame tecnico oppure petrolio controllato
- success: verde sobrio
- warning: ambra professionale
- error: rosso mattone controllato

### Tipografia

La tipografia deve sembrare professionale e decisa.

Direzione consigliata:

- font UI principale: sans moderna con carattere tecnico ma non freddo
- font secondario o display: opzionale, solo per titolo prodotto o micro-branding

La UI deve privilegiare:

- leggibilita
- allineamento
- numeri chiari
- distinzione netta tra label, valore e hint

### Spaziatura

Usare una scala coerente, ad esempio multipli di 4 o 8.

Regole:

- spaziatura piccola per controlli correlati
- spaziatura media tra gruppi
- spaziatura ampia tra sezioni

### Raggio e bordi

Direzione consigliata:

- angoli moderatamente arrotondati
- bordi sottili e discreti
- evitare look troppo morbido o "bubble"

## 10. Sistema dei pannelli

L'interfaccia deve usare pannelli funzionali, non box casuali.

Tipologie di pannello:

- navigation panel
- settings panel
- collapsible advanced panel
- status panel
- log panel
- result panel

Ogni pannello deve comunicare chiaramente:

- cosa contiene
- cosa e prioritario
- se e statico o interattivo

## 11. Sezioni standard di ogni tool

Ogni tool deve seguire la stessa struttura di base.

### 1. Tool Header

Contiene:

- nome tool
- descrizione breve
- eventuale badge categoria

### 2. Input Section

Contiene:

- sorgenti
- selettori cartella/file
- input principali

### 3. Core Options Section

Contiene:

- impostazioni che determinano il comportamento del tool
- controlli chiave subito visibili

### 4. Advanced Options Section

Contiene:

- opzioni meno frequenti
- parametri di fine tuning
- impostazioni tecniche avanzate

Questa sezione deve essere collassabile.

### 5. Output Section

Contiene:

- destinazione output
- formato output
- qualita
- naming se necessario

### 6. Execute Section

Contiene:

- CTA primaria
- eventuale stima del job
- stato di validazione

### 7. Log and Results Section

Contiene:

- progresso
- eventi
- errori
- riepilogo finale

## 12. Pattern dei form

I form devono essere costruiti con logica, non solo con campi in colonna.

Regole:

- mettere in alto cio che sblocca il lavoro
- raggruppare campi per significato, non per tipo di controllo
- usare label esplicite e non ambigue
- affiancare controlli solo quando la relazione e evidente

Pattern consigliati:

- path picker + testo di stato
- select + hint breve
- numeric field con unita visibile
- segmented control per scelte veloci come `fit / fill / crop`
- toggle solo per veri stati booleani

Da evitare:

- placeholder come unica etichetta
- label tecniche poco chiare
- controlli stretti senza respiro
- sezioni troppo lunghe senza sottotitoli

## 13. CTA e gerarchia delle azioni

Ogni schermata deve avere una sola azione primaria dominante.

Nel caso dei tool sara quasi sempre:

- `Generate`
- `Run Tool`
- `Export`

Regole:

- un solo pulsante primario forte
- azioni secondarie visivamente subordinate
- azioni distruttive separate e chiaramente marcate

Lo stato del pulsante primario deve comunicare:

- pronto
- non valido
- in esecuzione
- completato

## 14. Preset UX

I preset sono centrali nel prodotto e devono avere un pattern coerente.

Comportamento consigliato:

- area preset visibile in alto
- preset di default sempre disponibili
- possibilita di salvare configurazioni personalizzate
- stato "modificato" se i campi non corrispondono piu al preset selezionato

La UX dei preset deve far capire:

- cosa sto usando
- cosa ho modificato
- se posso salvare o ripristinare

## 15. Log, progresso e feedback

La parte bassa della UI deve essere progettata con grande cura.

Deve mostrare:

- stato attuale dell'esecuzione
- step corrente
- eventuali warning non bloccanti
- errori leggibili
- riepilogo finale

Struttura consigliata:

- status bar sintetica
- lista eventi di log
- summary finale comprimibile o evidenziata

I log devono essere:

- ordinati
- timestampati se utile
- filtrabili in futuro
- leggibili anche per utenti non tecnici

## 16. Empty states

Gli empty state devono essere pensati fin dall'inizio.

Casi principali:

- nessun tool selezionato
- nessuna cartella scelta
- nessun preset disponibile
- nessun output generato
- nessun log ancora presente

Un buon empty state deve:

- spiegare cosa manca
- suggerire la prossima azione
- non sembrare errore

## 17. Stati di errore

Gli errori non devono comparire come blocchi vaghi o tecnici.

Ogni errore mostrato in UI dovrebbe chiarire:

- cosa e successo
- cosa non e stato possibile fare
- se l'utente puo correggere il problema
- quale azione successiva e consigliata

Distinzione utile:

- errore bloccante
- warning
- problema recuperabile

La UI deve evitare panico e frustrazione.

## 18. Responsive behavior

Anche se il contesto principale e un pannello/plugin, la UI deve restare ordinata in spazi ridotti.

Regole:

- la navigazione puo comprimersi ma non sparire senza alternativa
- i gruppi di campi devono andare in colonna su larghezze strette
- il log non deve schiacciare il form principale
- la CTA primaria deve restare sempre facile da raggiungere

Priorita:

- prima la leggibilita
- poi la densita

## 19. Accessibilita

Anche in un tool professionale interno, l'accessibilita va trattata come requisito.

Minimi obbligatori:

- contrasto leggibile
- focus state visibile
- ordine di tab coerente
- label esplicite
- target cliccabili adeguati
- stati non comunicati solo dal colore

Questo migliora anche velocita e qualita percepita.

## 20. Iconografia

Le icone devono essere poche, coerenti e funzionali.

Usarle per:

- categorie tool
- stato
- azioni note

Non usarle per decorare sezioni che sono gia chiare da titolo e layout.

## 21. Motion e transizioni

Le animazioni devono essere minime ma utili.

Casi in cui hanno senso:

- apertura/chiusura pannelli advanced
- comparsa del log o del result summary
- feedback di completamento operazione

Le transizioni devono essere:

- brevi
- sobrie
- informative

Da evitare:

- animazioni decorative
- micro-motion ovunque
- effetti che rallentano percezione e operativita

## 22. UI del primo tool: Auto Layout

Il primo tool deve diventare il modello UX dei successivi.

Campi minimi da prevedere:

- selezione cartella immagini
- formato foglio
- margini
- gap
- modalita `fit / fill / crop`
- max foto per pagina
- formato output
- qualita export
- cartella output
- pulsante `Generate`
- log finale

### Struttura consigliata della schermata Auto Layout

```text
+--------------------------------------------------------------------+
| Auto Layout                                                        |
| Generate print-ready layouts from a folder of images               |
+--------------------------------------------------------------------+
| Preset: [Studio Standard v] [Save Preset] [Reset]                  |
+--------------------------------------------------------------------+
| Input Folder                                                       |
| [ Select Folder ]   /selected/path/images                          |
| 128 images found | 84 vertical | 32 horizontal | 12 square         |
+--------------------------------------------------------------------+
| Layout Settings                                                    |
| Page Format     [ A4 v ]    Margins [ 10 mm ]   Gap [ 4 mm ]       |
| Fit Mode        [ Fit | Fill | Crop ]                               |
| Max per page    [ 4 ]                                             |
+--------------------------------------------------------------------+
| Advanced Options                                                   |
| [ open / close ]                                                   |
+--------------------------------------------------------------------+
| Output                                                             |
| Format [ JPG v ]   Quality [ 100 ]                                 |
| Folder [ Select Output Folder ]                                    |
+--------------------------------------------------------------------+
| [ Generate Layout ]                                                |
+--------------------------------------------------------------------+
| Progress / Log / Results                                           |
+--------------------------------------------------------------------+
```

### Obiettivo UX del tool

L'utente deve percepire chiaramente:

- da dove arrivano le immagini
- come verra deciso il layout
- dove andra il risultato
- quando il processo e terminato

## 23. Tono dei microcopy

Il linguaggio della UI deve essere:

- chiaro
- asciutto
- professionale
- non troppo tecnico quando non serve

Esempi di tono corretto:

- `Select input folder`
- `No output folder selected`
- `Layout generated successfully`
- `3 images were skipped because they are unsupported`

Da evitare:

- frasi troppo verbose
- tono marketing
- messaggi vaghi come `Something went wrong`

## 24. Coerenza tra tool

Ogni nuovo tool dovra rispettare:

- stessa gabbia generale
- stessa gerarchia delle sezioni
- stesso comportamento dei preset
- stesso pattern per esecuzione e log
- stesso sistema di feedback

Questo e essenziale perche il prodotto venga percepito come un sistema unico.

## 25. Regole UI da non rompere

Queste regole sono vincolanti:

- una sola azione primaria per schermata
- nessuna logica di business nascosta in UI
- opzioni avanzate collassabili
- log e stato sempre presenti in modo leggibile
- preset sempre trattati come parte del workflow
- layout dei tool coerente tra loro
- feedback esplicito per successo, warning ed errore
- campi critici posizionati nella parte alta della schermata

## 26. Decisione di design complessiva

Il prodotto deve collocarsi visivamente tra:

- pannello tecnico professionale
- strumento di editing ordinato
- interfaccia da produzione reale

Non deve collocarsi tra:

- dashboard SaaS generica
- software creativo rumoroso
- utility grezza da sviluppatore

## 27. Prossimo documento

Dopo questo file, il prossimo documento da produrre e:

`docs/tools/auto-layout.md`

Quel documento dovra tradurre questi principi UI in una specifica completa del primo tool, includendo:

- requisiti
- flusso operativo
- algoritmo iniziale
- struttura dati
- edge case
- comportamento preciso della UI dedicata
