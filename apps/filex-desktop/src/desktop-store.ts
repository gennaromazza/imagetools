import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DesktopFolderCatalogAssetState,
  DesktopFolderCatalogState,
  DesktopLogEvent,
  DesktopPerformanceSnapshot,
  DesktopPersistedState,
  DesktopPhotoSelectorPreferences,
  DesktopRecentFolder,
  DesktopSortCacheEntry,
} from "@photo-tools/desktop-contracts";

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

function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  const databasePath = getDatabasePath();
  ensureParentDirectory(databasePath);
  const db = new DatabaseSync(databasePath);
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
      opened_at INTEGER NOT NULL
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

export function getAutoLayoutProjects(): unknown[] {
  return readKv<unknown[]>("auto-layout-projects", []);
}

export function saveAutoLayoutProjects(projects: unknown[]): void {
  writeKv("auto-layout-projects", Array.isArray(projects) ? projects : []);
}

export function getRecentFolders(): DesktopRecentFolder[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT name, path, image_count, opened_at
    FROM recent_folders
    ORDER BY opened_at DESC
  `).all() as Array<{
    name: string;
    path: string | null;
    image_count: number;
    opened_at: number;
  }>;

  return rows.map((row) => ({
    name: row.name,
    path: row.path ?? undefined,
    imageCount: row.image_count,
    openedAt: row.opened_at,
  }));
}

export function saveRecentFolder(folder: DesktopRecentFolder): DesktopRecentFolder[] {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO recent_folders (folder_key, name, path, image_count, opened_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(folder_key) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      image_count = excluded.image_count,
      opened_at = excluded.opened_at
  `).run(
    normalizeRecentFolderKey(folder),
    folder.name,
    folder.path ?? null,
    folder.imageCount,
    folder.openedAt,
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
    SELECT asset_id, file_name, relative_path, absolute_path, source_file_key, rating, pick_status, color_label, custom_labels_json, updated_at
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
    updated_at: number;
  }>;

  return {
    folderPath,
    folderName: row.folder_name,
    imageCount: row.image_count,
    activeAssetIds: parseJson<string[]>(row.active_asset_ids_json, []),
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
      updatedAt: assetRow.updated_at,
    })),
  };
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
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
