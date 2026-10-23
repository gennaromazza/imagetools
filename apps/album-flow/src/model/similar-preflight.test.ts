import { test } from "node:test";
import assert from "node:assert/strict";
import { appendAssets } from "./items";
import { preflightReport } from "./preflight";
import { addSpread } from "./spreads";
import { analyzeLibrary, formatClock, similarityIssues } from "./similar";
import { T0, look, signals, weddingProject } from "./similarFixtures";
import type { Project } from "./project";

function spreads(project: Project, pages: string[][][]): Project {
  let next = project;
  for (const spread of pages) {
    next = addSpread(next);
    const id = next.spreads[next.spreads.length - 1].id;
    spread.forEach((page, areaIndex) => { if (page.length) next = appendAssets(next, id, areaIndex, page); });
  }
  return next;
}

test("controlli: due foto quasi uguali sullo stesso spread", () => {
  const project = spreads(weddingProject(), [[["c0", "b1"], ["b3"]]]);
  const issues = similarityIssues(project, analyzeLibrary(project));
  const twins = issues.filter((issue) => issue.level === "warning");
  assert.equal(twins.length, 1, "un avviso per spread, anche se le varianti sono su due pagine");
  assert.match(twins[0].message, /^Spread 1: b1 e b3 sono quasi uguali/);
  assert.equal(twins[0].spreadIndex, 0);
  assert.ok(twins[0].itemId, "porta alla foto");
  const apart = spreads(weddingProject(), [[["b1"], ["c0"]], [["b3"], ["c1"]]]);
  assert.equal(similarityIssues(apart, analyzeLibrary(apart)).filter((issue) => issue.level === "warning").length, 0, "su spread diversi non è un problema");
});

test("controlli: un momento diviso tra spread lontani (vicini va bene)", () => {
  const scattered = spreads(weddingProject(), [[["c0", "c1"], ["c2"]], [["k0"], ["k1"]], [["c3"], ["d0"]]]);
  const info = similarityIssues(scattered, analyzeLibrary(scattered)).filter((issue) => issue.message.startsWith("Il momento"));
  assert.equal(info.length, 1);
  assert.equal(info[0].message, `Il momento delle ${formatClock(T0)} è diviso tra gli spread 1 e 3.`);
  assert.equal(info[0].spreadIndex, 2);
  const adjacent = spreads(weddingProject(), [[["c0", "c1"], ["c2"]], [["c3"], ["k0"]]]);
  assert.equal(similarityIssues(adjacent, analyzeLibrary(adjacent)).filter((issue) => issue.message.startsWith("Il momento")).length, 0);
});

test("controlli: bianco e nero accanto al colore sulla stessa pagina", () => {
  const project = spreads(weddingProject(), [[["d0", "d1"], ["d2", "d3"]]]);
  const analysis = analyzeLibrary(project, signals({
    d0: look({ chroma: 1, hash: "0000000000000000" }), d1: look({ chroma: 30, hash: "ffffffffffffffff" }),
    d2: look({ chroma: 1, hash: "00000000ffffffff" }), d3: look({ chroma: 2, hash: "ffffffff00000000" }),
  }));
  const mixed = similarityIssues(project, analysis).filter((issue) => issue.message.includes("bianco e nero"));
  assert.deepEqual(mixed.map((issue) => issue.message), ["Spread 1: foto in bianco e nero accanto a foto a colori (pagina sinistra)."]);
});

test("controlli: album pulito senza avvisi; senza analisi il controllo resta quello di sempre", () => {
  const clean = spreads(weddingProject(), [[["c0", "c1"], ["b2"]], [["k0", "t1"], ["k1"]]]);
  const analysis = analyzeLibrary(clean);
  assert.deepEqual(similarityIssues(clean, analysis), []);
  const twins = spreads(weddingProject(), [[["b1", "b2"], []]]);
  const before = preflightReport(twins);
  const after = preflightReport(twins, analyzeLibrary(twins));
  assert.equal(after.warnings, before.warnings + 1);
  assert.ok(after.issues.some((issue) => issue.message.includes("quasi uguali")));
  assert.ok(!before.issues.some((issue) => issue.message.includes("quasi uguali")));
});
