import assert from "node:assert/strict";
import test from "node:test";
import { getArchivioPreviewImageUrl } from "./archivioDesktopApi.js";

test("anteprime: errori condivisi, coda annullabile, priorità e cache distinta per sorgente", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const calls: string[] = [];
  const releases: Array<() => void> = [];
  let fallbackCalls = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { filexDesktop: {
    getThumbnail: async (path: string) => {
      calls.push(path);
      if (path === "missing.jpg") { await new Promise(resolve => setTimeout(resolve, 10)); return null; }
      if (path.startsWith("block-")) await new Promise<void>(resolve => releases.push(resolve));
      return { bytes: new Uint8Array([1,2,3]), mimeType: "image/jpeg" };
    },
    getArchivioPreviewImage: async () => { fallbackCalls++; return null; },
  } } });
  const urls: string[] = [];
  const remember = (url: string | null) => { if (url) urls.push(url); return url; };
  try {
    const missing = await Promise.all(Array.from({ length: 4 }, () => getArchivioPreviewImageUrl("I:/", "missing.jpg", "same")));
    assert.deepEqual(missing, [null,null,null,null]);
    assert.equal(calls.filter(path => path === "missing.jpg").length, 1, "un errore condiviso non deve avviare altri tentativi");
    assert.equal(fallbackCalls, 1);

    const blockers = Array.from({ length: 6 }, (_, i) => getArchivioPreviewImageUrl("I:/", `block-${i}.jpg`, "v1").then(remember));
    const gone = new AbortController();
    const abandoned = getArchivioPreviewImageUrl("I:/", "abandoned.jpg", "v1", gone.signal);
    gone.abort();
    const remount = new AbortController();
    const stale = getArchivioPreviewImageUrl("I:/", "remount.jpg", "v1", remount.signal).then(remember);
    remount.abort();
    const live = getArchivioPreviewImageUrl("I:/", "remount.jpg", "v1", new AbortController().signal).then(remember);
    const newest = getArchivioPreviewImageUrl("I:/", "visible-now.jpg", "v1").then(remember);
    for (const release of releases) release();
    await Promise.all([...blockers, stale, live, newest]);
    assert.equal(await abandoned, null);
    assert.equal(calls.includes("abandoned.jpg"), false);
    assert.equal(calls.filter(path => path === "remount.jpg").length, 1);
    assert.ok(calls.indexOf("visible-now.jpg") < calls.indexOf("remount.jpg"));
    await getArchivioPreviewImageUrl("I:/", "same-name.jpg", "serial-A:1:2").then(remember);
    await getArchivioPreviewImageUrl("I:/", "same-name.jpg", "serial-A:1:2").then(remember);
    await getArchivioPreviewImageUrl("I:/", "same-name.jpg", "serial-B:1:2").then(remember);
    assert.equal(calls.filter(path => path === "same-name.jpg").length, 2);
  } finally {
    releases.forEach(release => release());
    urls.forEach(url => URL.revokeObjectURL(url));
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
