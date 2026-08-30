import * as electron from "electron";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, appendFileSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DesktopFreeSelectionSnapshot,
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopLogEvent,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  DesktopPhotoSelectorPreferences,
  DesktopRecentFolder,
  DesktopSortCacheEntry,
} from "@photo-tools/desktop-contracts";

const { app } = electron;

const DB_FILE_NAME = "photo-selector-desktop.sqlite";
const LOG_DIR_NAME = "logs";
const LOG_FILE_NAME = "photo-selector-desktop.log";
const MAX_RECENT_FOLDERS = 8;
const MAX_SORT_CACHE_ENTRIES = 24;
const MAX_LOG_ENTRIES = 4000;

const DEFAULT_DESKTOP_PREFERENCES: DesktopPhotoSelectorPreferences = {
  colorNames: {
    red: "Rosso",
    yellow: "Giallo",
    green: "Verde",
    blue: "Blu",
    purple: "Viola",
  },
  filterPresets: [],
  customLabelsCatalog: [],
  customLabelColors: {},
  customLabelShortcuts: {},
  thumbnailProfile: "ultra-fast",
  sortCacheEnabled: true,
  ramBudgetPreset: "default",
  autoAdvanceOnAction: true,
  cardSize: 160,
  rootFolderPathOverride: "",
  preferredEditorPath: "",
};

let database: DatabaseSync | null = null;

function getDatabasePath(): string {
  return join(app.getPath("userData"), DB_FILE_NAME);
}

function getLogFilePath(): string {
  return join(app.getPath("userData"), LOG_DIR_NAME, LOG_FILE_NAME);
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

const MAX_CORRUPT_BACKUPS = 3;

function pruneOldCorruptBackups(databasePath: string): void {
  // Su disco rotto / crash ciclici si accumulerebbero file .corrupt-* infiniti.
  // Manteniamo solo gli ultimi N per debug.
  try {
    const dir = dirname(databasePath);
    const baseName = databasePath.substring(dir.length + 1);
    const prefix = `${baseName}.corrupt-`;
    const entries = readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name, stamp: Number(name.substring(prefix.length)) || 0 }))
      .sort((a, b) => b.stamp - a.stamp);
    for (const stale of entries.slice(MAX_CORRUPT_BACKUPS)) {
      try {
        unlinkSync(join(dir, stale.name));
      } catch {
        // ignore: best-effort cleanup
      }
    }
  } catch {
    // ignore: directory non leggibile, non bloccante
  }
}

function openDatabaseWithRecovery(databasePath: string): DatabaseSync {
  // Apertura difensiva: se il file SQLite è corrotto (crash precedente, modifiche
  // manuali, disco rotto) `new DatabaseSync` lancia. Senza recovery l'app non
  // partirebbe più finché l'utente non cancella il file a mano.
  // Strategia: rinomina il file corrotto a <db>.corrupt-<timestamp> e riprova
  // con un DB vuoto. L'utente perde le preferenze ma l'app si avvia.
  try {
    return new DatabaseSync(databasePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stamp = Date.now();
    const corruptPath = `${databasePath}.corrupt-${stamp}`;
    let renamed = false;
    try {
      renameSync(databasePath, corruptPath);
      renamed = true;
    } catch (renameError) {
      // Su Windows il file può essere lockato (antivirus, istanza zombie).
      // Fallback: prova a cancellarlo (perdiamo la copia ma l'app parte).
      try {
        unlinkSync(databasePath);
      } catch {
        // Né rinominare né cancellare: rilancia l'errore originale del DB,
        // l'utente vedrà il messaggio nei log e potrà rimuovere il file a mano.
        const renameMsg = renameError instanceof Error ? renameError.message : String(renameError);
        try {
          appendFileSync(
            getLogFilePath(),
            `${new Date().toISOString()} [store] DB corrotto E rename/unlink falliti (${renameMsg}): ${message}\n`,
          );
        } catch {
          // ignore
        }
        throw error instanceof Error ? error : new Error(message);
      }
    }
    try {
      appendFileSync(
        getLogFilePath(),
        `${new Date().toISOString()} [store] DB corrotto, ${renamed ? `rinominato in ${corruptPath}` : "cancellato"}: ${message}\n`,
      );
    } catch {
      // log best-effort
    }
    pruneOldCorruptBackups(databasePath);
    return new DatabaseSync(databasePath);
  }
}

function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  const databasePath = getDatabasePath();
  ensureParentDirectory(databasePath);
  const db = openDatabaseWithRecovery(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recent_folders (
      folder_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT,
      image_count INTEGER NOT NULL,
      opened_at INTEGER NOT NULL,
      mode TEXT,
      source_id TEXT
    );

    CREATE TABLE IF NOT EXISTS free_selection_snapshot (
      source_id TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sort_cache (
      folder_path TEXT NOT NULL,
      sort_by TEXT NOT NULL,
      signature TEXT NOT NULL,
      ordered_ids_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (folder_path, sort_by)
    );

    CREATE TABLE IF NOT EXISTS folder_catalog (
      folder_path TEXT PRIMARY KEY,
      folder_name TEXT NOT NULL,
      image_count INTEGER NOT NULL,
      active_asset_ids_json TEXT NOT NULL,
      last_opened_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folder_asset_state (
      folder_path TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      absolute_path TEXT,
      source_file_key TEXT,
      rating INTEGER NOT NULL,
      pick_status TEXT NOT NULL,
      color_label TEXT,
      custom_labels_json TEXT NOT NULL,
      active INTEGER,
      classification_updated_at INTEGER,
      selection_updated_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (folder_path, asset_id)
    );

    CREATE TABLE IF NOT EXISTS performance_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      snapshot_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const recentFolderColumns = new Set(
    (db.prepare("PRAGMA table_info(recent_folders)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!recentFolderColumns.has("mode")) {
    // Existing rows predate workspace modes and must remain unresolved: the
    // renderer will check whether they belong to a master project before
    // falling back to a free selection.
    db.exec("ALTER TABLE recent_folders ADD COLUMN mode TEXT");
  }
  if (!recentFolderColumns.has("source_id")) {
    db.exec("ALTER TABLE recent_folders ADD COLUMN source_id TEXT");
  }

  const folderAssetStateColumns = new Set(
    (db.prepare("PRAGMA table_info(folder_asset_state)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!folderAssetStateColumns.has("active")) {
    db.exec("ALTER TABLE folder_asset_state ADD COLUMN active INTEGER");
  }
  if (!folderAssetStateColumns.has("classification_updated_at")) {
    db.exec("ALTER TABLE folder_asset_state ADD COLUMN classification_updated_at INTEGER");
  }
  if (!folderAssetStateColumns.has("selection_updated_at")) {
    db.exec("ALTER TABLE folder_asset_state ADD COLUMN selection_updated_at INTEGER");
  }

  database = db;
  return db;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function now(): number {
  return Date.now();
}

function runInTransaction(work: () => void): void {
  const db = getDatabase();
  db.exec("BEGIN");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures and rethrow the original error.
    }
    throw error;
  }
}

function writeKv(key: string, value: unknown): void {
  const db = getDatabase();
  const timestamp = now();
  db.prepare(`
    INSERT INTO kv_store (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(key, serialize(value), timestamp);
}

function readKv<T>(key: string, fallback: T): T {
  const db = getDatabase();
  const row = db.prepare("SELECT value_json FROM kv_store WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  return parseJson(row?.value_json, fallback);
}

function normalizeRecentFolderKey(folder: DesktopRecentFolder): string {
  return (folder.path?.trim() || folder.name.trim()).toLowerCase();
}

function pruneRecentFolders(): void {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT folder_key
    FROM recent_folders
    ORDER BY opened_at DESC
  `).all() as Array<{ folder_key: string }>;

  if (rows.length <= MAX_RECENT_FOLDERS) {
    return;
  }

  const staleKeys = rows.slice(MAX_RECENT_FOLDERS).map((row) => row.folder_key);
  const deleteStatement = db.prepare("DELETE FROM recent_folders WHERE folder_key = ?");
  runInTransaction(() => {
    for (const key of staleKeys) {
      deleteStatement.run(key);
    }
  });
}

function pruneSortCache(): void {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT folder_path, sort_by
    FROM sort_cache
    ORDER BY updated_at DESC
  `).all() as Array<{ folder_path: string; sort_by: string }>;

  if (rows.length <= MAX_SORT_CACHE_ENTRIES) {
    return;
  }

  const staleRows = rows.slice(MAX_SORT_CACHE_ENTRIES);
  const deleteStatement = db.prepare("DELETE FROM sort_cache WHERE folder_path = ? AND sort_by = ?");
  runInTransaction(() => {
    for (const entry of staleRows) {
      deleteStatement.run(entry.folder_path, entry.sort_by);
    }
  });
}

function pruneEventLog(): void {
  const db = getDatabase();
  const total = (db.prepare("SELECT COUNT(*) as count FROM event_log").get() as { count: number }).count;
  if (total <= MAX_LOG_ENTRIES) {
    return;
  }

  db.prepare(`
    DELETE FROM event_log
    WHERE id IN (
      SELECT id
      FROM event_log
      ORDER BY id ASC
      LIMIT ?
    )
  `).run(total - MAX_LOG_ENTRIES);
}

export function getDesktopPreferences(): DesktopPhotoSelectorPreferences {
  return {
    ...DEFAULT_DESKTOP_PREFERENCES,
    ...readKv<DesktopPhotoSelectorPreferences>("photo-selector-preferences", DEFAULT_DESKTOP_PREFERENCES),
  };
}

export function saveDesktopPreferences(
  preferences: DesktopPhotoSelectorPreferences,
): DesktopPhotoSelectorPreferences {
  const normalized = {
    ...DEFAULT_DESKTOP_PREFERENCES,
    ...preferences,
  };
  writeKv("photo-selector-preferences", normalized);
  return normalized;
}

export function getDesktopSessionState(): DesktopPersistedState | null {
  return readKv<DesktopPersistedState | null>("photo-selector-session", null);
}

export function saveDesktopSessionState(state: DesktopPersistedState): void {
  writeKv("photo-selector-session", state);
}

function isFreeSelectionSnapshot(value: unknown, expectedSourceId: string): value is DesktopFreeSelectionSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const snapshot = value as Partial<DesktopFreeSelectionSnapshot>;
  return snapshot.schemaVersion === 1
    && snapshot.app === "image-select-pro"
    && snapshot.mode === "free"
    && Boolean(snapshot.source)
    && snapshot.source?.sourceId === expectedSourceId
    && Array.isArray(snapshot.activeAssetIds)
    && Array.isArray(snapshot.assetStates);
}

export function getFreeSelectionSnapshot(sourceId: string): DesktopFreeSelectionSnapshot | null {
  const normalizedSourceId = typeof sourceId === "string" ? sourceId.trim() : "";
  if (!normalizedSourceId) {
    return null;
  }
  const db = getDatabase();
  const row = db.prepare(`
    SELECT snapshot_json
    FROM free_selection_snapshot
    WHERE source_id = ?
  `).get(normalizedSourceId) as { snapshot_json: string } | undefined;
  const snapshot = parseJson<unknown>(row?.snapshot_json, null);
  return isFreeSelectionSnapshot(snapshot, normalizedSourceId) ? snapshot : null;
}

export function saveFreeSelectionSnapshot(
  snapshot: DesktopFreeSelectionSnapshot,
): DesktopFreeSelectionSnapshot {
  const sourceId = snapshot?.source?.sourceId?.trim();
  if (!sourceId || snapshot.schemaVersion !== 1 || snapshot.app !== "image-select-pro" || snapshot.mode !== "free") {
    throw new Error("Invalid free selection snapshot");
  }

  const timestamp = Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : now();
  const normalized: DesktopFreeSelectionSnapshot = {
    ...snapshot,
    source: {
      ...snapshot.source,
      sourceId,
    },
    displayName: snapshot.displayName.trim() || snapshot.source.rootFolderName,
    createdAt: Number.isFinite(snapshot.createdAt) ? snapshot.createdAt : timestamp,
    updatedAt: timestamp,
    activeAssetIds: Array.isArray(snapshot.activeAssetIds) ? [...snapshot.activeAssetIds] : [],
    assetStates: Array.isArray(snapshot.assetStates) ? [...snapshot.assetStates] : [],
  };
  const db = getDatabase();
  const upsert = db.prepare(`
    INSERT INTO free_selection_snapshot (source_id, snapshot_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      snapshot_json = excluded.snapshot_json,
      updated_at = excluded.updated_at
  `);
  runInTransaction(() => {
    upsert.run(sourceId, serialize(normalized), timestamp);
  });
  return normalized;
}

export function getRecentFolders(): DesktopRecentFolder[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT name, path, image_count, opened_at, mode, source_id
    FROM recent_folders
    ORDER BY opened_at DESC
  `).all() as Array<{
    name: string;
    path: string | null;
    image_count: number;
    opened_at: number;
    mode: string | null;
    source_id: string | null;
  }>;

  return rows.map((row) => ({
    name: row.name,
    path: row.path ?? undefined,
    imageCount: row.image_count,
    openedAt: row.opened_at,
    mode: row.mode === "project" ? "project" : row.mode === "free" ? "free" : undefined,
    sourceId: row.source_id ?? undefined,
  }));
}

export function saveRecentFolder(folder: DesktopRecentFolder): DesktopRecentFolder[] {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO recent_folders (folder_key, name, path, image_count, opened_at, mode, source_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder_key) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      image_count = excluded.image_count,
      opened_at = excluded.opened_at,
      mode = excluded.mode,
      source_id = excluded.source_id
  `).run(
    normalizeRecentFolderKey(folder),
    folder.name,
    folder.path ?? null,
    folder.imageCount,
    folder.openedAt,
    folder.mode === "project" ? "project" : folder.mode === "free" ? "free" : null,
    folder.sourceId?.trim() || null,
  );
  pruneRecentFolders();
  return getRecentFolders();
}

export function removeRecentFolder(folderPathOrName: string): DesktopRecentFolder[] {
  const db = getDatabase();
  const normalizedValue = folderPathOrName.trim().toLowerCase();
  db.prepare(`
    DELETE FROM recent_folders
    WHERE folder_key = ?
       OR lower(path) = ?
       OR lower(name) = ?
  `).run(normalizedValue, normalizedValue, normalizedValue);
  return getRecentFolders();
}

export function getSortCache(folderPath?: string): DesktopSortCacheEntry[] {
  const db = getDatabase();
  const rows = (folderPath
    ? db.prepare(`
        SELECT folder_path, sort_by, signature, ordered_ids_json, updated_at
        FROM sort_cache
        WHERE folder_path = ?
        ORDER BY updated_at DESC
      `).all(folderPath)
    : db.prepare(`
        SELECT folder_path, sort_by, signature, ordered_ids_json, updated_at
        FROM sort_cache
        ORDER BY updated_at DESC
      `).all()) as Array<{
        folder_path: string;
        sort_by: DesktopSortCacheEntry["sortBy"];
        signature: string;
        ordered_ids_json: string;
        updated_at: number;
      }>;

  return rows.map((row) => ({
    folderPath: row.folder_path,
    sortBy: row.sort_by,
    signature: row.signature,
    orderedIds: parseJson<string[]>(row.ordered_ids_json, []),
    updatedAt: row.updated_at,
  }));
}

export function saveSortCache(entry: DesktopSortCacheEntry): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO sort_cache (folder_path, sort_by, signature, ordered_ids_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(folder_path, sort_by) DO UPDATE SET
      signature = excluded.signature,
      ordered_ids_json = excluded.ordered_ids_json,
      updated_at = excluded.updated_at
  `).run(
    entry.folderPath,
    entry.sortBy,
    entry.signature,
    serialize(entry.orderedIds),
    entry.updatedAt,
  );
  pruneSortCache();
}

export function getFolderCatalogState(folderPath: string): DesktopFolderCatalogState | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT folder_name, image_count, active_asset_ids_json, last_opened_at, updated_at
    FROM folder_catalog
    WHERE folder_path = ?
  `).get(folderPath) as
    | {
        folder_name: string;
        image_count: number;
        active_asset_ids_json: string;
        last_opened_at: number;
        updated_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const assetRows = db.prepare(`
    SELECT asset_id, file_name, relative_path, absolute_path, source_file_key, rating, pick_status, color_label,
      custom_labels_json, active, classification_updated_at, selection_updated_at, updated_at
    FROM folder_asset_state
    WHERE folder_path = ?
    ORDER BY updated_at DESC
  `).all(folderPath) as Array<{
    asset_id: string;
    file_name: string;
    relative_path: string;
    absolute_path: string | null;
    source_file_key: string | null;
    rating: number;
    pick_status: DesktopFolderCatalogAssetState["pickStatus"];
    color_label: DesktopFolderCatalogAssetState["colorLabel"];
    custom_labels_json: string;
    active: number | null;
    classification_updated_at: number | null;
    selection_updated_at: number | null;
    updated_at: number;
  }>;

  const activeAssetIds = parseJson<string[]>(row.active_asset_ids_json, []);
  const activeAssetIdSet = new Set(activeAssetIds);

  return {
    folderPath,
    folderName: row.folder_name,
    imageCount: row.image_count,
    activeAssetIds,
    lastOpenedAt: row.last_opened_at,
    updatedAt: row.updated_at,
    assetStates: assetRows.map((assetRow) => ({
      assetId: assetRow.asset_id,
      fileName: assetRow.file_name,
      relativePath: assetRow.relative_path,
      absolutePath: assetRow.absolute_path ?? undefined,
      sourceFileKey: assetRow.source_file_key ?? undefined,
      rating: assetRow.rating,
      pickStatus: assetRow.pick_status,
      colorLabel: assetRow.color_label ?? null,
      customLabels: parseJson<string[]>(assetRow.custom_labels_json, []),
      active: assetRow.active === null ? activeAssetIdSet.has(assetRow.asset_id) : assetRow.active !== 0,
      classificationUpdatedAt: assetRow.classification_updated_at ?? assetRow.updated_at,
      selectionUpdatedAt: assetRow.selection_updated_at ?? row.updated_at,
      updatedAt: assetRow.updated_at,
    })),
  };
}

export function listFolderCatalogStatesUnderRoot(rootPath: string): DesktopFolderCatalogState[] {
  const db = getDatabase();
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  const rows = db.prepare("SELECT folder_path FROM folder_catalog").all() as Array<{ folder_path: string }>;
  return rows
    .filter((row) => {
      const normalizedPath = row.folder_path.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
    })
    .map((row) => getFolderCatalogState(row.folder_path))
    .filter((state): state is DesktopFolderCatalogState => state !== null);
}

export function saveFolderCatalogState(state: DesktopFolderCatalogState): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO folder_catalog (
      folder_path,
      folder_name,
      image_count,
      active_asset_ids_json,
      last_opened_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder_path) DO UPDATE SET
      folder_name = excluded.folder_name,
      image_count = excluded.image_count,
      active_asset_ids_json = excluded.active_asset_ids_json,
      last_opened_at = excluded.last_opened_at,
      updated_at = excluded.updated_at
  `).run(
    state.folderPath,
    state.folderName,
    state.imageCount,
    serialize(state.activeAssetIds),
    state.lastOpenedAt,
    state.updatedAt,
  );
}

export function saveFolderAssetStates(
  folderPath: string,
  assetStates: DesktopFolderCatalogAssetState[],
): void {
  const db = getDatabase();
  const deleteStatement = db.prepare("DELETE FROM folder_asset_state WHERE folder_path = ?");
  const insertStatement = db.prepare(`
    INSERT INTO folder_asset_state (
      folder_path,
      asset_id,
      file_name,
      relative_path,
      absolute_path,
      source_file_key,
      rating,
      pick_status,
      color_label,
      custom_labels_json,
      active,
      classification_updated_at,
      selection_updated_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  runInTransaction(() => {
    deleteStatement.run(folderPath);
    for (const assetState of assetStates) {
      insertStatement.run(
        folderPath,
        assetState.assetId,
        assetState.fileName,
        assetState.relativePath,
        assetState.absolutePath ?? null,
        assetState.sourceFileKey ?? null,
        assetState.rating,
        assetState.pickStatus,
        assetState.colorLabel ?? null,
        serialize(assetState.customLabels),
        assetState.active === undefined ? null : assetState.active ? 1 : 0,
        assetState.classificationUpdatedAt ?? assetState.updatedAt,
        assetState.selectionUpdatedAt ?? assetState.updatedAt,
        assetState.updatedAt,
      );
    }
  });
}

export function saveFolderAssetStatesDelta(
  folderPath: string,
  assetStates: DesktopFolderCatalogAssetState[],
): void {
  if (assetStates.length === 0) {
    return;
  }

  const db = getDatabase();
  const upsertStatement = db.prepare(`
    INSERT INTO folder_asset_state (
      folder_path,
      asset_id,
      file_name,
      relative_path,
      absolute_path,
      source_file_key,
      rating,
      pick_status,
      color_label,
      custom_labels_json,
      active,
      classification_updated_at,
      selection_updated_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder_path, asset_id) DO UPDATE SET
      file_name = excluded.file_name,
      relative_path = excluded.relative_path,
      absolute_path = excluded.absolute_path,
      source_file_key = excluded.source_file_key,
      rating = excluded.rating,
      pick_status = excluded.pick_status,
      color_label = excluded.color_label,
      custom_labels_json = excluded.custom_labels_json,
      active = excluded.active,
      classification_updated_at = excluded.classification_updated_at,
      selection_updated_at = excluded.selection_updated_at,
      updated_at = excluded.updated_at
  `);

  runInTransaction(() => {
    for (const assetState of assetStates) {
      upsertStatement.run(
        folderPath,
        assetState.assetId,
        assetState.fileName,
        assetState.relativePath,
        assetState.absolutePath ?? null,
        assetState.sourceFileKey ?? null,
        assetState.rating,
        assetState.pickStatus,
        assetState.colorLabel ?? null,
        serialize(assetState.customLabels),
        assetState.active === undefined ? null : assetState.active ? 1 : 0,
        assetState.classificationUpdatedAt ?? assetState.updatedAt,
        assetState.selectionUpdatedAt ?? assetState.updatedAt,
        assetState.updatedAt,
      );
    }
  });
}

export function getDesktopPerformanceSnapshot(): DesktopPerformanceSnapshot | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT snapshot_json
    FROM performance_snapshot
    WHERE id = 1
  `).get() as { snapshot_json: string } | undefined;

  if (!row) {
    return null;
  }

  return parseJson<DesktopPerformanceSnapshot | null>(row.snapshot_json, null);
}

export function recordDesktopPerformanceSnapshot(snapshot: DesktopPerformanceSnapshot): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO performance_snapshot (id, snapshot_json, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      snapshot_json = excluded.snapshot_json,
      updated_at = excluded.updated_at
  `).run(serialize(snapshot), now());
}

export function logDesktopEvent(event: DesktopLogEvent): void {
  const db = getDatabase();
  const timestamp = event.timestamp ?? now();
  db.prepare(`
    INSERT INTO event_log (channel, level, message, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    event.channel,
    event.level,
    event.message,
    event.details ?? null,
    timestamp,
  );
  pruneEventLog();

  const logLine = `${new Date(timestamp).toISOString()} [${event.level.toUpperCase()}] ${event.channel} ${event.message}${event.details ? ` :: ${event.details}` : ""}\n`;
  try {
    const logFilePath = getLogFilePath();
    ensureParentDirectory(logFilePath);
    appendFileSync(logFilePath, logLine, "utf8");
  } catch {
    // Keep logging best-effort to avoid affecting app behavior.
  }
}

export function shutdownDesktopStore(): void {
  if (!database) {
    return;
  }

  database.close();
  database = null;
}
