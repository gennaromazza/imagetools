import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = resolve("apps/filex-desktop/src");

function runtimeClosure(entry: string): string[] {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const file = resolve(source, `${current}.ts`);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?from\s+["']\.\/([^"']+)\.js["']/g)) {
      if (!/^\s*import\s+type\b/.test(match[0].trimStart())) queue.push(match[1]);
    }
  }
  return [...visited];
}

test("every runtime module reachable from the Suite main process is whitelisted for packaging", () => {
  const config = readFileSync(resolve("apps/filex-desktop/electron-builder.config.mjs"), "utf8");
  const start = config.indexOf('".output/electron/suite-main.js"');
  assert.ok(start >= 0, "voce della Suite non trovata nella whitelist");
  const block = config.slice(start, config.indexOf('"package.json"', start));
  const missing = runtimeClosure("suite-main").filter((name) => !block.includes(`".output/electron/${name}.js"`));
  assert.deepEqual(missing, [], `Moduli del main process non inclusi nel pacchetto: ${missing.join(", ")}`);
});

test("the packaged Suite verifier requires the support module", () => {
  const verifier = readFileSync(resolve("apps/filex-desktop/scripts/verify-packaged-component.mjs"), "utf8");
  assert.ok(verifier.includes("/.output/electron/support-message.js"));
});
