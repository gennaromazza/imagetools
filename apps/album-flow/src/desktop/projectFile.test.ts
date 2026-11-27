import { test } from "node:test";
import assert from "node:assert/strict";
import { albumFingerprint } from "../model/fileLink";
import { makeProject } from "../model/fixtures";
import { canLinkFiles, joinFilePath, pathOfPickedFile, readProjectFile, splitFilePath, statProjectFile, writeProjectFile } from "./projectFile";

/** App desktop finta: un disco in memoria con le sole funzioni usate dal collegamento ai file. */
function fakeDesktop() {
  const disk = new Map<string, { bytes: Uint8Array; lastModified: number }>();
  let clock = 1_700_000_000_000;
  const join = (directory: string, fileName: string) => `${directory}${directory.includes("\\") ? "\\" : "/"}${fileName}`;
  const api = {
    getPathForFile: (file: { path?: string }) => file.path ?? "",
    readFile: async (path: string) => {
      const entry = disk.get(path);
      return entry ? { name: path, absolutePath: path, bytes: entry.bytes, size: entry.bytes.length, lastModified: entry.lastModified } : null;
    },
    statFiles: async (paths: string[]) => paths.filter((path) => disk.has(path)).map((path) => ({ name: path, absolutePath: path, size: disk.get(path)!.bytes.length, lastModified: disk.get(path)!.lastModified })),
    writeFilesReplacing: async (directory: string, files: { fileName: string; bytes: Uint8Array }[]) => files.map((file) => {
      const path = join(directory, file.fileName);
      clock += 1000;
      disk.set(path, { bytes: file.bytes, lastModified: clock });
      return path;
    }),
  };
  return { api, disk };
}

function install(api: unknown) {
  (globalThis as unknown as { window: unknown }).window = api ? { filexDesktop: api } : {};
}

test("splitFilePath su Windows, UNC e macOS", () => {
  assert.deepEqual(splitFilePath("E:\\Album\\Sposi.filex-album.json"), { directory: "E:\\Album", fileName: "Sposi.filex-album.json" });
  assert.deepEqual(splitFilePath("\\\\DESKTOP-BT148BT\\E\\Album\\x.filex-album.json"), { directory: "\\\\DESKTOP-BT148BT\\E\\Album", fileName: "x.filex-album.json" });
  assert.deepEqual(splitFilePath("/Volumes/E/x.filex-album.json"), { directory: "/Volumes/E", fileName: "x.filex-album.json" });
});

test("joinFilePath usa il separatore della cartella", () => {
  assert.equal(joinFilePath("E:\\Album", "x.filex-album.json"), "E:\\Album\\x.filex-album.json");
  assert.equal(joinFilePath("\\\\DESKTOP-BT148BT\\E", "x.filex-album.json"), "\\\\DESKTOP-BT148BT\\E\\x.filex-album.json");
  assert.equal(joinFilePath("/Volumes/E", "x.filex-album.json"), "/Volumes/E/x.filex-album.json");
  assert.equal(joinFilePath("E:\\Album\\", "x.json"), "E:\\Album\\x.json");
});

test("canLinkFiles falso senza app desktop", () => {
  install(null);
  assert.equal(canLinkFiles(), false);
  assert.equal(pathOfPickedFile({} as File), null);
  install(fakeDesktop().api);
  assert.equal(canLinkFiles(), true);
});

test("statProjectFile su file mancante restituisce null", async () => {
  const { api } = fakeDesktop();
  install(api);
  assert.equal(await statProjectFile("E:\\manca.filex-album.json"), null);
  install({ ...api, statFiles: async () => { throw new Error("rete staccata"); } });
  assert.equal(await statProjectFile("E:\\manca.filex-album.json"), null);
});

test("scrittura e rilettura: stesso contenuto e stamp coerente", async () => {
  const { api } = fakeDesktop();
  install(api);
  const project = makeProject(4);
  const path = "\\\\DESKTOP-BT148BT\\E\\Album\\Rossi.filex-album.json";
  const stamp = await writeProjectFile(project, path);
  assert.equal(stamp, await statProjectFile(path));
  const read = await readProjectFile(path);
  assert.equal(read.stamp, stamp);
  assert.equal(albumFingerprint(read.project), albumFingerprint(project));
  assert.equal(pathOfPickedFile({ path } as unknown as File), path);
});

test("readProjectFile su file non raggiungibile spiega cosa controllare", async () => {
  install(fakeDesktop().api);
  await assert.rejects(readProjectFile("E:\\manca.filex-album.json"), /File non raggiungibile/);
});
