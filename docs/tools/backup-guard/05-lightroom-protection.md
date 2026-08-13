# Protezione dei cataloghi Lightroom Classic

## Pacchetto logico

Quando viene rilevato `Nome.lrcat`, Backup Guard associa, se presenti:

- `Nome.lrcat-data`;
- `Nome Previews.lrdata`;
- `Nome Smart Previews.lrdata`;
- altri contenitori `.lrdata` riconosciuti;
- cartella `Backups` configurata sotto la radice;
- file originali, se appartengono alla coppia protetta.

Il catalogo, i dati AI e gli indici associati sono pianificati come una singola unita' coerente. Le fotografie restano normali contenuti dell'archivio e non sono implicitamente incluse dal solo backup `.lrcat`.

## Lock e stabilita'

La presenza del corrispondente `.lrcat.lock` indica un catalogo aperto. In questo stato il pacchetto viene rinviato e la UI chiede di chiudere Lightroom. Il lock non viene copiato ne' rimosso da Backup Guard.

Dopo la scomparsa del lock, dimensioni e timestamp devono rimanere stabili per una finestra configurata prima della scansione. L'intero pacchetto viene copiato in staging, verificato e attivato insieme.

## Catalogo modificato sul clone

Se solo il pacchetto clone e' cambiato rispetto alla baseline:

1. rilevare Lightroom chiuso;
2. creare snapshot di recupero del pacchetto master;
3. presentare `Importa il lavoro Lightroom nel principale`;
4. copiare il pacchetto in staging sul master;
5. verificare ogni componente obbligatorio;
6. attivare atomicamente la nuova versione;
7. sincronizzare nuovamente il clone e registrare la sessione.

Questa e' una promozione esplicita, non una normale sovrascrittura automatica.

## Modifiche su entrambi

Se master e clone sono entrambi cambiati, Backup Guard conserva le versioni e crea un conflitto. Non modifica SQLite interno a `.lrcat` e non tenta una fusione. La UI guida l'utente verso il flusso ufficiale `Importa da un altro catalogo` di Lightroom.

## Profili di spazio

- **Protezione completa**, predefinita: catalogo, `.lrcat-data`, preview, Smart Preview e backup.
- **Essenziale:** catalogo, `.lrcat-data` e backup; esclude soltanto cache ricostruibili dopo avviso.

Il file `.lrcat-data` non e' mai classificato come cache sacrificabile.

## Cronologia dedicata

Registra nome catalogo, versione rilevata, componenti, lock, direzione, snapshot precedente, checksum ed esito. La cronologia non deve affermare che le fotografie sono protette se si trova protetto soltanto il catalogo.

