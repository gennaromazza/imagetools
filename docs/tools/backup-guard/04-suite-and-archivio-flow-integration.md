# Integrazione con FileX Suite e Archivio Flow

## Registrazione nella Suite

Identita' tecnica prevista:

| Campo | Valore |
|---|---|
| Tool ID | `backup-guard` |
| Display name | FileX Backup Guard |
| Package | `@photo-tools/backup-guard` |
| Eseguibile | `FileX-Backup-Guard` |
| Brand asset | `backup-guard` |
| Tag release | `backup-guard-vX.Y.Z` |
| Canale | stable/beta indipendente |

L'inserimento richiedera' estensione di `DesktopToolId`, tool manifest, branding sync, builder, process coordinator, cataloghi release e sito download. La release aggiorna soltanto Backup Guard secondo il contratto indipendente FileX.

## Responsabilita'

| Archivio Flow | Backup Guard |
|---|---|
| importa e organizza da SD | confronta master e clone |
| crea e rinomina lavori | trasferisce e verifica dati |
| mantiene il registro lavori | mantiene baseline e cronologia backup |
| segnala nuovi lavori | restituisce stato di protezione |
| apre strumenti successivi | gestisce cancellazioni, conflitti e recuperi |

Nessun tool legge direttamente il database privato dell'altro.

## Contratto proposto

```ts
interface BackupGuardProjectNotification {
  schemaVersion: 1;
  eventId: string;
  projectId: string;
  projectName: string;
  masterRootId: string;
  absolutePath: string;
  relativePath: string;
  importedAt: string;
  fileCount: number;
  totalBytes: number;
}

type ProjectProtectionState =
  | "unprotected"
  | "waiting-for-clone"
  | "queued"
  | "syncing"
  | "verified"
  | "warning"
  | "conflict";

interface BackupGuardProjectStatus {
  projectId: string;
  state: ProjectProtectionState;
  verifiedAt: string | null;
  cloneId: string | null;
  message: string;
}
```

Gli eventi sono idempotenti tramite `eventId`. Backup Guard accetta la notifica solo se `absolutePath` risolve dentro il master registrato e `relativePath` non evade dalla radice.

## Flusso nuovo lavoro

1. Archivio Flow completa importazione e registrazione.
2. Pubblica la notifica nel broker locale FileX o tramite IPC persistente.
3. Backup Guard registra il lavoro come `waiting-for-clone`.
4. Se il clone corretto e' collegato, esegue una scansione mirata.
5. I nuovi file senza conflitti possono entrare nella coda automatica.
6. Dopo checksum positivo lo stato diventa `verified`.
7. Archivio Flow mostra `2 copie verificate` e la data.

Se Backup Guard e' chiuso, la notifica resta in una coda locale persistente. Archivio Flow non deve considerare protetto un lavoro solo perche' l'evento e' stato consegnato.

## Apertura incrociata

Archivio Flow puo' aprire Backup Guard sul lavoro interessato tramite argomento validato, ad esempio `--project-id`. Backup Guard puo' aprire la cartella del lavoro, ma non modificare il registro di Archivio Flow.

## Stato nella FileX Suite

La scheda Suite puo' mostrare un riepilogo non sensibile: clone collegato, ultima verifica, lavori in attesa e presenza di conflitti. Le azioni distruttive restano dentro Backup Guard.

