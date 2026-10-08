import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { applyRelink, relativePathOfCandidate, relativeToRoot, relinkAssets, type FoundFile } from "./relinkAssets";
import { makeAsset, makeProject } from "./fixtures";

const asset = (id: string, absolutePath: string, size?: number): AlbumAssetV2 => {
  const { size: _unused, ...base } = makeAsset(0);
  const name = absolutePath.split(/[\\/]/).pop()!;
  return { ...base, id, fileName: name, path: name, absolutePath, ...(size !== undefined ? { size } : {}) };
};
const file = (root: string, relativePath: string, size?: number): FoundFile => ({ absolutePath: `${root}/${relativePath}`, fileName: relativePath.split("/").pop()!, relativePath, ...(size !== undefined ? { size } : {}) });
const ids = (...list: string[]) => new Set(list);

test("ricollego: stesso percorso relativo su un altro computer, radice ricavata", () => {
  const assets = [asset("a", "D:\\Foto\\Rossi\\Chiesa\\IMG_1.jpg", 100), asset("b", "D:\\Foto\\Rossi\\Casa\\IMG_2.jpg", 200)];
  const files = [file("/Volumes/Disco/Rossi", "Chiesa/IMG_1.jpg", 100), file("/Volumes/Disco/Rossi", "Casa/IMG_2.jpg", 200), file("/Volumes/Disco/Rossi", "Casa/altra.jpg", 5)];
  const result = relinkAssets(assets, ids("a", "b"), files, "D:\\Foto\\Rossi");
  assert.equal(result.found.size, 2);
  assert.equal(result.found.get("a")?.how, "percorso");
  assert.equal(result.found.get("a")?.absolutePath, "/Volumes/Disco/Rossi/Chiesa/IMG_1.jpg");
  assert.equal(result.newRoot, "/Volumes/Disco/Rossi");
  assert.deepEqual([result.ambiguous, result.missing], [[], []]);
});

test("ricollego: cartelle riordinate → nome e dimensione; nomi doppi o foto assenti non si indovinano", () => {
  const assets = [asset("a", "D:\\Old\\x\\A.jpg", 10), asset("b", "D:\\Old\\x\\B.jpg", 20), asset("c", "D:\\Old\\x\\C.jpg", 30), asset("d", "D:\\Old\\x\\D.jpg", 40)];
  const files = [file("/n", "uno/A.jpg", 10), file("/n", "due/B.jpg", 20), file("/n", "tre/B.jpg", 20), file("/n", "tre/D.jpg", 41)];
  const result = relinkAssets(assets, ids("a", "b", "c", "d"), files, "D:\\Old");
  assert.equal(result.found.get("a")?.how, "nome e dimensione");
  assert.deepEqual(result.ambiguous, ["b"], "due file uguali: non sceglie");
  assert.deepEqual(result.missing, ["c"], "C non c'è");
  assert.equal(result.found.get("d")?.how, "nome", "D è stata ri-salvata (peso diverso) ma il nome è unico");
  assert.equal(result.newRoot, null);
});

test("ricollego: foto ri-salvata dopo l'album (peso cambiato) si ritrova per nome unico, mai con nomi doppi", () => {
  const assets = [asset("a", "E:\\Battesimo\\selezionate\\_IMAG5106_4bc96760.jpg", 20000000), asset("b", "E:\\Battesimo\\selezionate\\_IMAG5284_346046a1.jpg", 20000000)];
  const files = [file("/n/selezionate", "_IMAG5106_4bc96760.jpg", 21602826), file("/n/selezionate", "_IMAG5284_346046a1.jpg", 23808997), file("/n/vecchie", "_IMAG5284_346046a1.jpg", 1)];
  const result = relinkAssets(assets, ids("a", "b"), files, "D:\\Altro");
  assert.equal(result.found.get("a")?.how, "nome");
  assert.deepEqual(result.ambiguous, ["b"], "due file con quel nome: non sceglie");
});

test("ricollego: un file non va a due foto, e la dimensione sbagliata sul percorso giusto non basta", () => {
  const assets = [asset("a", "D:\\R\\IMG.jpg", 10), asset("b", "D:\\Altro\\IMG.jpg", 10)];
  const files = [file("/n", "IMG.jpg", 10)];
  const result = relinkAssets(assets, ids("a", "b"), files, "D:\\R");
  assert.equal(result.found.size, 1);
  assert.equal(result.found.get("a")?.how, "percorso", "il percorso ha la precedenza");
  assert.deepEqual(result.ambiguous.concat(result.missing), ["b"]);
  const wrongSize = relinkAssets([asset("a", "D:\\R\\IMG.jpg", 99)], ids("a"), files, "D:\\R");
  assert.equal(wrongSize.found.get("a")?.how, "nome", "peso diverso (foto ri-salvata): si ritrova per nome unico");
  const twins = relinkAssets([asset("a", "D:\\R\\IMG.jpg", 99)], ids("a"), [file("/n", "uno/IMG.jpg", 10), file("/n", "due/IMG.jpg", 11)], "D:\\R");
  assert.equal(twins.found.size, 0, "stesso nome ovunque e pesi diversi: non si indovina");
});

test("ricollego: foto senza dimensione solo per nome unico; maiuscole ignorate; solo le foto richieste", () => {
  const assets = [asset("a", "D:\\R\\Foto.JPG"), asset("b", "D:\\R\\Doppia.jpg"), asset("c", "D:\\R\\Fuori.jpg", 5)];
  const files = [file("/n", "sub/foto.jpg"), file("/n", "x/doppia.jpg"), file("/n", "y/doppia.jpg"), file("/n", "Fuori.jpg", 5)];
  const result = relinkAssets(assets, ids("a", "b"), files, "D:\\R");
  assert.equal(result.found.get("a")?.how, "nome");
  assert.deepEqual(result.ambiguous, ["b"]);
  assert.ok(!result.found.has("c"), "una foto non richiesta non si tocca");
});

test("ricollego: percorsi relativi e applicazione al progetto", () => {
  assert.equal(relativeToRoot("D:\\Foto\\Rossi\\Chiesa\\a.jpg", "d:/foto/rossi/"), "Chiesa/a.jpg");
  assert.equal(relativeToRoot("/mnt/x/a.jpg", "/mnt/x"), "a.jpg");
  assert.equal(relativeToRoot("D:\\Altro\\a.jpg", "D:\\Foto"), null);
  assert.equal(relativeToRoot("D:\\Fotografie\\a.jpg", "D:\\Foto"), null, "prefisso di nome non è una sottocartella");
  assert.equal(relativePathOfCandidate("Rossi/Chiesa/Altare", "a.jpg"), "Chiesa/Altare/a.jpg");
  assert.equal(relativePathOfCandidate("Rossi", "a.jpg"), "a.jpg");

  const project = makeProject(2);
  const target = project.assets[0];
  const relinked = applyRelink(project, { found: new Map([[target.id, { absolutePath: "/nuovo/a.jpg", how: "percorso" }]]), ambiguous: [], missing: [], newRoot: "/nuovo" });
  assert.equal(relinked.assets[0].absolutePath, "/nuovo/a.jpg");
  assert.equal(relinked.sourceFolderPath, "/nuovo");
  assert.equal(relinked.assets[1], project.assets[1], "le altre foto restano intatte");
  assert.equal(applyRelink(project, { found: new Map(), ambiguous: [], missing: [], newRoot: null }), project);
});
