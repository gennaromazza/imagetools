# FileX Send Remote Server

Servizio HTTP indipendente per la modalità **A distanza** di FileX Send. Il server crea una sessione temporanea, presenta al cliente la pagina di upload e conserva i file solo finché il desktop non li ha scaricati e confermati.

## Avvio locale

```powershell
$env:FILEX_SEND_CREATE_TOKEN = "scegli-un-token-lungo"
$env:FILEX_SEND_PUBLIC_URL = "http://127.0.0.1:4355"
npm.cmd run dev:filex-send-remote-server
```

Configurare il desktop con gli stessi valori:

```powershell
$env:FILEX_SEND_REMOTE_URL = "http://127.0.0.1:4355"
$env:FILEX_SEND_CREATE_TOKEN = "scegli-un-token-lungo"
npm.cmd run dev:filex-send
```

## Variabili

- `FILEX_SEND_HOST`: interfaccia di ascolto, default `0.0.0.0` nell'avvio standalone.
- `FILEX_SEND_PORT`: porta HTTP, default `4355`.
- `FILEX_SEND_PUBLIC_URL`: URL HTTPS pubblico usato nei link cliente.
- `FILEX_SEND_CREATE_TOKEN`: autorizza la creazione delle sessioni desktop.
- `FILEX_SEND_DATA_DIR`: cartella temporanea dei file.

## Contratto di sicurezza MVP

- token pubblico casuale distinto dal token desktop;
- sessione con scadenza automatica di 24 ore;
- massimo 25 GB per file;
- scrittura temporanea e pubblicazione atomica a upload completo;
- download desktop autenticato;
- eliminazione del singolo file subito dopo la conferma desktop;
- eliminazione dell'intera sessione alla chiusura o alla scadenza.

## Prima della produzione

Il server deve essere ospitato dietro HTTPS con dominio stabile, volume persistente, limiti di traffico, monitoraggio, backup esclusi per la cartella temporanea e un sistema di autenticazione dispositivi. Il token statico dell'MVP è sufficiente per test controllati ma deve essere sostituito da credenziali per-installazione prima della pubblicazione.

Nell'MVP i metadati delle sessioni sono mantenuti in memoria: un riavvio invalida i link ancora aperti. Prima della produzione vanno persistiti in un database leggero o in uno store condiviso.
