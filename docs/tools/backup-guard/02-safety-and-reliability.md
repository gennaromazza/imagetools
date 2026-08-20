# Sicurezza, affidabilita' e cancellazioni

## Regole non negoziabili

1. Mai dedurre una cancellazione da un master non montato, vuoto o parzialmente leggibile.
2. Mai sovrascrivere un file esistente nel master con un file proveniente dal clone.
3. Mai aggiornare la baseline prima della verifica finale.
4. Mai eseguire un piano costruito per volumi diversi da quelli attualmente identificati.
5. Mai copiare un file ancora in scrittura senza stabilita' verificata.

## Identita' dei volumi

Ogni coppia conserva UUID FileX, identificatore del volume, seriale disponibile, filesystem, capacita', percorso normalizzato e impronta della radice. Un marcatore `.filex-backup-guard/volume.json` identifica il clone. Sul master il marcatore non autorizza mutazioni: serve soltanto a impedire scambi di ruolo.

La lettera unita' Windows non e' un'identita' affidabile e puo' cambiare.

## Propagazione delle cancellazioni

Una cancellazione master verso clone e' ammessa quando:

- l'elemento esiste nella baseline valida;
- il master corretto e' completamente accessibile;
- il clone corretto e' collegato;
- nessun discendente presenta una modifica clone successiva alla baseline;
- la soglia di cancellazione massiva non e' superata senza conferma rafforzata.

Le cancellazioni sono raccolte in una sezione separata del piano. Per impostazione iniziale sono spostate nel cestino interno del clone, mantenendo percorso relativo, metadati e sessione di origine. La retention predefinita e' 30 giorni, modificabile; lo svuotamento e' sempre registrato.

## Kill switch per anomalie

Il piano viene bloccato se si verifica almeno una condizione:

- radice master assente, reindirizzata o improvvisamente vuota;
- oltre il 10% degli elementi o oltre 500 GB risultano da cancellare;
- filesystem segnala errori o sola lettura inattesa;
- baseline mancante, danneggiata o incompatibile;
- orologio di sistema incoerente;
- spazio insufficiente per staging e operazioni previste;
- junction, symlink o reparse point escono dalla radice autorizzata;
- Lightroom mantiene un lock su un catalogo interessato.

Le soglie generano una revisione rafforzata, non un bypass automatico.

## Trasferimento atomico

Ogni file segue gli stati:

`planned -> staging -> copied -> hashed -> committed -> verified`

La copia viene scritta con nome temporaneo nella stessa destinazione finale, sincronizzata, verificata e rinominata atomicamente. Un file incompleto non assume mai il nome definitivo. Il journal consente il recupero dopo crash, perdita alimentazione o disconnessione.

## Rinomina di una cartella gia' protetta

Quando una cartella del master cambia soltanto nome, Backup Guard non deve interpretare l'evento come cancellazione seguita da una nuova copia. La rinomina diretta sul clone e' ammessa esclusivamente quando:

- vecchio e nuovo nome si trovano nella stessa cartella padre;
- la vecchia cartella esiste nella baseline e sul clone, ma non piu' nel master;
- struttura, dimensioni e timestamp dei file identificano una sola corrispondenza possibile;
- tutti i file del nuovo percorso master e del vecchio percorso clone hanno lo stesso checksum SHA-256;
- il percorso di destinazione sul clone non esiste gia'.

La verifica dei checksum avviene prima di qualsiasi modifica. Se la corrispondenza e' ambigua o un solo contenuto differisce, Backup Guard non rinomina nulla automaticamente e conserva il piano ordinario da sottoporre all'utente. Una rinomina valida trasferisce `0` byte, non usa il cestino e aggiorna la baseline soltanto dopo la verifica finale.

## Checksum e scansione

- File nuovi o modificati: checksum completo obbligatorio su origine e destinazione.
- File invariati: confronto rapido con catalogo, dimensione, timestamp preciso e identificatori disponibili.
- Verifica profonda: ricalcolo progressivo dei checksum di tutto l'archivio.
- Algoritmo iniziale: SHA-256 per interoperabilita' e audit; un hash piu' rapido puo' essere aggiunto soltanto come acceleratore, non come unica prova persistente.

## Cronologia e audit

Ogni sessione registra identita' dei volumi, baseline, piano, conferme, operazioni, byte, checksum, retry, errori, durata e risultato. Ogni cancellazione registra percorso, dimensione, hash precedente, data di scomparsa dal master, data di propagazione, cestino e data di scadenza.

La cronologia non e' modificabile dalla UI. Puo' essere filtrata ed esportata in JSON e CSV; un report PDF potra' essere aggiunto successivamente.

