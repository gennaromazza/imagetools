# Launcher FileX dalla barra Windows

Stato: implementato in sviluppo, non ancora rilasciato. Questa descrizione riguarda il nuovo launcher e sostituisce, per le prossime versioni, il comportamento della dock fluttuante descritto nelle verifiche storiche del runbook.

## Uso

Il clic sull'icona FileX nella barra ripristina una striscia orizzontale con i tool installati. I nomi compaiono al passaggio del mouse o al focus da tastiera. Il clic avvia il tool attraverso i controlli della Suite; il clic destro o Maiusc+F lo aggiunge ai preferiti.

La freccia ‹ espande ricerca, notifiche, aspetto e accesso alla gestione Suite; › richiude i comandi. La lente apre il campo di ricerca. La campanella mostra cronologia e contatore: un puntino mantiene visibili gli arrivi non letti quando i comandi sono chiusi. Esc chiude il pannello aperto e, alla pressione successiva, riduce il launcher. Il cambio di finestra lo riduce nella barra.

Tema verde FileX, nero, chiaro/scuro secondo Windows e colore personalizzato sono salvati localmente, insieme ai preferiti e allo stato di lettura/rimozione delle notifiche. La preferenza che disabilita la dock resta rispettata. L'avvio automatico mantiene il launcher ridotto senza aprire la gestione Suite.

## Posizione e limiti

Al ripristino dalla barra viene acquisito il punto del cursore nella taskbar: la finestra si centra su quel punto e mantiene lo stesso riferimento durante le espansioni. Non viene interrogata la posizione del pulsante Windows. Prima di un clic sulla barra, per esempio all'avvio Dev o da tastiera, il riferimento iniziale è il centro del monitor. I limiti dell'area utile impediscono alla finestra di uscire dallo schermo; sui monitor stretti le icone scorrono orizzontalmente.

## Notifiche FileX Send

La ricezione locale e remota pubblica eventi JSON atomici nella directory `FileX/notifications` sotto appData; le build Dev usano `FileX/notifications-dev`. La Suite Dev legge anche questi ultimi eventi. Il produttore conserva al massimo 100 eventi; il lettore limita dimensione e numero dei file e ignora quelli non validi. Un errore di notifica non invalida un trasferimento completato.

Serve anche FileX Send con questa integrazione: il tool installato precedente non pubblica gli eventi. Le notifiche native Windows restano disponibili. La dock raccoglie inoltre gli stati di aggiornamento della Suite e dei tool e lo stato della licenza.

## Sviluppo e verifica

Nella Dev Console, sezione Tool, avvia **FileX Suite Launcher**. Non richiede una porta renderer: lo stato pronto dipende dal caricamento effettivo della finestra. I test sono raggiungibili nella sezione Test, categorie Suite e FileX Send:

```powershell
npm run test:filex-suite-launcher
npm run test:filex-suite-dock-startup
npm run test:filex-windows-icons
npm run test:filex-send-bug-hunt
npm --workspace @photo-tools/filex-dev-console run typecheck
```

Il test Electron copre icone, tooltip, comandi espandibili, ricerca, temi, preferiti, notifiche e IPC della Suite con profilo isolato. I test di posizione coprono espansione, bordi e monitor con coordinate negative. Prima della release restano necessarie le verifiche sull'installer reale previste dal runbook: avvio dalla barra, licenza, aggiornamento e disinstallazione/reinstallazione.

Per icone bianche e collegamenti legacy consultare [Icone Windows](WINDOWS_ICONS.md). Le pagine prodotto sono `website/strumenti/filex-dock/index.html` e `website/strumenti/filex-send/index.html`; il loro aggiornamento nel repository non pubblica il sito.
