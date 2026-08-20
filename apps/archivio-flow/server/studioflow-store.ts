import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type ImportSessionStatus =
  | "CREATED" | "ANALYZING" | "READY" | "IMPORTING" | "VERIFYING"
  | "COMPLETED" | "PAUSED" | "FAILED" | "CANCELLED" | "INTERRUPTED";

export type ImportFileStatus =
  | "DISCOVERED" | "PLANNED" | "COPYING" | "COPIED" | "VERIFIED"
  | "DUPLICATE_ACCEPTED" | "SKIPPED" | "FAILED";

export interface ImportSessionRecord {
  id: string;
  cardSnapshotId: string | null;
  jobId: string | null;
  archiveId: string;
  sourceRoot: string;
  destinationRoot: string;
  destinationRelativePath: string;
  status: ImportSessionStatus;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  verifiedAt: number | null;
  totalFiles: number;
  plannedFiles: number;
  importedFiles: number;
  verifiedFiles: number;
  duplicateFiles: number;
  skippedFiles: number;
  failedFiles: number;
  totalBytes: number;
  importedBytes: number;
  syncStatus: "PENDING" | "SYNCING" | "SYNCED" | "FAILED_RETRYABLE" | "FAILED_PERMANENT";
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ImportFileRecord {
  sessionId: string;
  sourceRelativePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  fastFingerprint: string | null;
  fullHash: string | null;
  destinationPath: string;
  destinationSize: number | null;
  destinationFingerprint: string | null;
  status: ImportFileStatus;
  errorMessage: string | null;
  updatedAt: number;
}

export interface SafeToFormatFileEvidence {
  sourceRelativePath: string;
  sourceSize: number;
  fastFingerprint: string;
  destinationPath: string;
  sessionId: string;
}

export interface CardSnapshotRecord {
  id: string;
  cardId: string;
  volumeLabel: string;
  filesystem: string | null;
  capacityBytes: number;
  contentFingerprint: string;
  fileCount: number;
  totalBytes: number;
  captureSignature: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface OutboxRecord {
  id: number;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
}

const SCHEMA_VERSION = 3;
const MAX_CORRUPT_BACKUPS = 3;

export class StudioFlowStore {
  readonly databasePath: string;
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.databasePath = path.join(dataDir, "studioflow.sqlite");
    this.db = this.openWithRecovery();
    try {
      this.configure();
      this.migrate();
    } catch (error) {
      try { this.db.close(); } catch { /* best effort */ }
      if (!fs.existsSync(this.databasePath)) throw error;
      fs.renameSync(this.databasePath, `${this.databasePath}.corrupt-${Date.now()}`);
      fs.rmSync(`${this.databasePath}-wal`, { force: true });
      fs.rmSync(`${this.databasePath}-shm`, { force: true });
      this.pruneCorruptBackups();
      this.db = new DatabaseSync(this.databasePath);
      this.configure();
      this.migrate();
    }
    this.markAbandonedSessionsInterrupted();
    this.maybeCreateScheduledBackup();
  }

  close(): void {
    this.db.close();
  }

  private openWithRecovery(): DatabaseSync {
    try {
      return new DatabaseSync(this.databasePath);
    } catch (error) {
      if (!fs.existsSync(this.databasePath)) throw error;
      const corruptPath = `${this.databasePath}.corrupt-${Date.now()}`;
      fs.renameSync(this.databasePath, corruptPath);
      this.pruneCorruptBackups();
      return new DatabaseSync(this.databasePath);
    }
  }

  private pruneCorruptBackups(): void {
    const prefix = `${path.basename(this.databasePath)}.corrupt-`;
    const backups = fs.readdirSync(path.dirname(this.databasePath))
      .filter((name) => name.startsWith(prefix))
      .sort().reverse();
    for (const stale of backups.slice(MAX_CORRUPT_BACKUPS)) {
      fs.rmSync(path.join(path.dirname(this.databasePath), stale), { force: true });
    }
  }

  private configure(): void {
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const current = Number((this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version);
    if (current < 1) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
      this.db.exec(`
        CREATE TABLE archives (
          id TEXT PRIMARY KEY,
          root_path TEXT NOT NULL UNIQUE,
          hierarchy_json TEXT NOT NULL,
          last_full_scan_at INTEGER,
          last_reconciled_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE archive_entries (
          archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          entry_type TEXT NOT NULL CHECK(entry_type IN ('file','directory')),
          size INTEGER NOT NULL DEFAULT 0,
          mtime_ms REAL NOT NULL DEFAULT 0,
          fast_fingerprint TEXT,
          full_hash TEXT,
          seen_at INTEGER NOT NULL,
          PRIMARY KEY (archive_id, relative_path)
        );
        CREATE INDEX archive_entries_fingerprint_idx ON archive_entries(size, fast_fingerprint);

        CREATE TABLE cards (
          id TEXT PRIMARY KEY,
          volume_serial TEXT,
          filesystem TEXT,
          capacity_bytes INTEGER NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        CREATE TABLE card_snapshots (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL REFERENCES cards(id),
          volume_label TEXT NOT NULL,
          filesystem TEXT,
          capacity_bytes INTEGER NOT NULL,
          content_fingerprint TEXT NOT NULL,
          file_count INTEGER NOT NULL,
          total_bytes INTEGER NOT NULL,
          capture_signature TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        CREATE INDEX card_snapshots_content_idx ON card_snapshots(content_fingerprint);

        CREATE TABLE import_sessions (
          id TEXT PRIMARY KEY,
          card_snapshot_id TEXT REFERENCES card_snapshots(id),
          job_id TEXT,
          archive_id TEXT NOT NULL,
          source_root TEXT NOT NULL,
          destination_root TEXT NOT NULL,
          destination_relative_path TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          verified_at INTEGER,
          total_files INTEGER NOT NULL DEFAULT 0,
          planned_files INTEGER NOT NULL DEFAULT 0,
          imported_files INTEGER NOT NULL DEFAULT 0,
          verified_files INTEGER NOT NULL DEFAULT 0,
          duplicate_files INTEGER NOT NULL DEFAULT 0,
          skipped_files INTEGER NOT NULL DEFAULT 0,
          failed_files INTEGER NOT NULL DEFAULT 0,
          total_bytes INTEGER NOT NULL DEFAULT 0,
          imported_bytes INTEGER NOT NULL DEFAULT 0,
          sync_status TEXT NOT NULL DEFAULT 'PENDING',
          error_code TEXT,
          error_message TEXT
        );
        CREATE INDEX import_sessions_status_idx ON import_sessions(status, updated_at);

        CREATE TABLE import_files (
          session_id TEXT NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
          source_relative_path TEXT NOT NULL,
          source_size INTEGER NOT NULL,
          source_mtime_ms REAL NOT NULL,
          fast_fingerprint TEXT,
          full_hash TEXT,
          destination_path TEXT NOT NULL,
          destination_size INTEGER,
          destination_fingerprint TEXT,
          status TEXT NOT NULL,
          error_message TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(session_id, source_relative_path)
        );
        CREATE INDEX import_files_safe_idx ON import_files(source_size, fast_fingerprint, status);

        CREATE TABLE sync_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          aggregate_type TEXT NOT NULL,
          aggregate_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX sync_outbox_pending_idx ON sync_outbox(status, next_attempt_at);
      `);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(1, Date.now());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (current < 2) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`CREATE TABLE IF NOT EXISTS session_payloads (
          session_id TEXT PRIMARY KEY REFERENCES import_sessions(id) ON DELETE CASCADE,
          request_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );`);
        this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(2, Date.now());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (current < 3) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS app_settings (id INTEGER PRIMARY KEY CHECK(id=1), payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
        `);
        this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(3, Date.now());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  private markAbandonedSessionsInterrupted(): void {
    this.db.prepare(`UPDATE import_sessions SET status='INTERRUPTED', updated_at=?, error_code='PROCESS_INTERRUPTED',
      error_message='Sessione interrotta dalla chiusura precedente' WHERE status IN ('ANALYZING','READY','IMPORTING','VERIFYING')`)
      .run(Date.now());
  }

  backup(): string {
    const target = `${this.databasePath}.backup-${Date.now()}`;
    this.db.exec("PRAGMA wal_checkpoint(FULL)");
    fs.copyFileSync(this.databasePath, target);
    return target;
  }

  private maybeCreateScheduledBackup(): void {
    const last = Number(this.getMeta("last_database_backup_at") ?? 0);
    if (Date.now() - last < 24 * 60 * 60_000) return;
    try {
      this.backup();
      this.setMeta("last_database_backup_at", String(Date.now()));
      const prefix = `${path.basename(this.databasePath)}.backup-`;
      const backups = fs.readdirSync(path.dirname(this.databasePath)).filter((name) => name.startsWith(prefix)).sort().reverse();
      for (const stale of backups.slice(3)) fs.rmSync(path.join(path.dirname(this.databasePath), stale), { force:true });
    } catch { /* backup best effort; integrity/recovery remains active */ }
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key=?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`INSERT INTO app_meta(key,value,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, value, Date.now());
  }

  getSettings<T>(): T | null {
    const row = this.db.prepare("SELECT payload_json FROM app_settings WHERE id=1").get() as { payload_json: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.payload_json) as T; } catch { return null; }
  }

  setSettings(value: unknown): void {
    this.db.prepare(`INSERT INTO app_settings(id,payload_json,updated_at) VALUES(1,?,?)
      ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(JSON.stringify(value), Date.now());
  }

  listDomainRecords<T>(table: "jobs"): T[] {
    const rows = this.db.prepare(`SELECT payload_json FROM ${table} ORDER BY updated_at DESC`).all() as Array<{ payload_json: string }>;
    const result: T[] = [];
    for (const row of rows) { try { result.push(JSON.parse(row.payload_json) as T); } catch { /* skip corrupt row */ } }
    return result;
  }

  replaceDomainRecords(table: "jobs", records: Array<{ id: string }>): void {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`DELETE FROM ${table}`).run();
      const insert = this.db.prepare(`INSERT INTO ${table}(id,payload_json,updated_at) VALUES(?,?,?)`);
      records.forEach((record, index) => insert.run(record.id, JSON.stringify(record), now - index));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  upsertArchive(id: string, rootPath: string, hierarchy: unknown): void {
    const now = Date.now();
    this.db.prepare(`INSERT INTO archives(id,root_path,hierarchy_json,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET root_path=excluded.root_path,hierarchy_json=excluded.hierarchy_json,updated_at=excluded.updated_at`)
      .run(id, rootPath, JSON.stringify(hierarchy), now, now);
  }

  replaceArchiveEntries(archiveId: string, entries: Array<{ relativePath: string; entryType: "file"|"directory"; size: number; mtimeMs: number }>): void {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM archive_entries WHERE archive_id=?").run(archiveId);
      const insert = this.db.prepare("INSERT INTO archive_entries(archive_id,relative_path,entry_type,size,mtime_ms,seen_at) VALUES(?,?,?,?,?,?)");
      for (const entry of entries) insert.run(archiveId, entry.relativePath, entry.entryType, entry.size, entry.mtimeMs, now);
      this.db.prepare("UPDATE archives SET last_full_scan_at=?,last_reconciled_at=?,updated_at=? WHERE id=?").run(now, now, now, archiveId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  replaceArchiveSubtree(
    archiveId: string,
    relativePrefix: string,
    entries: Array<{ relativePath: string; entryType: "file"|"directory"; size: number; mtimeMs: number }>,
  ): void {
    const prefix = relativePrefix.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!prefix) throw new Error("Il prefisso del sottoalbero archivio non puo essere vuoto.");
    const now = Date.now();
    const descendantPrefix = `${prefix}/`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`DELETE FROM archive_entries
        WHERE archive_id=? AND (relative_path=? OR substr(relative_path,1,?)=?)`)
        .run(archiveId, prefix, descendantPrefix.length, descendantPrefix);
      const insert = this.db.prepare(`INSERT INTO archive_entries(
        archive_id,relative_path,entry_type,size,mtime_ms,seen_at
      ) VALUES(?,?,?,?,?,?)`);
      for (const entry of entries) {
        insert.run(archiveId, entry.relativePath, entry.entryType, entry.size, entry.mtimeMs, now);
      }
      this.db.prepare("UPDATE archives SET last_reconciled_at=?,updated_at=? WHERE id=?")
        .run(now, now, archiveId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getArchiveStatus(archiveId: string): { entryCount: number; fileCount: number; lastFullScanAt: number | null; lastReconciledAt: number | null } {
    const archive = this.db.prepare("SELECT last_full_scan_at,last_reconciled_at FROM archives WHERE id=?").get(archiveId) as Record<string, unknown> | undefined;
    const counts = this.db.prepare("SELECT COUNT(*) AS entries, SUM(CASE WHEN entry_type='file' THEN 1 ELSE 0 END) AS files FROM archive_entries WHERE archive_id=?").get(archiveId) as Record<string, unknown>;
    return {
      entryCount: Number(counts.entries ?? 0),
      fileCount: Number(counts.files ?? 0),
      lastFullScanAt: archive?.last_full_scan_at == null ? null : Number(archive.last_full_scan_at),
      lastReconciledAt: archive?.last_reconciled_at == null ? null : Number(archive.last_reconciled_at),
    };
  }

  saveCardSnapshot(card: { id: string; volumeSerial: string | null; filesystem: string | null; capacityBytes: number }, snapshot: CardSnapshotRecord): void {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO cards(id,volume_serial,filesystem,capacity_bytes,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET volume_serial=excluded.volume_serial,filesystem=excluded.filesystem,
        capacity_bytes=excluded.capacity_bytes,last_seen_at=excluded.last_seen_at`)
        .run(card.id, card.volumeSerial, card.filesystem, card.capacityBytes, now, now);
      this.db.prepare(`INSERT INTO card_snapshots(id,card_id,volume_label,filesystem,capacity_bytes,content_fingerprint,file_count,total_bytes,capture_signature,created_at,last_seen_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
        .run(snapshot.id,snapshot.cardId,snapshot.volumeLabel,snapshot.filesystem,snapshot.capacityBytes,snapshot.contentFingerprint,
          snapshot.fileCount,snapshot.totalBytes,snapshot.captureSignature,snapshot.createdAt,snapshot.lastSeenAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getCardSnapshot(id: string): CardSnapshotRecord | null {
    const row = this.db.prepare("SELECT * FROM card_snapshots WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id:String(row.id), cardId:String(row.card_id), volumeLabel:String(row.volume_label),
      filesystem:row.filesystem == null ? null : String(row.filesystem), capacityBytes:Number(row.capacity_bytes),
      contentFingerprint:String(row.content_fingerprint), fileCount:Number(row.file_count), totalBytes:Number(row.total_bytes),
      captureSignature:String(row.capture_signature), createdAt:Number(row.created_at), lastSeenAt:Number(row.last_seen_at),
    };
  }

  listCardSnapshots(limit = 500): CardSnapshotRecord[] {
    const ids = this.db.prepare("SELECT id FROM card_snapshots ORDER BY last_seen_at DESC LIMIT ?").all(limit) as Array<{ id: string }>;
    return ids.map(({ id }) => this.getCardSnapshot(id)).filter((item): item is CardSnapshotRecord => item !== null);
  }

  createSession(session: ImportSessionRecord): void {
    this.db.prepare(`INSERT INTO import_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      session.id, session.cardSnapshotId, session.jobId, session.archiveId, session.sourceRoot, session.destinationRoot,
      session.destinationRelativePath, session.status, session.startedAt, session.updatedAt, session.completedAt,
      session.verifiedAt, session.totalFiles, session.plannedFiles, session.importedFiles, session.verifiedFiles,
      session.duplicateFiles, session.skippedFiles, session.failedFiles, session.totalBytes, session.importedBytes,
      session.syncStatus, session.errorCode, session.errorMessage,
    );
  }

  saveSessionPayload(sessionId: string, payload: unknown): void {
    this.db.prepare(`INSERT INTO session_payloads(session_id,request_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET request_json=excluded.request_json,updated_at=excluded.updated_at`)
      .run(sessionId, JSON.stringify(payload), Date.now());
  }

  getSessionPayload<T>(sessionId: string): T | null {
    const row = this.db.prepare("SELECT request_json FROM session_payloads WHERE session_id=?").get(sessionId) as { request_json: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.request_json) as T; } catch { return null; }
  }

  updateSession(id: string, patch: Partial<Omit<ImportSessionRecord, "id">>): void {
    const mapping: Record<string, string> = {
      cardSnapshotId:"card_snapshot_id", jobId:"job_id", archiveId:"archive_id", sourceRoot:"source_root",
      destinationRoot:"destination_root", destinationRelativePath:"destination_relative_path", status:"status",
      startedAt:"started_at", updatedAt:"updated_at", completedAt:"completed_at", verifiedAt:"verified_at",
      totalFiles:"total_files", plannedFiles:"planned_files", importedFiles:"imported_files", verifiedFiles:"verified_files",
      duplicateFiles:"duplicate_files", skippedFiles:"skipped_files", failedFiles:"failed_files", totalBytes:"total_bytes",
      importedBytes:"imported_bytes", syncStatus:"sync_status", errorCode:"error_code", errorMessage:"error_message",
    };
    const pairs = Object.entries(patch).filter(([key]) => mapping[key]);
    if (!pairs.some(([key]) => key === "updatedAt")) pairs.push(["updatedAt", Date.now()]);
    if (pairs.length === 0) return;
    this.db.prepare(`UPDATE import_sessions SET ${pairs.map(([key]) => `${mapping[key]}=?`).join(",")} WHERE id=?`)
      .run(...pairs.map(([, value]) => value ?? null), id);
  }

  upsertImportFile(file: ImportFileRecord): void {
    this.db.prepare(`INSERT INTO import_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id,source_relative_path) DO UPDATE SET source_size=excluded.source_size,source_mtime_ms=excluded.source_mtime_ms,
      fast_fingerprint=excluded.fast_fingerprint,full_hash=excluded.full_hash,destination_path=excluded.destination_path,
      destination_size=excluded.destination_size,destination_fingerprint=excluded.destination_fingerprint,status=excluded.status,
      error_message=excluded.error_message,updated_at=excluded.updated_at`).run(
        file.sessionId,file.sourceRelativePath,file.sourceSize,file.sourceMtimeMs,file.fastFingerprint,file.fullHash,
        file.destinationPath,file.destinationSize,file.destinationFingerprint,file.status,file.errorMessage,file.updatedAt,
      );
  }

  listSessions(limit = 100): ImportSessionRecord[] {
    const rows = this.db.prepare("SELECT * FROM import_sessions ORDER BY started_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map((row) => this.mapSession(row));
  }

  listResumableSessions(): ImportSessionRecord[] {
    const rows = this.db.prepare("SELECT * FROM import_sessions WHERE status IN ('PAUSED','INTERRUPTED','FAILED') ORDER BY updated_at DESC").all() as Record<string, unknown>[];
    return rows.map((row) => this.mapSession(row));
  }

  findSafeEvidence(size: number, fastFingerprint: string): SafeToFormatFileEvidence[] {
    return this.db.prepare(`SELECT f.source_relative_path,f.source_size,f.fast_fingerprint,f.destination_path,f.session_id
      FROM import_files f JOIN import_sessions s ON s.id=f.session_id
      WHERE f.source_size=? AND f.fast_fingerprint=? AND f.status IN ('VERIFIED','DUPLICATE_ACCEPTED')
      AND s.status='COMPLETED' AND s.verified_at IS NOT NULL`).all(size, fastFingerprint).map((row: any) => ({
        sourceRelativePath:String(row.source_relative_path), sourceSize:Number(row.source_size), fastFingerprint:String(row.fast_fingerprint),
        destinationPath:String(row.destination_path), sessionId:String(row.session_id),
      }));
  }

  listVerifiedFingerprintKeys(): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT f.source_size,f.fast_fingerprint FROM import_files f
      JOIN import_sessions s ON s.id=f.session_id WHERE f.fast_fingerprint IS NOT NULL
      AND f.status IN ('VERIFIED','DUPLICATE_ACCEPTED') AND s.status='COMPLETED' AND s.verified_at IS NOT NULL`).all() as Array<{ source_size: number; fast_fingerprint: string }>;
    return rows.map((row) => `${row.source_size}:${row.fast_fingerprint}`);
  }

  enqueueOutbox(aggregateType: string, aggregateId: string, eventType: string, payload: unknown): void {
    const now = Date.now();
    this.db.prepare("INSERT INTO sync_outbox(aggregate_type,aggregate_id,event_type,payload_json,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(aggregateType, aggregateId, eventType, JSON.stringify(payload), now, now, now);
  }

  listPendingOutbox(limit = 100): OutboxRecord[] {
    const rows = this.db.prepare(`SELECT id,aggregate_type,aggregate_id,event_type,payload_json,attempts FROM sync_outbox
      WHERE status IN ('PENDING','FAILED_RETRYABLE') AND next_attempt_at<=? ORDER BY id LIMIT ?`).all(Date.now(), limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id:Number(row.id), aggregateType:String(row.aggregate_type), aggregateId:String(row.aggregate_id),
      eventType:String(row.event_type), payload:JSON.parse(String(row.payload_json)), attempts:Number(row.attempts),
    }));
  }

  markOutboxSynced(ids: number[]): void {
    const update = this.db.prepare("UPDATE sync_outbox SET status='SYNCED',updated_at=?,last_error=NULL WHERE id=?");
    const sessionUpdate = this.db.prepare("UPDATE import_sessions SET sync_status='SYNCED',updated_at=? WHERE id=?");
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of ids) {
        const event = this.db.prepare("SELECT aggregate_type,aggregate_id FROM sync_outbox WHERE id=?").get(id) as { aggregate_type: string; aggregate_id: string } | undefined;
        update.run(now, id);
        if (event?.aggregate_type === "import_session") sessionUpdate.run(now, event.aggregate_id);
      }
      this.db.exec("COMMIT");
    }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  markOutboxRetry(ids: number[], errorMessage: string): void {
    const update = this.db.prepare(`UPDATE sync_outbox SET status='FAILED_RETRYABLE',attempts=attempts+1,
      next_attempt_at=?,last_error=?,updated_at=? WHERE id=?`);
    const now = Date.now();
    const sessionUpdate = this.db.prepare("UPDATE import_sessions SET sync_status='FAILED_RETRYABLE',updated_at=? WHERE id=?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of ids) {
        const row = this.db.prepare("SELECT attempts FROM sync_outbox WHERE id=?").get(id) as { attempts: number } | undefined;
        const delay = Math.min(60 * 60_000, 5_000 * (2 ** Math.min(8, Number(row?.attempts ?? 0))));
        update.run(now + delay, errorMessage.slice(0, 1000), now, id);
        const event = this.db.prepare("SELECT aggregate_type,aggregate_id FROM sync_outbox WHERE id=?").get(id) as { aggregate_type: string; aggregate_id: string } | undefined;
        if (event?.aggregate_type === "import_session") sessionUpdate.run(now, event.aggregate_id);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  health(): { schemaVersion: number; integrity: string; databasePath: string; pendingOutbox: number; resumableSessions: number } {
    const integrity = String((this.db.prepare("PRAGMA integrity_check").get() as Record<string, unknown>).integrity_check ?? "unknown");
    const pendingOutbox = Number((this.db.prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE status IN ('PENDING','FAILED_RETRYABLE')").get() as any).count);
    const resumableSessions = Number((this.db.prepare("SELECT COUNT(*) AS count FROM import_sessions WHERE status IN ('PAUSED','INTERRUPTED','FAILED')").get() as any).count);
    const schemaVersion = Number((this.db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations").get() as any).version);
    return { schemaVersion, integrity, databasePath: this.databasePath, pendingOutbox, resumableSessions };
  }

  private mapSession(row: Record<string, unknown>): ImportSessionRecord {
    return {
      id:String(row.id), cardSnapshotId:row.card_snapshot_id ? String(row.card_snapshot_id) : null,
      jobId:row.job_id ? String(row.job_id) : null, archiveId:String(row.archive_id), sourceRoot:String(row.source_root),
      destinationRoot:String(row.destination_root), destinationRelativePath:String(row.destination_relative_path),
      status:String(row.status) as ImportSessionStatus, startedAt:Number(row.started_at), updatedAt:Number(row.updated_at),
      completedAt:row.completed_at == null ? null : Number(row.completed_at), verifiedAt:row.verified_at == null ? null : Number(row.verified_at),
      totalFiles:Number(row.total_files), plannedFiles:Number(row.planned_files), importedFiles:Number(row.imported_files),
      verifiedFiles:Number(row.verified_files), duplicateFiles:Number(row.duplicate_files), skippedFiles:Number(row.skipped_files),
      failedFiles:Number(row.failed_files), totalBytes:Number(row.total_bytes), importedBytes:Number(row.imported_bytes),
      syncStatus:String(row.sync_status) as ImportSessionRecord["syncStatus"], errorCode:row.error_code ? String(row.error_code) : null,
      errorMessage:row.error_message ? String(row.error_message) : null,
    };
  }
}
