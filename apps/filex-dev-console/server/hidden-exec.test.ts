import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFileHidden, withHiddenWindow } from "./hidden-exec.js";

const here = dirname(fileURLToPath(import.meta.url));

test("finestre nascoste: ogni programma lanciato dalla Dev Console parte senza aprire un terminale", () => {
  assert.equal(withHiddenWindow().windowsHide, true);
  assert.equal(withHiddenWindow({ cwd: "C:\\x", timeout: 5 }).windowsHide, true);
  assert.deepEqual({ ...withHiddenWindow({ cwd: "C:\\x", timeout: 5 }) }, { encoding: "utf8", cwd: "C:\\x", timeout: 5, windowsHide: true });
  assert.equal(withHiddenWindow({ windowsHide: false }).windowsHide, true, "non si puo' riattivare per errore");
  assert.equal(withHiddenWindow({ encoding: "latin1" }).encoding, "latin1", "le altre opzioni restano");
});

test("finestre nascoste: la funzione esegue davvero i comandi e restituisce il testo", async () => {
  const result = await execFileHidden(process.execPath, ["-e", "process.stdout.write('ciao')"], { timeout: 10_000 });
  assert.equal(result.stdout, "ciao");
  await assert.rejects(execFileHidden(process.execPath, ["-e", "process.exit(3)"], { timeout: 10_000 }));
});

test("finestre nascoste: nessun file della Dev Console lancia programmi senza passare dalla funzione sicura", () => {
  const files = readdirSync(here).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "hidden-exec.ts");
  assert.ok(files.length >= 3);
  for (const name of files) {
    const source = readFileSync(join(here, name), "utf8");
    assert.doesNotMatch(source, /promisify\(\s*execFile\s*\)/, `${name}: usare execFileHidden`);
    assert.doesNotMatch(source, /\bexecSync\(|\bexecFileSync\(|\bspawnSync\(/, `${name}: le chiamate sincrone aprono finestre e bloccano la console`);
    assert.doesNotMatch(source, /(?<![\w.])exec\(/, `${name}: exec apre una shell visibile`);
    // Ogni spawn deve chiedere esplicitamente windowsHide nelle sue opzioni.
    for (const match of source.matchAll(/\bspawn\(/g)) {
      const block = source.slice(match.index, match.index + 600);
      assert.match(block, /windowsHide:\s*true/, `${name}: spawn senza windowsHide`);
    }
  }
});
