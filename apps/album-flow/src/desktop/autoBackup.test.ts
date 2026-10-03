import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { AUTO_BACKUP_KEYS, autoBackupEnabled, backupOnClose, loadBackupMarks, markBackedUp, projectsToBackup, setAutoBackupEnabled } from "./autoBackup";
import { makeProject } from "../model/fixtures";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}

const album = (id: string, updatedAt: string, photos = 3): AlbumProjectV2 => ({ ...makeProject(photos), projectId: id, projectName: id, updatedAt });

test("backup alla chiusura: spento di serie, si accende e si ricorda", () => {
  const storage = memoryStorage();
  assert.equal(autoBackupEnabled(storage), false);
  setAutoBackupEnabled(true, storage);
  assert.equal(autoBackupEnabled(storage), true);
  setAutoBackupEnabled(false, storage);
  assert.equal(autoBackupEnabled(storage), false);
  assert.equal(autoBackupEnabled(null), false);
  assert.doesNotThrow(() => setAutoBackupEnabled(true, { getItem: () => null, setItem: () => { throw new Error("pieno"); } }));
});

test("backup alla chiusura: solo gli album modificati dopo l'ultimo salvataggio, i più recenti, al massimo tre", () => {
  const projects = [album("a", "2026-10-01T10:00:00Z"), album("b", "2026-10-03T10:00:00Z"), album("c", "2026-10-02T10:00:00Z"), album("d", "2026-10-04T10:00:00Z"), album("e", "2026-10-05T10:00:00Z"), album("vuoto", "2026-10-06T10:00:00Z", 0)];
  assert.deepEqual(projectsToBackup(projects, {}).map((project) => project.projectId), ["e", "d", "b"]);
  assert.deepEqual(projectsToBackup(projects, { e: "2026-10-05T10:00:00Z", d: "2026-10-01T00:00:00Z" }, 2).map((project) => project.projectId), ["d", "b"], "e è già salvato");
  assert.equal(projectsToBackup([], {}).length, 0);
  assert.equal(projectsToBackup(projects, {}, 0).length, 0);
  const storage = memoryStorage();
  markBackedUp("a", "2026-10-01T10:00:00Z", storage);
  markBackedUp("b", "2026-10-03T10:00:00Z", storage);
  assert.deepEqual(loadBackupMarks(storage), { a: "2026-10-01T10:00:00Z", b: "2026-10-03T10:00:00Z" });
  assert.deepEqual(loadBackupMarks(memoryStorage({ [AUTO_BACKUP_KEYS.marks]: "{rotto" })), {});
  assert.deepEqual(loadBackupMarks(memoryStorage({ [AUTO_BACKUP_KEYS.marks]: JSON.stringify({ x: 4, y: "ok" }) })), { y: "ok" });
});

test("backup alla chiusura: salva, segna cosa è fatto, e non blocca mai la chiusura", async () => {
  const storage = memoryStorage();
  const projects = [album("a", "2026-10-03T10:00:00Z"), album("b", "2026-10-02T10:00:00Z")];
  const calls: string[] = [];
  const deps = { connected: async () => true, backup: async (project: AlbumProjectV2) => { calls.push(project.projectId); } };

  assert.equal((await backupOnClose(projects, deps, 15000, storage)).skipped, "disattivato");
  assert.deepEqual(calls, []);

  setAutoBackupEnabled(true, storage);
  const first = await backupOnClose(projects, deps, 15000, storage);
  assert.deepEqual([first.saved, first.failed, first.skipped], [["a", "b"], [], null]);
  assert.deepEqual(calls, ["a", "b"]);
  const again = await backupOnClose(projects, deps, 15000, storage);
  assert.equal(again.skipped, "niente da salvare", "già salvato: nulla da rifare");

  const edited = [album("a", "2026-10-04T10:00:00Z"), projects[1]];
  assert.deepEqual((await backupOnClose(edited, deps, 15000, storage)).saved, ["a"], "solo l'album cambiato");

  const offline = await backupOnClose([album("z", "2026-11-01T00:00:00Z")], { connected: async () => false, backup: async () => { throw new Error("no"); } }, 15000, storage);
  assert.equal(offline.skipped, "non collegato");
  const broken = await backupOnClose([album("y", "2026-11-01T00:00:00Z")], { connected: async () => { throw new Error("rete"); }, backup: async () => undefined }, 15000, storage);
  assert.equal(broken.skipped, "non collegato");

  const failing = await backupOnClose([album("w", "2026-11-02T00:00:00Z")], { connected: async () => true, backup: async () => { throw new Error("Drive pieno"); } }, 15000, storage);
  assert.deepEqual([failing.saved, failing.failed], [[], ["w"]]);
  assert.equal(projectsToBackup([album("w", "2026-11-02T00:00:00Z")], loadBackupMarks(storage)).length, 1, "un backup fallito si ritenta alla prossima chiusura");
});

test("backup alla chiusura: un caricamento lento viene lasciato e il tempo concesso non si supera", async () => {
  const storage = memoryStorage();
  setAutoBackupEnabled(true, storage);
  const slow = { connected: async () => true, backup: () => new Promise<void>(() => undefined) };
  const started = Date.now();
  const result = await backupOnClose([album("slow", "2026-12-01T00:00:00Z")], slow, 1800, storage);
  assert.deepEqual([result.saved, result.failed], [[], ["slow"]]);
  assert.ok(Date.now() - started < 3000, "esce entro il tempo concesso");
  assert.equal(projectsToBackup([album("slow", "2026-12-01T00:00:00Z")], loadBackupMarks(storage)).length, 1);

  let clock = 0;
  const calls: string[] = [];
  const timed = await backupOnClose([album("p", "2026-12-03T00:00:00Z"), album("q", "2026-12-02T00:00:00Z")], { connected: async () => true, now: () => clock, backup: async (project) => { calls.push(project.projectId); clock += 14000; } }, 15000, memoryStorage({ [AUTO_BACKUP_KEYS.enabled]: "1" }));
  assert.deepEqual(calls, ["p"], "il secondo non parte: restano meno di 1,5 secondi");
  assert.equal(timed.skipped, "tempo scaduto");
});
