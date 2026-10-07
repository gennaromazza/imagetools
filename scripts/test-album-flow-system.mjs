import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Controlli statici di presenza e coerenza: confermano che i pezzi dichiarati nella documentazione esistono nel codice,
// che ogni test è raggiungibile da uno script e dalla Dev Console. Non sostituiscono le prove di comportamento
// (test:album-flow-engine, -model, -flow e -scenarios) né la prova visiva dell'editor.
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const src = (name) => read("apps", "album-flow", "src", name);

// ---------------------------------------------------------------- funzioni dichiarate
const app = src("App.tsx");
assert.ok(app.includes("consumePhotoSelectionHandoff"), "handoff Photo Selector assente");
assert.ok(app.includes("mergeIncomingProject"), "unione del reinvio dal Selector assente");
assert.ok(src("engine/generate.ts").includes("export function generateLayouts"), "motore dei layout dinamici assente");
assert.ok(src("engine/drop.ts").includes("export function resolveDropTarget"), "regole di rilascio (centro, bordo, area vuota) assenti");
assert.ok(src("model/autobuild.ts").includes("export function autoBuildAlbum"), "Auto Build assente");
assert.ok(src("model/chapters.ts").includes("export function createChapter"), "creazione capitoli assente");
assert.ok(src("model/templates.ts").includes("export function matchTemplates") && src("model/templates.ts").includes("export function applyTemplate"), "template dell'utente assenti");
assert.ok(src("components/TemplateEditor.tsx").includes("Libero (sovrapposte)"), "editor dei template (anche con sovrapposizioni) assente");
assert.ok(src("model/import.ts").includes("export function planImport"), "pianificazione dell'importazione (duplicati) assente");
assert.ok(src("model/library.ts").includes("export function unusedAssets"), "distinzione tra foto usate e non usate assente");
assert.ok(src("model/exif.ts").includes("readCaptureTimeFromBlob"), "ora di scatto dal file nel browser assente");
assert.ok(src("model/portability.ts").includes("filex-album-project"), "formato del file progetto assente");
assert.ok(src("render/export.ts").includes("exportSpreads"), "esportazione degli spread assente");

const dock = src("components/LibraryDock.tsx");
assert.ok(dock.includes("thumb--used") || src("components/LibraryDock.tsx").includes("uses"), "libreria con stato d'uso assente");
assert.ok(dock.includes("data-asset-id"), "miniature della libreria non identificabili");
assert.ok(dock.includes("onKeyDown"), "navigazione da tastiera nella libreria assente");
assert.ok(src("components/SpreadView.tsx").includes("draggable"), "trascinamento delle foto nello spread assente");
assert.ok(src("components/SpreadView.tsx").includes("DividerHandle"), "separatori trascinabili assenti");
const workspace = src("components/Workspace.tsx");
assert.ok(workspace.includes("ArrowLeft") && workspace.includes("\"?\""), "scorciatoie da tastiera assenti");
assert.ok(workspace.includes("writeRatingToXmp"), "scrittura delle stelle nel file XMP assente");
assert.ok(src("components/Filmstrip.tsx").includes("spread"), "striscia degli spread assente");
assert.ok(src("components/ClientPreview.tsx").length > 100, "anteprima cliente assente");
assert.ok(src("components/Home.tsx").includes("board"), "Home a colonne assente");
assert.ok(src("components/NewAlbumDialog.tsx").includes("Formati comuni"), "finestra Nuovo album con i formati assente");
assert.ok(src("render/spread-svg.ts").includes("data-safe-area"), "zona sicura nel rendering assente");
// Caroselli e storie per i social: motore, finestra e ingressi. Lo schema del progetto non deve conoscerli (archivio locale).
assert.ok(src("social/plan.ts").includes("export function planCarousel"), "piano automatico dei caroselli assente");
assert.ok(src("social/render.ts").includes("export function renderSlideSvg"), "disegno delle slide per i social assente");
assert.ok(src("social/export-core.ts").includes("export async function exportCarouselWith"), "esportazione dei caroselli assente");
assert.ok(src("components/SocialStudio.tsx").includes("Carosello per i social"), "finestra dei caroselli assente");
assert.ok(workspace.includes("SocialStudio") && workspace.includes("startInSocial"), "ingresso «Carosello» nel Workspace assente");
assert.ok(src("components/Home.tsx").includes("Nuovo carosello"), "ingresso «Nuovo carosello» nella Home assente");
assert.ok(!/carousel|carosell/i.test(read("packages", "shared-types", "src", "album-flow-v2.ts")), "i caroselli non devono entrare nello schema v2 senza una decisione dell'utente");
// Inquadratura, stile dei testi, suggerimenti e varietà dei caroselli: motore e interfaccia.
assert.ok(src("social/framing.ts").includes("export function normalizeFraming") && src("social/usePreviewInteraction.ts").includes("data-photo-slot"), "inquadratura delle foto nei caroselli assente");
assert.ok(src("social/suggest.ts").includes("export function suggestText") && src("components/SocialTextFields.tsx").includes("Suggerisci"), "suggerimenti dei testi nei caroselli assenti");
assert.ok(src("components/SocialStudio.tsx").includes("Altra variante") && src("social/plan.ts").includes("export function freshSeed"), "varietà dei caroselli (altra variante, seme) assente");
assert.ok(src("components/SocialFraming.tsx").includes("Inquadratura") && src("components/SocialTextFields.tsx").includes("Carattere"), "pannelli di inquadratura e stile dei testi assenti");
// Pagina del sito sui caroselli Instagram: esiste, è coerente e non rimanda a file mancanti.
const carouselPagePath = join(root, "website", "strumenti", "album-flow", "caroselli-instagram");
assert.ok(existsSync(join(carouselPagePath, "index.html")), "pagina del sito sui caroselli assente");
const carouselPage = readFileSync(join(carouselPagePath, "index.html"), "utf8");
assert.ok(carouselPage.includes('rel="canonical" href="https://filexsuite.com/strumenti/album-flow/caroselli-instagram/"'), "canonical della pagina caroselli errato");
assert.ok(carouselPage.includes("Album Flow") && carouselPage.includes("Image Select Pro") && carouselPage.includes("FileX All Access"), "la pagina deve dire che è parte di Album Flow, da dove arrivano le foto e che è inclusa in All Access");
assert.ok(carouselPage.includes("Ancora da completare") && carouselPage.includes("Pubblicazione diretta"), "la pagina deve dichiarare i limiti attuali");
for (const block of carouselPage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(block[1]);
for (const reference of carouselPage.matchAll(/(?:src|href)="((?:\.\.\/)+(?:assets|strumenti|guide|supporto|privacy|termini)[^"#]*)"/g)) {
  const target = join(carouselPagePath, reference[1]);
  assert.ok(existsSync(target) || existsSync(join(target, "index.html")), `la pagina caroselli rimanda a un file che non c'è: ${reference[1]}`);
}
for (const sitemap of ["sitemap.xml", "sitemap-filex-suite.xml"]) {
  assert.ok(readFileSync(join(root, "website", sitemap), "utf8").includes("/strumenti/album-flow/caroselli-instagram/"), `la pagina caroselli manca in ${sitemap}`);
}
assert.ok(readFileSync(join(root, "website", "strumenti", "album-flow", "index.html"), "utf8").includes("caroselli-instagram/index.html"), "la pagina di Album Flow deve rimandare a quella dei caroselli");
// Le lettere mostrate nel menu «Segna come» (K, P, M, I) devono essere davvero i tasti che segnano la foto, in libreria, sullo spread e
// nel visualizzatore, e non devono coincidere con altre scorciatoie (es. S = misure delle foto).
const tagLetters = [...src("components/LibraryDock.tsx").matchAll(/(?:cover|panorama|main|social): "([A-Z])"/g)].map((match) => match[1].toLowerCase());
assert.deepEqual(tagLetters.sort(), ["i", "k", "m", "p"], "lettere dei segnalini non attese");
for (const letter of tagLetters) {
  assert.ok(workspace.includes(`key === "${letter}"`), `il tasto ${letter.toUpperCase()} non segna le foto in Workspace`);
  assert.ok(src("components/PhotoViewer.tsx").includes('"kpmi"') , "il visualizzatore non conosce tutti i tasti dei segnalini");
}
assert.ok(!tagLetters.includes("s") && workspace.includes('key === "s") actions.toggleSizes()'), "S è riservato alle misure delle foto");

// ---------------------------------------------------------------- stile FileX
const css = src("styles.css");
for (const token of ["--bg: #1f2421", "--bg-panel: #2b312d", "--accent: #b89a63", "--text: #f2ece5", "--radius-md: 18px"]) {
  assert.ok(css.includes(token), `token grafico FileX mancante: ${token}`);
}

// ---------------------------------------------------------------- servizi condivisi con il desktop
const contractTs = read("packages", "desktop-contracts", "src", "index.ts");
const contractDts = read("packages", "desktop-contracts", "src", "index.d.ts");
assert.ok(contractTs.includes("revealInFolder") && contractDts.includes("revealInFolder"), "revealInFolder mancante nel contratto (index.ts e index.d.ts devono restare allineati)");
assert.ok(read("apps", "filex-desktop", "src", "preload.ts").includes("filex:reveal-in-folder"), "canale revealInFolder assente nel preload");
assert.ok(read("apps", "filex-desktop", "src", "main.ts").includes("filex:reveal-in-folder"), "gestore revealInFolder assente nel main process");
const metadata = read("packages", "photo-metadata", "src", "xmp-sidecar.ts");
assert.ok(metadata.includes("upsertXmpRating") && metadata.includes("readXmpRating"), "stelle XMP condivise assenti");
assert.ok(read("apps", "photo-selector-app", "src", "services", "xmp-sidecar.ts").includes("@photo-tools/photo-metadata"), "il Selector deve usare il pacchetto condiviso, non una copia");

// ---------------------------------------------------------------- l'utente ha detto che il PDF non serve
const pkg = JSON.parse(read("apps", "album-flow", "package.json"));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
assert.ok(!deps.some((name) => /pdf/i.test(name)), "Album Flow non deve dipendere da librerie PDF (non richieste)");

// ---------------------------------------------------------------- ogni test è raggiungibile da uno script e dalla Dev Console
const rootPackage = JSON.parse(read("package.json"));
const scripts = rootPackage.scripts;
const albumScripts = Object.keys(scripts).filter((name) => name.startsWith("test:album-flow-") && name !== "test:album-flow-all");
const consoleServer = read("apps", "filex-dev-console", "server", "index.ts");
for (const name of [...albumScripts, "test:album-flow-all", "test:photo-metadata-xmp"]) {
  assert.ok(consoleServer.includes(`"${name}":`), `descrizione Dev Console mancante per ${name}`);
}
assert.ok(consoleServer.includes('name.startsWith("test:album-flow-")'), "categoria Album Flow non associata ai test");
const all = scripts["test:album-flow-all"];
for (const name of [...albumScripts, "test:photo-metadata-xmp"]) {
  if (name === "test:album-flow-system") continue;
  assert.ok(all.includes(`npm run ${name}`), `${name} non rientra in test:album-flow-all`);
}
assert.ok(all.includes("npm run test:album-flow-system"), "il controllo di sistema non rientra in test:album-flow-all");

const referenced = new Set();
for (const name of [...albumScripts, "test:photo-metadata-xmp"]) {
  for (const match of String(scripts[name]).matchAll(/([\w./-]+\.(?:test\.ts|mjs))/g)) {
    referenced.add(match[1]);
    assert.ok(existsSync(join(root, match[1])), `lo script ${name} punta a un file inesistente: ${match[1]}`);
  }
}
function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? (entry === "node_modules" ? [] : walk(full)) : [full];
  });
}
const tests = walk(join(root, "apps", "album-flow", "src")).filter((file) => file.endsWith(".test.ts")).map((file) => relative(root, file).split("\\").join("/"));
assert.ok(tests.length >= 8, "ci si aspettano almeno otto file di test per Album Flow");
for (const file of tests) assert.ok(referenced.has(file), `test non raggiungibile da nessuno script (e quindi dalla Dev Console): ${file}`);

// ------------------------------------------------- percorsi dei file statici
// Nel pacchetto Electron la pagina si carica da file: un percorso assoluto come "/logo.png" punta alla radice del disco e
// l'immagine non si vede (in sviluppo invece funziona). I file di `public/` vanno citati con `import.meta.env.BASE_URL`.
for (const file of walk(join(root, "apps", "album-flow", "src")).filter((candidate) => /\.(tsx?|css)$/.test(candidate) && !candidate.endsWith(".test.ts"))) {
  const source = readFileSync(file, "utf8");
  const absolute = source.match(/(?:src|href)=["']\/[A-Za-z0-9_.-]+\.(?:png|svg|jpe?g|ico|webp)["']|url\(\s*["']?\/[A-Za-z0-9_.-]+\.(?:png|svg|jpe?g|ico|webp)/);
  assert.equal(absolute, null, `${relative(root, file)}: percorso assoluto a un file statico (${absolute?.[0]}); usa import.meta.env.BASE_URL`);
}

// ---------------------------------------------------------------- documentazione
const docs = join(root, "docs", "album-flow");
for (const file of ["AF-000-OPEN-DECISIONS.md", "TASK-AF-000-CURRENT-STATE-AUDIT.md", "AF-000-TEST-SYSTEM.md", "AF-001-UX-SPEC.md", "AF-002-ENGINE-V2-SPEC.md"]) {
  assert.ok(existsSync(join(docs, file)), `documentazione Album Flow mancante: ${file}`);
}
assert.ok(existsSync(join(root, "apps", "album-flow", "AGENTS.md")), "AGENTS.md di Album Flow mancante");
assert.ok(existsSync(join(root, "website", "strumenti", "album-flow", "index.html")), "pagina del sito di Album Flow mancante");

console.log(`Album Flow system checks: OK (${tests.length} file di test raggiungibili, ${albumScripts.length} script con descrizione nella Dev Console)`);
