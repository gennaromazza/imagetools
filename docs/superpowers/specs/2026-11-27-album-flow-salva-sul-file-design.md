# Album Flow — «Salva sul file» per lavorare da due PC

Data: 2026-11-27 · Stato: in attesa di approvazione dell'utente

## Perché

Lo studio ha due PC in rete. Il disco **E: «Archivio»** di DESKTOP-BT148BT è condiviso come `\\DESKTOP-BT148BT\E`.
Il fotografo vuole aprire lo stesso album su tutti e due i PC (per esempio sull'altro PC con gli sposi davanti), fare
qualche modifica e ritrovarla sul primo PC.

Oggi non succede: Album Flow tiene gli album nella memoria locale del singolo PC (`localStorage`, `model/store.ts`).
Il file `.filex-album.json` serve solo per esportare e importare, e «Apri progetto…» (`App.tsx`, `importProjectFile`)
sostituisce l'album con lo stesso `projectId` **senza chiedere conferma**.

## Obiettivi

1. Un album aperto da un file su disco resta **collegato** a quel file su quel PC.
2. Il pulsante **«Salva sul file»** nell'editor scrive l'album su quel file, sovrascrivendolo in modo sicuro.
3. Una scritta accanto al pulsante dice lo stato: «Salvato sul file», «Modifiche non salvate sul file» oppure «Il file è
   stato cambiato da un altro PC».
4. Uscita dall'album (pulsante «Album» verso la Home) con modifiche non salvate sul file: la finestra chiede «Salvare sul
   file prima di chiudere?» con Salva / Non salvare / Annulla.
5. Apertura di un album collegato, sia con «Apri progetto…» sia dalla Home: se il file è più nuovo dell'ultima volta che
   questo PC l'ha letto o scritto, Album Flow lo dice e chiede se caricarlo.
6. Niente più sostituzioni silenziose: «Apri progetto…» su un album che esiste già e ha modifiche locali non salvate
   chiede cosa fare.

## Non obiettivi

- Salvataggio automatico continuo (si potrà aggiungere più avanti su questa base).
- Lavorare contemporaneamente sullo stesso album da due PC, o unire modifiche fatte su due PC: vince una versione intera.
- Segnale «aperto su DESKTOP-…» accanto al file.
- Caroselli per i social nel file (restano nell'archivio locale per album, come oggi).
- Traduzione dei percorsi delle foto tra un PC e l'altro (vedi Vincoli).
- Funzionamento nel browser senza app desktop: lì «Salva sul file» non compare, restano esportazione e importazione di
  oggi.

## Anti-obiettivi (sarebbe un fallimento anche se funziona)

- Perdere modifiche in silenzio: un salvataggio che copre una versione più nuova scritta dall'altro PC senza dirlo, o un
  caricamento che cancella modifiche locali senza chiedere.
- Toccare le foto originali o i file accanto alle foto.
- Cambiare lo schema v2 del progetto (regola 5 di `apps/album-flow/AGENTS.md`).

## Vincoli

- **Percorsi delle foto.** Nel file è scritto il percorso completo di ogni foto. Sul PC principale le foto sono in `E:\...`.
  L'altro PC deve vedere la condivisione con la **stessa lettera E:** («Connetti unità di rete», `\\DESKTOP-BT148BT\E`,
  «Riconnetti all'accesso»). Va spiegato all'utente, non si risolve nel codice. Se sull'altro PC E: è occupata, serve
  un'altra soluzione da decidere a parte.
- **Nessun nuovo canale IPC.** Bastano le funzioni che il desktop offre già:
  - `getPathForFile(file)`: percorso del file scelto in «Apri progetto…»;
  - `readFile(path)`: contenuto, dimensione e `lastModified`;
  - `statFiles([path])`: dimensione e `lastModified`;
  - `writeFilesReplacing(cartella, [{ fileName, bytes }])`: scrive su un file provvisorio nella stessa cartella e lo
    rinomina sul nome finale.
- **Chiusura del programma.** La shell manda `prepare-close`, aspetta al massimo 20 s e non permette di annullare la
  chiusura (`main.ts`, `PHOTO_SELECTOR_CLOSE_PREPARATION_TIMEOUT_MS`). Lì non si può mostrare una domanda (vedi
  Decisioni).
- Testi in italiano e brevi, token di `styles.css`, scorciatoie `Ctrl` e `⌘`, nessun controllo spinto fuori vista a
  1100×740.

## Approcci considerati

1. **Album collegato con salvataggio automatico**: scrive sul file pochi secondi dopo ogni modifica e controlla i
   cambiamenti al ritorno sulla finestra. È il più comodo, ma è più lavoro da costruire e da provare (scritture continue
   in rete, conflitti a metà lavoro).
2. **«Salva sul file» più domanda all'uscita e avviso all'apertura** — **scelto dall'utente**. È semplice, poco invasivo,
   e lascia la base per aggiungere il salvataggio automatico più tardi.
3. **Backup su Google Drive esistente**: scartato. È lento, va su internet e il ripristino apre sempre una copia separata.

## Come funziona (deciso con l'utente)

### Collegamento al file

- Archivio locale per PC: `filex.albumFlow.fileLinks`, una mappa `projectId → { path, stamp, savedHash }`.
  - `stamp` = `size:lastModified` del file all'ultima lettura o scrittura fatta da questo PC;
  - `savedHash` = impronta del contenuto dell'album in quel momento (`serializeAlbumProject` senza media). Non si usa
    `updatedAt`, perché non tutte le operazioni lo aggiornano: lo fanno `touch` in alcuni moduli di `model/` e `rename`,
    non ogni `commit`.
  - Non entra nel file né nello schema.
- Il collegamento nasce quando:
  - si apre un file con «Apri progetto…» (percorso da `getPathForFile`);
  - si salva con «Salva sul file» su un album non ancora collegato: si sceglie la cartella e il nome è quello di oggi,
    `<nome>.filex-album.json`;
  - si salva il progetto da «Esporta» (`exportProjectFile`): anche quel file diventa il collegamento.

### Stato

- **Modifiche non salvate sul file**: l'impronta attuale è diversa da `link.savedHash`. Si calcola quando serve (scritta
  di stato con un breve ritardo dopo le modifiche, uscita, chiusura), non a ogni gesto: deve restare leggera anche con
  album grandi (626 foto, 105 spread).
- **Cambiato da un altro PC**: lo `stamp` attuale del file è diverso da `link.stamp`.
- **File non raggiungibile**: `statFiles` non lo trova (rete staccata, unità non collegata). Lo stato lo dice e
  «Salva sul file» spiega che il file non si raggiunge. L'album resta comunque salvato su questo PC.

### «Salva sul file»

1. `statFiles`: se il file è cambiato da un altro PC, chiede prima di scrivere:
   - «Sovrascrivi» (vince questo PC);
   - «Carica la sua versione» (le modifiche locali si perdono, e la finestra lo dice chiaramente);
   - «Annulla».
2. Scrive con `writeFilesReplacing` lo stesso contenuto di oggi (`serializeAlbumProject` con i media incorporati, come
   `exportProjectFile`).
3. Rilegge lo `stamp` e aggiorna il collegamento.

### Uscita dall'album

Se ci sono modifiche non salvate sul file, chiede Salva / Non salvare / Annulla. «Non salvare» lascia le modifiche su
questo PC e la volta dopo lo stato le mostra ancora come non salvate.

### Chiusura del programma

Non si può fare domande. Se l'album collegato ha modifiche non salvate e il file **non** è cambiato da un altro PC, Album
Flow lo salva sul file da solo, nel `prepare-close` già usato dal backup su Drive, che continua a funzionare com'è. Se il
file è cambiato o non si raggiunge, non scrive niente: le modifiche restano su questo PC e alla riapertura lo stato lo
segnala.

### Apertura

- **Dalla Home, album collegato**: `statFiles`.
  - Se il file è cambiato e non ci sono modifiche locali non salvate: avviso «C'è una versione più nuova salvata da un
    altro PC», con Carica / Tieni questa.
  - Se ci sono anche modifiche locali non salvate: stessa domanda, con l'avvertenza che caricando si perdono.
- **«Apri progetto…» su un album che esiste già** (stesso `projectId`):
  - se non ci sono modifiche locali non salvate, carica come oggi;
  - altrimenti chiede Carica il file / Tieni la versione di questo PC.
- Ogni caricamento dal file aggiorna `stamp` e `savedHash`.
- Il caricamento riusa il percorso di oggi: `parseAlbumProject`, `restoreEmbeddedMedia` e `upsert` esterno con
  `setRevision`, così il Workspace riparte dalla nuova versione e la cronologia annulla/ripeti ricomincia.

## Scelte lasciate a chi costruisce (decise da Claude, l'utente può correggerle)

- Logica di stato e decisione in un modulo puro (`model/fileLink.ts`): `(link, statoFile, project) → stato/azione`, con
  test. L'accesso al disco in `desktop/`.
- Posizione del pulsante e della scritta nella barra in alto dell'editor, accanto a «Album», con scorciatoia
  `Ctrl/⌘+S`. Oggi il tasto `S` da solo mostra e nasconde le misure (`toggleSizes`): la combinazione con `Ctrl/⌘` deve
  restare separata da quel tasto.
- Il controllo «cambiato da un altro PC» si fa solo all'apertura, al salvataggio e all'uscita, mai a intervalli.
- Test: `test:album-flow-filelink` alla radice, dentro `test:album-flow-all`, con la descrizione nella Dev Console. Per
  le prove con il file sul disco condiviso: due istanze puntate su una cartella di prova nello scratchpad, mai sugli album
  veri.
- Alla release: voce in `whatsNew.ts` con `where` = «Salva sul file», etichetta «Nuovo» con `useNewFeature` e pagina del
  sito. La release va fatta solo quando l'utente la chiede.
