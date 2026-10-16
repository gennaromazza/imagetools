import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWindowToWorkArea } from "./window-fit.js";
import { desktopToolManifest } from "./tool-manifest.js";

// Su un portatile la finestra prevista dal catalogo (Album Flow: 1540 × 980) usciva dallo schermo: le strisce di destra restavano tagliate.

const ALBUM = desktopToolManifest["album-flow"];
const wanted = { width: ALBUM.defaultWindowWidth, height: ALBUM.defaultWindowHeight, minWidth: ALBUM.minWindowWidth, minHeight: ALBUM.minWindowHeight };

test("la finestra sta sempre dentro l'area utile, per ogni schermo e per ogni tool", () => {
  const screens = [
    { x: 0, y: 0, width: 1536, height: 816 }, // 1920×1080 con scala 125% e barra delle applicazioni
    { x: 0, y: 0, width: 1280, height: 672 }, // 1920×1080 con scala 150%
    { x: 0, y: 0, width: 1366, height: 728 }, // 1366×768 senza scala
    { x: 0, y: 0, width: 1024, height: 700 },
    { x: -1920, y: 0, width: 1920, height: 1040 }, // secondo monitor a sinistra
    { x: 0, y: 0, width: 3840, height: 2100 }, // schermo grande: resta la dimensione del catalogo
  ];
  for (const screen of screens) {
    for (const tool of Object.values(desktopToolManifest)) {
      const fitted = fitWindowToWorkArea({ width: tool.defaultWindowWidth, height: tool.defaultWindowHeight, minWidth: tool.minWindowWidth, minHeight: tool.minWindowHeight }, screen);
      const label = `${tool.id} su ${screen.width}×${screen.height}`;
      assert.ok(fitted.width <= screen.width && fitted.height <= screen.height, `${label}: più grande dello schermo`);
      assert.ok(fitted.x >= screen.x && fitted.y >= screen.y, `${label}: esce a sinistra o in alto`);
      assert.ok(fitted.x + fitted.width <= screen.x + screen.width && fitted.y + fitted.height <= screen.y + screen.height, `${label}: esce a destra o in basso`);
      assert.ok(fitted.minWidth <= fitted.width && fitted.minHeight <= fitted.height, `${label}: il minimo supera la finestra`);
    }
  }
});

test("su uno schermo grande la finestra resta quella del catalogo, centrata", () => {
  const fitted = fitWindowToWorkArea(wanted, { x: 0, y: 0, width: 2560, height: 1400 });
  assert.equal(fitted.width, wanted.width);
  assert.equal(fitted.height, wanted.height);
  assert.equal(fitted.minWidth, wanted.minWidth);
  assert.equal(fitted.x, Math.round((2560 - wanted.width) / 2));
});

test("Album Flow su un portatile 1536 × 816 occupa tutta l'area utile e il minimo si adatta", () => {
  const fitted = fitWindowToWorkArea(wanted, { x: 0, y: 0, width: 1536, height: 816 });
  assert.deepEqual([fitted.width, fitted.height, fitted.x, fitted.y], [1536, 816, 0, 0]);
  assert.ok(fitted.minHeight <= 816, "il minimo di altezza (740) non deve superare l'area utile");
});
