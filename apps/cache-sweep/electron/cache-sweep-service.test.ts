import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AdobeInstallation } from "../src/contracts.js";
import { buildOlderVersionCandidates, cleanCacheTarget, isPathWithin, validateCacheTargetPath } from "./cache-sweep-service.js";

function installation(productId: string, displayName: string, version: string): AdobeInstallation {
  return {
    productId,
    displayName,
    version,
    executablePath: null,
    installLocation: `C:\\Program Files\\Adobe\\${displayName}`,
    source: "hklm-64",
    confidence: "verified",
    supportedRuleIds: [],
  };
}

test("isPathWithin accepts descendants and rejects siblings or the root itself", () => {
  const root = resolve("C:\\Users\\Test\\AppData\\Roaming");
  assert.equal(isPathWithin(root, join(root, "Adobe", "Common", "Media Cache")), true);
  assert.equal(isPathWithin(root, root), false);
  assert.equal(isPathWithin(root, resolve(root, "..", "Local")), false);
});

test("validateCacheTargetPath only accepts narrowly named cache targets", () => {
  const root = resolve("C:\\Users\\Test\\AppData\\Roaming");
  assert.equal(validateCacheTargetPath(join(root, "Adobe", "Common", "Media Cache"), [root]), true);
  assert.equal(validateCacheTargetPath(join(root, "Adobe", "Common", "Media Cache Files"), [root]), true);
  assert.equal(validateCacheTargetPath(join(root, "Adobe", "Bridge 2026", "Cache"), [root]), true);
  assert.equal(validateCacheTargetPath(join(root, "Adobe", "Bridge 2026"), [root]), false);
  assert.equal(validateCacheTargetPath(root, [root]), false);
});

test("validateCacheTargetPath accepts Lightroom preview packages but rejects broad folders", () => {
  const root = resolve("C:\\Users\\Test\\Pictures\\Lightroom");
  assert.equal(validateCacheTargetPath(join(root, "Catalog Previews.lrdata"), [root]), true);
  assert.equal(validateCacheTargetPath(join(root, "Catalog.lrcat"), [root]), false);
  assert.equal(validateCacheTargetPath(resolve("C:\\"), [root]), false);
});

test("cleanCacheTarget removes fixture contents but preserves the cache root", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "filex-cache-sweep-"));
  const cacheRoot = join(fixtureRoot, "Cache");
  const nested = join(cacheRoot, "nested");
  try {
    await mkdir(nested, { recursive: true });
    await writeFile(join(cacheRoot, "first.bin"), "1234");
    await writeFile(join(nested, "second.bin"), "56789");

    const result = await cleanCacheTarget({
      path: cacheRoot,
      source: "documented-default",
      fileCount: 2,
      totalBytes: 9,
      skippedLinks: 0,
      scanErrors: [],
    }, [fixtureRoot]);

    assert.equal(result.deletedFiles, 2);
    assert.equal(result.deletedBytes, 9);
    assert.equal(result.skippedItems, 0);
    assert.deepEqual(result.errors, []);
    assert.equal((await stat(cacheRoot)).isDirectory(), true);
    await assert.rejects(readFile(join(cacheRoot, "first.bin")));
    await assert.rejects(stat(nested));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("old-version detection proposes only lower major Adobe versions", () => {
  const candidates = buildOlderVersionCandidates([
    installation("photoshop", "Adobe Photoshop 2026", "27.5"),
    installation("photoshop", "Adobe Photoshop 2026 update", "27.1"),
    installation("photoshop", "Adobe Photoshop 2025", "26.11"),
    installation("illustrator", "Adobe Illustrator 2026", "30.0"),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].displayName, "Adobe Photoshop 2025");
  assert.equal(candidates[0].baseVersion, "26.0");
  assert.equal(candidates[0].currentVersion, "27.5");
});
