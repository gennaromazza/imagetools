# FileX Adobe Cleaner

**La utility FileX dedicata esclusivamente alla manutenzione dei programmi Adobe supportati.**
Non analizza né pulisce cache generiche di Windows o di applicazioni non Adobe.

## Stato

- Nome: **FileX Adobe Cleaner**.
- Tool ID: `cache-sweep`.
- Package: `@photo-tools/cache-sweep`.
- Eseguibile: `FileX-Adobe-Cleaner.exe`.
- Piattaforma: Windows 10/11 x64.
- Versione iniziale: `0.1.0`.
- Stato: release stabile `0.1.0`, distribuita come componente indipendente della Suite.
- Ultimo aggiornamento: 9 agosto 2026.

## Obiettivo

Il tool lavora esclusivamente sui programmi Adobe: rileva le applicazioni installate, misura soltanto cache comprese
in una whitelist locale e spiega le conseguenze prima della cancellazione.
Progetti, fotografie, cataloghi, preset, preferenze, licenze, documenti cloud e
dati di recupero non fanno parte del perimetro eliminabile.

La promessa di prodotto è:

> Trovare le applicazioni Adobe installate e pulire in sicurezza le cache
> supportate, con anteprima, spiegazioni e conferma dell'utente.

Adobe Cleaner rileva inoltre due o più versioni principali dello stesso prodotto,
mantiene sempre esclusa la più recente e può proporre la rimozione delle versioni
precedenti tramite il disinstallatore ufficiale Adobe.

Non è un pulitore generico del PC e non interviene su software non Adobe. Anche
nel perimetro Adobe opera soltanto sulle cache esplicitamente supportate.

## Decisioni approvate

1. La prima versione è solo Windows.
2. macOS sarà affrontato insieme alla futura migrazione della FileX Suite.
3. Prima della pulizia vengono individuati i processi Adobe coinvolti.
4. FileX richiede prima una chiusura normale.
5. La chiusura forzata richiede una seconda conferma esplicita.
6. Le categorie avanzate non sono selezionate automaticamente.
7. L'UAC deve comparire soltanto per regole che richiedono davvero elevazione.
8. L'MVP opera su cache dell'utente e non necessita normalmente di UAC.

## Fonti ufficiali Adobe

Adobe non espone una singola API consumer per enumerare tutte le applicazioni
Creative Cloud installate e pulirne ogni cache. Remote Update Manager può
elencare aggiornamenti applicabili, ma è uno strumento enterprise che richiede
un precedente deployment Adobe e privilegi elevati; non è usato come sorgente
primaria.

- [Creative Cloud Developer Platform](https://developer.adobe.com/creative-cloud)
- [Adobe Remote Update Manager](https://helpx.adobe.com/uk/enterprise/using/using-remote-update-manager.html)
- [Disinstallare applicazioni Creative Cloud](https://helpx.adobe.com/creative-cloud/apps/manage-apps/creative-cloud-apps/uninstall-or-remove-apps.html)
- [Adobe Uninstall Tool e rimozione di versioni selezionate](https://helpx.adobe.com/in/enterprise/using/uninstall-creative-cloud-products.html)
- [Codici SAP e versioni base Creative Cloud](https://helpx.adobe.com/in/enterprise/kb/adobe-cc-app-base-versions.html)
- [Aggiornamenti automatici e rimozione delle versioni precedenti](https://helpx.adobe.com/uk/creative-cloud/apps/manage-apps/creative-cloud-apps/update-creative-cloud-apps-automatically.html)
- [Registro Windows e pacchetti Adobe](https://helpx.adobe.com/in/enterprise/using/querying-client-machines-to-check-if-a-package-is-deployed.html)
- [Premiere: gestione Media Cache](https://helpx.adobe.com/premiere/desktop/troubleshooting/media-issues/manage-media-cache.html)
- [Premiere: eliminazione manuale](https://helpx.adobe.com/nz/premiere/desktop/troubleshooting/media-issues/delete-media-cache-files-manually.html)
- [Media Encoder: database cache condiviso](https://helpx.adobe.com/media-encoder/using/media-cache-database.html)
- [After Effects: memoria e Disk Cache](https://helpx.adobe.com/uk/after-effects/using/memory-storage1.html)
- [Lightroom Classic: cache e anteprime](https://helpx.adobe.com/lightroom-classic/kb/optimize-performance-lightroom.html.html)
- [Camera Raw: gestione cache](https://helpx.adobe.com/camera-raw/using/introduction-camera-raw.html)
- [Bridge: Cache Management](https://helpx.adobe.com/bridge/desktop/get-started/set-cache-management-preferences.html)
- [Bridge: troubleshooting cache](https://helpx.adobe.com/ae_en/bridge/kb/troubleshoot-errors-freezes-bridge.html)
- [Photoshop: Purge e memoria](https://helpx.adobe.com/photoshop/kb/optimize-photoshop-cc-performance.html)
- [InDesign: cache, preferenze e support files](https://helpx.adobe.com/indesign/desktop/troubleshoot/settings-interface-and-feature-issues/preferences-support-file-locations.html)

## Matrice MVP

| Prodotto | Categoria | Stato | Predefinita |
| --- | --- | --- | --- |
| Premiere Pro | Media Cache condivisa | Supportata | Sì |
| Media Encoder | Media Cache condivisa | Supportata | Sì |
| After Effects | Media Cache condivisa | Supportata | Sì |
| After Effects | Disk Cache personalizzata | Da implementare | No |
| Lightroom Classic | Camera Raw Cache | Supportata | Sì |
| Lightroom Classic | `Previews.lrdata` nella posizione predefinita | Avanzata | No |
| Bridge | Camera Raw Cache | Supportata | Sì |
| Bridge | Cache locale | Attenzione | No |
| Photoshop | Camera Raw Cache | Supportata | Sì |
| Photoshop | Memoria, history, clipboard e scratch | Solo dall'app | No |
| InDesign | Sole sottocartelle `Cache` locali | Attenzione | No |
| Illustrator | Solo rilevato | Non supportata | No |
| Acrobat/Reader | Solo rilevato | Non supportata | No |
| Creative Cloud Desktop | Solo rilevato | Non supportata | No |

Le cache condivise appaiono una sola volta anche quando sono usate da più
applicazioni.

## Rilevamento Windows

Il servizio legge in sola lettura:

- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`;
- `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall`, vista 64 bit;
- la stessa chiave `HKLM`, vista 32 bit;
- `DisplayName`, `DisplayVersion`, `InstallLocation`, `DisplayIcon` e Publisher.

Le installazioni vengono mappate a un prodotto conosciuto e deduplicate per ID,
versione e posizione. Applicazioni Adobe sconosciute o senza regole vengono
mostrate come `solo rilevate` e non autorizzano alcuna cancellazione.

I processi attivi vengono letti tramite `tasklist.exe` e confrontati con nomi
eseguibile espliciti. Non vengono terminati processi per publisher, cartella o
somiglianza del nome.

## Profili UX

- **Consigliata**: Media Cache e Camera Raw rigenerabili.
- **Personalizzata**: selezione manuale voce per voce.
- **Profonda**: include Bridge, Lightroom Previews e InDesign; richiede comunque
  conferma.

Ogni scheda contiene:

- applicazioni coinvolte;
- spazio e numero di file;
- cosa viene eliminato;
- cosa accade alla riapertura;
- rischio e avvertenze;
- percorsi espandibili.

Il flusso è:

```text
scansione read-only
  -> selezione
  -> riepilogo conseguenze
  -> rilevamento processi coinvolti
  -> richiesta chiusura normale
  -> eventuale seconda conferma per chiusura forzata
  -> nuova scansione e validazione target
  -> pulizia
  -> verifica e report
```

## Sicurezza filesystem

Le regole accettano soltanto directory con nomi finali ammessi:

- `Media Cache`;
- `Media Cache Files`;
- `Cache`;
- `*Previews.lrdata`.

Il target deve inoltre essere discendente di una root autorizzata nel profilo
Windows corrente. Sono rifiutati:

- percorsi relativi;
- root di volume;
- la root autorizzata stessa;
- cartelle Adobe generiche;
- target con un nome non previsto;
- symlink, junction e reparse point attraversabili;
- elementi il cui `realpath` esce dalla root canonica.

Il renderer invia soltanto `ruleId`. Non riceve primitive filesystem generiche e
non può sostituire i percorsi. Il processo Electron risolve nuovamente regole,
processi e target immediatamente prima della cancellazione.

La directory radice della cache viene conservata. Vengono eliminati i suoi file
e le sottocartelle normali, uno alla volta. Un errore o file bloccato viene
riportato e non causa elevazione automatica, ampliamento del percorso o uso di
una cancellazione più aggressiva.

## Chiusura dei processi

Il backend costruisce l'insieme dei processi soltanto dalle regole selezionate.
La UI ricorda di salvare documenti e progetti, quindi invoca una chiusura normale
con `taskkill` senza `/F`.

Se restano processi attivi, la UI mostra applicazione e PID. `/F` viene usato
solo dopo una seconda conferma che avverte esplicitamente della possibile perdita
di modifiche non salvate.

Se un processo coinvolto è ancora aperto al momento della pulizia, la relativa
categoria viene classificata `blocked` e non viene modificata.

## Vecchie versioni Adobe

Il confronto è deliberatamente conservativo: una versione viene proposta solo
quando esiste un'altra installazione dello stesso prodotto con numero principale
superiore. Aggiornamenti differenti della stessa versione principale non vengono
mai classificati come installazioni obsolete.

Immediatamente prima della rimozione il backend ripete la scansione e verifica
che il candidato sia ancora precedente. FileX tenta la chiusura normale dei soli
processi del prodotto; se restano aperti, l'operazione viene bloccata.

La rimozione usa esclusivamente l'Adobe HDBox `Setup.exe` nella posizione ufficiale
Adobe, con codice SAP e versione base risolti dal backend. Viene passato
`--deleteUserPreferences=false`; la versione corrente non è mai inclusa. Windows
mostra l'UAC perché il disinstallatore richiede privilegi amministrativi. Se HDBox
non è disponibile, FileX non usa procedure generiche e rimanda a Creative Cloud
Desktop.

## Architettura

```text
apps/cache-sweep/
  package.json
  src/
    App.tsx
    contracts.ts
    dev-api.ts
    styles.css
  electron/
    main.ts
    preload.cts
    cache-sweep-service.ts
    cache-sweep-service.test.ts
```

- Il renderer React/Vite gestisce presentazione e consenso.
- Il preload espone tre sole operazioni: `scan`, `closeProcesses`, `cleanup`.
- Il main Electron registra gli handler e crea una finestra sandboxed.
- Il servizio nativo contiene discovery, regole, path guard e pulizia.
- Il codice Electron appartiene al workspace Cache Sweep e viene compilato nella
  directory di staging del builder desktop.

L'ASAR del tool contiene soltanto i suoi entrypoint e non include Sharp,
ExifTool, servizi fotografici o moduli Node esterni.

## Branding

Master:

```text
ICONE E LOGHI/filex-generated/cache-sweep.png
```

L'icona usa sfondo verde foresta, livelli cache menta, spazzola gialla e stile 3D
coerente con FileX. Non contiene loghi, testo o marchi Adobe. La pipeline di
branding genera l'ICO multirisoluzione per eseguibile e installer.

## Comandi

```powershell
npm.cmd --workspace @photo-tools/cache-sweep run typecheck
npm.cmd --workspace @photo-tools/cache-sweep run test
npm.cmd --workspace @photo-tools/filex-desktop run build:cache-sweep
npm.cmd --workspace @photo-tools/filex-desktop run dev:cache-sweep
npm.cmd --workspace @photo-tools/filex-desktop run dist:cache-sweep:win
```

## Integrazione FileX

Sono presenti:

- `DesktopToolId` e descriptor `cache-sweep`;
- branding Suite e Dock;
- scheda categoria Utility;
- build e dist indipendenti;
- mapping del generatore catalogo;
- mapping di verifica ASAR;
- trigger e selezione nel workflow Windows Release;
- note di rilascio `0.1.0`;
- test del contratto indipendente.

Una futura release userà:

- tag `cache-sweep-vX.Y.Z`;
- installer `FileX-Adobe-Cleaner-X.Y.Z-stable-x64-setup.exe`;
- aggiornamento della sola voce `cache-sweep` nel catalogo tool;
- nessuna variazione di versione o build della Suite e degli altri tool.

## Verifiche completate

- typecheck workspace Cache Sweep;
- typecheck globale workspaces;
- test path guard e cancellazione su una cache temporanea isolata, con verifica che la directory radice venga conservata;
- test contratto release indipendente;
- build renderer;
- build host Electron;
- QA visivo con fixture locale;
- verifica dialogo di conferma;
- build NSIS x64 con `--publish never`;
- verifica versione, nome ed entrypoint nell'ASAR;
- verifica assenza di `node_modules` e runtime estranei nell'ASAR;
- generazione blockmap.

## Test ancora necessari prima della release

- Windows 10 e Windows 11 reali;
- account Windows standard e amministratore;
- più versioni delle applicazioni Adobe;
- cache configurate su altri dischi;
- processi Adobe con progetti non salvati;
- file bloccati e permessi insufficienti;
- junction e reparse point reali;
- cataloghi Lightroom con originali online e offline;
- metadata Bridge conservati solo nella cache;
- cartelle Recovery InDesign come sentinelle;
- idempotenza dopo una pulizia reale.

## Fuori ambito MVP

- macOS;
- pulizia per altri utenti Windows;
- UAC/helper elevato, finché nessuna regola lo richiede;
- cache personalizzate non risolvibili da fonti affidabili;
- modifica delle preferenze Adobe;
- cancellazione di cloud document o storage cloud;
- licenze, `SLCache`, `SLStore`, token e sincronizzazione;
- ottimizzazione generica di Windows;
- pulizia automatica pianificata;
- terminazione forzata senza conferma.
