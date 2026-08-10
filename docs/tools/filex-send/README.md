# FileX Send

FileX Send riceve foto e video dal telefono di un cliente direttamente su un PC Windows collegato alla stessa rete locale. Il telefono non richiede app, account o accesso a servizi cloud.

La versione installata e' sempre visibile nella barra del titolo. Gli aggiornamenti dalla Suite preservano impostazioni, sessioni remote e dati locali; anche le installazioni precedenti che restituivano codice `2` vengono migrate automaticamente senza disinstallazione manuale.

## Flusso MVP

1. Il fotografo collega il PC all'access point dedicato `FileX Send` e apre il tool.
2. Preme **Nuovo trasferimento** e, facoltativamente, inserisce il nome del cliente.
3. Il tool crea una cartella e mostra due passaggi: QR Wi-Fi e QR di invio valido solo per quella sessione.
4. Il cliente scansiona il primo QR per collegarsi alla rete, poi il secondo per scegliere foto e video e premere **Invia ora**.
5. Il fotografo vede i file ricevuti e conclude con **Termina sessione**.

I file transitano esclusivamente nella LAN e vengono scritti a flusso in una cartella locale. I trasferimenti incompleti usano l'estensione temporanea `.filex-part` e non vengono presentati come file completati.

## Modalità A distanza

La schermata iniziale chiede soltanto dove si trova il cliente:

- **Qui con me** mantiene il trasferimento diretto nella LAN.
- **A distanza** crea un link temporaneo da condividere via WhatsApp, email o SMS.

Il fotografo imposta data e ora di scadenza del link, da 15 minuti fino a 7 giorni. Il cliente lo apre senza account e può inviare anche mentre il PC è spento o FileX Send è chiuso. Alla riapertura, FileX Send scarica automaticamente nella cartella scelta tutto ciò che è in attesa.

Lo stesso collegamento può essere usato più volte fino alla scadenza. Al termine di ogni gruppo la pagina conferma la consegna e propone **Invia altri file**; questa conferma non chiude la sessione. Soltanto la data impostata oppure **Archivia invio** dal PC disattivano definitivamente il link.

La scadenza chiude soltanto la possibilità di aggiungere nuovi file. I file già ricevuti restano nello storage finché il PC non li scarica e ne verifica la dimensione; dopo la conferma rimangono recuperabili per un'ora, quindi la pulizia automatica li elimina.

Il servizio pubblico è distribuito nel progetto Firebase **FileX Cloud** (`gen-lang-client-0321087169`):

- Firebase Hosting pubblica la pagina mobile HTTPS;
- Cloud Functions 2nd gen espone l'API autenticata in `europe-west1`;
- Firestore conserva esclusivamente metadati e stato temporaneo della sessione;
- il bucket privato europeo `filex-cloud-391620173227-eu` conserva i file fino alla consegna;
- Cloud Scheduler controlla ogni 15 minuti i file confermati e conserva senza scadenza quelli ancora da scaricare;
- Firebase Anonymous Auth assegna automaticamente un'identità a ogni installazione, senza login o password per il fotografo.

URL di collaudo: `https://gen-lang-client-0321087169.web.app`. Il dominio tecnico verrà sostituito da un dominio FileX personalizzato prima della pubblicazione commerciale.

Il precedente workspace `apps/filex-send-remote-server` resta disponibile come server locale di test e riferimento provider-neutral.

Se il PC è spento, il cliente può completare l'upload nel cloud. FileX Send salva la sessione e il token desktop cifrati con Windows DPAPI, li ripristina all'avvio, scarica i file mancanti e mostra una notifica Windows. Il collegamento della stessa notifica direttamente al launcher FileX Suite è un'integrazione successiva: oggi il recupero automatico parte quando viene aperto FileX Send.

FileX Send rileva automaticamente la rete Wi-Fi attiva e importa SSID e password dal profilo Windows. Le credenziali vengono cifrate tramite la protezione credenziali di Windows e riutilizzate quando il PC torna collegato via Ethernet. Se il PC non ha mai conosciuto la rete clienti, deve collegarsi una volta al Wi-Fi oppure usare la configurazione manuale di emergenza.

## Gestione Firebase da terminale

```powershell
npm.cmd run build:filex-cloud
npm.cmd run test:filex-cloud
firebase.cmd deploy --project gen-lang-client-0321087169 --only "functions:filex-cloud,hosting,firestore"
```

Le regole Firestore negano ogni accesso diretto dal browser; tutte le operazioni passano dall'API, che conserva soltanto hash dei token di sessione. L'identità anonima dell'installazione e i token desktop vengono salvati localmente tramite Windows DPAPI.

## Avvio per sviluppo

```powershell
npm.cmd run dev:filex-send
```

Test e build del solo componente:

```powershell
npm.cmd --workspace @photo-tools/filex-send run test
npm.cmd --workspace @photo-tools/filex-send run typecheck
npm.cmd run build:filex-send
```

## Configurazione di rete consigliata

- Access point dedicato con SSID `FileX Send`.
- PC collegato via Ethernet allo stesso apparato.
- Rete separata dalla rete amministrativa del negozio.
- Regola che permetta ai client di raggiungere esclusivamente il PC sulla porta scelta automaticamente dal tool.
- Disattivazione dell'isolamento client verso il PC ricevente; gli smartphone possono restare isolati tra loro.

Alla prima esecuzione Windows può chiedere di consentire FileX Send sulle reti private. Senza tale autorizzazione il QR si apre sul PC, ma non dal telefono.

## Limiti dell'MVP

- Il collegamento e l'apertura dell'invio usano due QR separati. Un unico passaggio automatico richiederebbe un captive portal configurato sull'access point.
- È attiva una sola sessione alla volta per installazione desktop.
- La ripresa automatica di un singolo file interrotto non è ancora implementata; il cliente può ripetere l'invio.
- Il tool sceglie automaticamente il primo indirizzo IPv4 privato. La selezione manuale dell'interfaccia sarà utile sui PC collegati a più reti.
- Il limite corrente è 25 GB per singolo file.

## Sicurezza implementata

- Token casuale non prevedibile per ogni sessione.
- Password Wi-Fi salvata cifrata tramite `safeStorage`/Windows DPAPI, mai in chiaro nel file impostazioni.
- Invalidazione immediata del link quando il fotografo termina la sessione.
- Sanitizzazione dei nomi e blocco dei percorsi esterni alla cartella di ricezione.
- Rinomina automatica dei duplicati senza sovrascrittura.
- File temporanei distinti finché la dimensione ricevuta non coincide con quella dichiarata.
- Bucket con prevenzione dell'accesso pubblico e upload tramite URL resumable monouso.
- Metadati Firestore non accessibili direttamente ai client.
- Eliminazione del file cloud soltanto dopo download locale e verifica della dimensione.
- Scadenza configurabile del link da 15 minuti a 7 giorni, senza cancellare i file ancora da scaricare.
- Cancellazione automatica un'ora dopo la conferma del download locale.
- Identità Firebase anonima per installazione e credenziali locali cifrate tramite Windows DPAPI.
