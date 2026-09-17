import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname.replace(/^\//, "").replaceAll("/", "\\");
const app = readFileSync(`${root}apps\\album-flow\\src\\App.tsx`, "utf8");
const css = readFileSync(`${root}apps\\album-flow\\src\\styles.css`, "utf8");
const docs = `${root}docs\\album-flow\\`;

assert.ok(app.includes("consumePhotoSelectionHandoff"), "handoff Photo Selector assente");
assert.ok(app.includes("createAutoLayoutPlan"), "percorso auto layout assente");
assert.ok(app.includes("createChapter"), "creazione capitoli assente");
assert.ok(app.includes("selectedAssets.slice"), "libreria asset assente");
assert.ok(css.includes("object-fit: contain"), "preview senza crop non garantita");
assert.ok(readFileSync(`${root}apps\\album-flow\\src\\spread-renderer.ts`, "utf8").includes("data-safe-area"), "safe area renderer assente");
for (const file of ["AF-000-OPEN-DECISIONS.md", "TASK-AF-000-CURRENT-STATE-AUDIT.md", "AF-000-INTEGRATION-MAP.md"]) {
  assert.ok(existsSync(`${docs}${file}`), `documentazione AF-000 mancante: ${file}`);
}
console.log("Album Flow system checks: OK (handoff, auto layout, capitoli, libreria, preview intera, documentazione)");
