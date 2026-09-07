# Icone Windows e collegamenti FileX

L'icona della finestra, quella incorporata nell'eseguibile e quella del pulsante
della barra delle applicazioni sono configurazioni distinte.

Ogni processo Electron imposta `setAppDetails` su tutte le finestre: identità,
ICO dedicata e, per i pacchetti installati, comando e nome di riapertura.
Le build Dev usano il suffisso `.dev` per non ereditare i collegamenti installati.

`npm run test:filex-windows-icons`, disponibile nella Dev Console e richiamato
da `build:shell`, controlla tutti i componenti del manifest: ICO decodificate
alle diverse scale, immagini vuote e policy di finestre e installer.
Un nuovo componente incompleto fa fallire la verifica anche nelle build release.

## Audit locale

Dalla radice, con Electron disponibile:

```powershell
& ./apps/filex-desktop/node_modules/electron/dist/electron.exe ./scripts/audit-filex-shortcuts.cjs --output=D:/IMAGETOOL_REMOTE/.codex-remote-attachments/shortcut-audit
```

Controlla Desktop, menu Start utente e condiviso e collegamenti fissati alla barra.
Riconosce i nomi correnti e legacy del manifest nelle cartelle standard di
installazione. I percorsi personalizzati richiedono un controllo esplicito.
`report.json` distingue installazioni assenti e collegamenti incoerenti.

La modalità predefinita non modifica collegamenti. `--repair` aggiorna
destinazione, icona, identità e cartelle di lavoro inesistenti e crea i
collegamenti utente mancanti. Prima di modificare salva una copia del `.lnk`.
Usare una directory di audit nuova a ogni riparazione. Il menu Start condiviso
richiede privilegi amministrativi. Non elimina collegamenti né cache.

Nel caso Image Select Pro, il collegamento legacy “Selezione Foto” conservava
la stessa identità Windows ma puntava alla vecchia installazione in Program Files.
L'icona dell'eseguibile corrente era corretta: il collegamento obsoleto può fare
ereditare alla barra un percorso icona non più valido.

Questi controlli non sostituiscono la prova della release installata: verificare
EXE, collegamenti, avvio dalla Suite e riapertura dalla barra. Cache Windows e
collegamenti modificati esternamente possono richiedere un nuovo audit.
