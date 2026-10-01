import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedImage, imagesVersion, refreshChangedFiles, requestImage } from "./api";

const PATH = "D:\foto\DSC0001.jpg";

function install() {
  const calls: Array<{ kind: "thumb" | "preview"; key: string | undefined }> = [];
  const state = { stamp: { size: 1000, lastModified: 1 } };
  const image = () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg", width: 10, height: 10 });
  (globalThis as unknown as { window: unknown }).window = {
    filexDesktop: {
      statFiles: async (paths: string[]) => paths.map((absolutePath) => ({ name: "DSC0001.jpg", absolutePath, ...state.stamp })),
      getThumbnails: async (requests: Array<{ id: string; sourceFileKey?: string }>) => requests.map((request) => { calls.push({ kind: "thumb", key: request.sourceFileKey }); return { id: request.id, image: image() }; }),
      getPreview: async (_path: string, options: { sourceFileKey?: string }) => { calls.push({ kind: "preview", key: options.sourceFileKey }); return image(); },
    },
  };
  return { calls, state };
}

const load = (pixels: number) => new Promise<string | null>((resolve) => { requestImage(PATH, pixels, resolve); });

test("file modificato sul disco: le immagini si rigenerano con una chiave nuova e le viste vengono avvisate", async () => {
  const { calls, state } = install();
  const first = await load(200);
  assert.ok(first, "miniatura caricata");
  assert.equal(calls[0].key, `${PATH}|1000:1`, "la richiesta porta l'impronta del file (dimensione e data)");
  assert.equal(cachedImage(PATH, 200), first, "la seconda volta arriva dalla cache");

  assert.deepEqual(await refreshChangedFiles([PATH]), [], "file invariato: nessun cambiamento");
  const version = imagesVersion();

  state.stamp = { size: 2048, lastModified: 99 };
  assert.deepEqual(await refreshChangedFiles([PATH]), [PATH], "file salvato da un altro programma: rilevato");
  assert.equal(cachedImage(PATH, 200), undefined, "la vecchia immagine è scartata");
  assert.ok(imagesVersion() > version, "le viste vengono avvisate");

  const second = await load(200);
  assert.ok(second && second !== first, "nuova immagine");
  assert.equal(calls.at(-1)?.key, `${PATH}|2048:99`, "la cache del processo desktop riceve la chiave nuova, quindi non serve la vecchia");

  const preview = await load(1400);
  assert.ok(preview);
  assert.equal(calls.at(-1)?.kind, "preview");
  assert.equal(calls.at(-1)?.key, `${PATH}|2048:99`);
});
