import { test } from "node:test";
import assert from "node:assert/strict";
import { ADJUST_KEYS, adjustCssFilter, adjustFilterId, adjustFilterSvg, applyTransform, colorTransform, isNeutralAdjust, sameAdjust, sanitizeAdjust, saturationMatrix, withAdjustValue } from "./colorAdjust";
import { MATCH_LIMITS, averageStats, computeStats, rgbToLab, solveMatch, statsDistance } from "./colorMatch";
import { matchSpread, matchToOthers, setColorAdjust, spreadAssetIds } from "./colorOps";
import { fillSpread } from "./autobuild";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { parseAlbumProject, serializeAlbumProject } from "./portability";
import { addSpread } from "./spreads";
import { renderSpreadSvg } from "../render/spread-svg";

/** Campione sintetico: un colore di base con un po' di variazione, sempre uguale (generatore deterministico). */
function sample(base: [number, number, number], spread = 40, count = 900): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  let seed = 12345;
  const next = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < count; i += 1) {
    const shade = (next() - 0.5) * spread;
    out[i * 4] = base[0] + shade;
    out[i * 4 + 1] = base[1] + shade;
    out[i * 4 + 2] = base[2] + shade;
    out[i * 4 + 3] = 255;
  }
  return out;
}

const apply = (pixels: Uint8ClampedArray, adjust: Parameters<typeof colorTransform>[0]): Uint8ClampedArray => {
  const t = colorTransform(adjust);
  const out = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b] = applyTransform(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255, t);
    out[i] = r * 255; out[i + 1] = g * 255; out[i + 2] = b * 255; out[i + 3] = pixels[i + 3];
  }
  return out;
};

test("correzione: valori nei limiti, arrotondati, e lo zero non lascia traccia", () => {
  assert.equal(sanitizeAdjust(undefined), undefined);
  assert.equal(sanitizeAdjust({}), undefined);
  assert.equal(sanitizeAdjust({ brightness: 0, contrast: 0.2 }), undefined, "sotto mezzo punto è zero");
  assert.deepEqual(sanitizeAdjust({ brightness: 250, tint: -3000, contrast: 10.3 }), { brightness: 100, tint: -100, contrast: 10.5 });
  assert.deepEqual(sanitizeAdjust({ brightness: Number.NaN, saturation: 5 }), { saturation: 5 });
  assert.ok(isNeutralAdjust({ brightness: 0 }));
  assert.ok(sameAdjust({ brightness: 10 }, { brightness: 10, tint: 0 }));
  assert.ok(!sameAdjust({ brightness: 10 }, { brightness: 11 }));
  assert.equal(withAdjustValue({ brightness: 10 }, "brightness", 0), undefined, "tornare a zero svuota la correzione");
  assert.deepEqual(withAdjustValue(undefined, "contrast", 20), { contrast: 20 });
});

test("trasformazione: neutra = identità; ogni cursore fa quello che dice", () => {
  const neutral = colorTransform(undefined);
  assert.deepEqual(neutral.slope, [1, 1, 1]);
  assert.deepEqual(neutral.intercept, [0, 0, 0]);
  assert.equal(neutral.saturation, 1);
  const grey = (adjust: Parameters<typeof colorTransform>[0]) => applyTransform(0.5, 0.5, 0.5, colorTransform(adjust));
  assert.ok(grey({ brightness: 40 })[1] > 0.5 && grey({ brightness: -40 })[1] < 0.5, "luminosità");
  assert.ok(Math.abs(grey({ contrast: 60 })[1] - 0.5) < 1e-9, "il contrasto lascia fermo il grigio medio");
  const dark = applyTransform(0.2, 0.2, 0.2, colorTransform({ contrast: 60 }));
  const light = applyTransform(0.8, 0.8, 0.8, colorTransform({ contrast: 60 }));
  assert.ok(dark[1] < 0.2 && light[1] > 0.8, "più contrasto: scuri più scuri, chiari più chiari");
  const warm = grey({ temperature: 50 });
  assert.ok(warm[0] > warm[1] && warm[1] > warm[2], "caldo: più rosso, meno blu");
  const cool = grey({ temperature: -50 });
  assert.ok(cool[2] > cool[1] && cool[1] > cool[0], "freddo: più blu, meno rosso");
  const magenta = grey({ tint: 50 });
  assert.ok(magenta[1] < magenta[0] && magenta[1] < magenta[2], "tinta positiva: meno verde, cioè verso il magenta");
  const [r, g, b] = applyTransform(0.9, 0.3, 0.2, colorTransform({ saturation: -100 }));
  assert.ok(Math.abs(r - g) < 1e-9 && Math.abs(g - b) < 1e-9, "saturazione -100: grigi");
  const vivid = applyTransform(0.6, 0.4, 0.4, colorTransform({ saturation: 60 }));
  assert.ok(vivid[0] - vivid[1] > 0.6 - 0.4, "più viva: i colori si allontanano dal grigio");
  // il bilanciamento del bianco non cambia la luminosità di un grigio medio in modo sensibile
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(Math.abs(lum(grey({ temperature: 80 })) - 0.5) < 0.01, "temperatura: la luminanza resta");
  const m = saturationMatrix(1);
  assert.ok(Math.abs(m[0][0] - 1) < 1e-9 && Math.abs(m[0][1]) < 1e-9 && Math.abs(m[2][2] - 1) < 1e-9, "saturazione 1 = identità");
});

test("filtro SVG: stesso nome per la stessa correzione, assente per la foto com'è, bianco e nero in coda", () => {
  assert.equal(adjustFilterSvg(undefined), null);
  assert.equal(adjustFilterSvg({ brightness: 0 }), null);
  assert.equal(adjustCssFilter({}), undefined);
  const a = { brightness: 10, tint: -5.5 };
  assert.equal(adjustFilterId(a), adjustFilterId({ ...a, contrast: 0 }));
  assert.notEqual(adjustFilterId(a), adjustFilterId({ brightness: 11 }));
  assert.match(adjustFilterId({ brightness: -10, tint: 2.5 }), /^af-adj-[a-z0-9_]+$/, "nome valido per un id");
  const svg = adjustFilterSvg(a)!;
  assert.ok(svg.includes(`id="${adjustFilterId(a)}"`) && svg.includes("feComponentTransfer") && svg.includes('type="saturate"'));
  assert.ok(!svg.includes('values="0"'), "senza bianco e nero la saturazione non è azzerata");
  assert.ok(adjustFilterSvg(a, true)!.includes('values="0"') && adjustFilterSvg(a, true)!.includes("-bn"));
  assert.ok(adjustCssFilter(a)!.startsWith("url(\"data:image/svg+xml,") && adjustCssFilter(a)!.endsWith(`#${adjustFilterId(a)}")`), "filtro dentro l'indirizzo");
  assert.ok(adjustCssFilter(a, true)!.includes("grayscale(1)"));
  for (const key of ADJUST_KEYS) assert.ok(adjustFilterSvg({ [key]: 20 }) !== null, key);
});

test("Lab e statistiche: nero, bianco, grigi e campioni vuoti", () => {
  const black = rgbToLab(0, 0, 0);
  const white = rgbToLab(1, 1, 1);
  assert.ok(Math.abs(black[0]) < 1e-6 && Math.abs(white[0] - 100) < 0.01);
  assert.ok(Math.abs(rgbToLab(0.5, 0.5, 0.5)[1]) < 0.01, "un grigio non ha colore");
  assert.equal(computeStats(new Uint8ClampedArray(0)), null);
  assert.equal(computeStats(new Uint8ClampedArray([10, 10, 10, 0])), null, "i pixel trasparenti non contano");
  const flat = computeStats(sample([120, 120, 120], 0))!;
  assert.ok(flat.stdL < 1e-3 && flat.chroma < 0.5);
  const varied = computeStats(sample([120, 120, 120], 100))!;
  assert.ok(varied.stdL > flat.stdL);
  assert.equal(averageStats([null, undefined]), null);
  const avg = averageStats([flat, varied])!;
  assert.ok(Math.abs(avg.stdL - (flat.stdL + varied.stdL) / 2) < 1e-9);
  assert.equal(statsDistance(flat, flat), 0);
});

test("abbinamento: una foto scura si avvicina a una chiara, una calda a una fredda, e la correzione resta leggera", () => {
  const bright = computeStats(sample([160, 160, 160]))!;
  const dark = sample([112, 112, 112]);
  const fix = solveMatch(dark, bright)!;
  assert.ok(fix && (fix.brightness ?? 0) > 10, "luminosità positiva");
  const after = computeStats(apply(dark, fix))!;
  assert.ok(statsDistance(after, bright) < statsDistance(computeStats(dark)!, bright) * 0.3, "molto più vicina al bersaglio");

  const cool = computeStats(sample([120, 130, 160]))!;
  const warm = sample([160, 130, 110]);
  const toCool = solveMatch(warm, cool)!;
  assert.ok((toCool.temperature ?? 0) < -10, "più fredda");
  const warmTarget = computeStats(sample([160, 130, 110]))!;
  const fromCool = solveMatch(sample([120, 130, 160]), warmTarget)!;
  assert.ok((fromCool.temperature ?? 0) > 10, "più calda");
  for (const fix2 of [fix, toCool, fromCool]) for (const key of ADJUST_KEYS) assert.ok(Math.abs(fix2[key] ?? 0) <= MATCH_LIMITS[key], `${key} entro il limite di abbinamento`);
});

test("abbinamento: foto già simili restano come sono, il risultato non cambia da una volta all'altra", () => {
  const target = computeStats(sample([128, 120, 110]))!;
  const same = sample([128, 120, 110]);
  assert.equal(solveMatch(same, target), undefined, "già uguale: nessuna correzione");
  assert.deepEqual(solveMatch(same, target, { brightness: 12 }), { brightness: 12 }, "una correzione già fatta a mano non viene toccata");
  const a = solveMatch(sample([80, 90, 100]), target);
  const b = solveMatch(sample([80, 90, 100]), target);
  assert.deepEqual(a, b, "deterministico");
  // dopo l'abbinamento un secondo giro non peggiora
  const first = a!;
  const refined = solveMatch(sample([80, 90, 100]), target, first)!;
  const dist = (adjust: typeof first) => statsDistance(computeStats(apply(sample([80, 90, 100]), adjust))!, target);
  assert.ok(dist(refined) <= dist(first) + 1e-9);
});

function spreadWithPhotos() {
  const base = addSpread(makeProject(6), 0, "half");
  const project = fillSpread(base, base.spreads[0].id, 2);
  return { project, spreadId: project.spreads[0].id, ids: spreadAssetIds(project, project.spreads[0].id) };
}

test("operazioni: imposta, azzera e non cambia nulla quando non serve", () => {
  const { project, ids } = spreadWithPhotos();
  assert.ok(ids.length >= 3, "lo spread ha più foto");
  const adjusted = setColorAdjust(project, [ids[0]], { brightness: 20, contrast: 0.1 });
  assert.deepEqual(adjusted.assets.find((asset) => asset.id === ids[0])!.colorAdjust, { brightness: 20 });
  assert.notEqual(adjusted.updatedAt, undefined);
  assert.equal(setColorAdjust(adjusted, [ids[0]], { brightness: 20 }), adjusted, "stessa correzione: stesso progetto");
  assert.equal(setColorAdjust(project, [ids[0]], undefined), project, "nulla da togliere");
  const cleared = setColorAdjust(adjusted, [ids[0]], {});
  assert.ok(!("colorAdjust" in cleared.assets.find((asset) => asset.id === ids[0])!), "la chiave sparisce, non resta vuota");
  assert.equal(setColorAdjust(project, ["non-esiste"], { tint: 5 }), project);
  const many = setColorAdjust(project, ids, { saturation: -10 });
  assert.ok(ids.every((id) => many.assets.find((asset) => asset.id === id)!.colorAdjust?.saturation === -10));
  assertProjectInvariants(many);
});

test("operazioni: abbina una foto alle altre dello spread e uniforma tutto lo spread", () => {
  const { project, spreadId, ids } = spreadWithPhotos();
  const samples = new Map<string, Uint8ClampedArray>([[ids[0], sample([100, 100, 100])], [ids[1], sample([150, 150, 150])], [ids[2], sample([150, 150, 150])]]);
  for (const id of ids.slice(3)) samples.set(id, sample([150, 150, 150]));
  const one = matchToOthers(project, spreadId, ids[0], samples);
  assert.ok((one.assets.find((asset) => asset.id === ids[0])!.colorAdjust?.brightness ?? 0) > 5, "la foto scura si schiarisce");
  assert.ok(ids.slice(1).every((id) => !one.assets.find((asset) => asset.id === id)!.colorAdjust), "le altre restano com'erano");
  assert.equal(matchToOthers(project, spreadId, ids[0], new Map()), project, "senza campioni non cambia nulla");
  assert.equal(matchToOthers(project, spreadId, "non-esiste", samples), project);

  const all = matchSpread(project, spreadId, samples);
  const brightness = (id: string) => all.assets.find((asset) => asset.id === id)!.colorAdjust?.brightness ?? 0;
  assert.ok(brightness(ids[0]) > 0 && brightness(ids[1]) <= 0, "la scura sale, le chiare restano o scendono un poco");
  assert.equal(matchSpread(project, spreadId, new Map([[ids[0], samples.get(ids[0])!]])), project, "servono almeno due foto");
  assertProjectInvariants(all);
});

test("salvataggio: la correzione sopravvive al file; valori fuori scala vengono rifiutati", () => {
  const { project, ids } = spreadWithPhotos();
  const adjusted = setColorAdjust(project, [ids[0]], { brightness: 12.5, temperature: -30 });
  const back = parseAlbumProject(serializeAlbumProject(adjusted));
  assert.deepEqual(back.assets.find((asset) => asset.id === ids[0])!.colorAdjust, { brightness: 12.5, temperature: -30 });
  const broken = JSON.parse(serializeAlbumProject(adjusted)) as { project: { assets: Array<{ colorAdjust?: Record<string, unknown> }> } };
  broken.project.assets[0].colorAdjust = { brightness: 900 };
  assert.throws(() => parseAlbumProject(JSON.stringify(broken)));
});

test("esportazione: la foto corretta porta il suo filtro, una sola volta per correzione, e quella com'è nessuno", () => {
  const { project, spreadId, ids } = spreadWithPhotos();
  const withUrls = { ...project, assets: project.assets.map((asset) => ({ ...asset, previewUrl: "data:image/png;base64,AAAA" })) };
  const plain = renderSpreadSvg(withUrls, withUrls.spreads.find((spread) => spread.id === spreadId)!, undefined, { forPrint: true });
  assert.ok(!plain.includes("af-adj-"));
  const two = setColorAdjust(setColorAdjust(withUrls, [ids[0], ids[1]], { brightness: 20 }), [ids[2]], { contrast: 30 });
  const svg = renderSpreadSvg(two, two.spreads.find((spread) => spread.id === spreadId)!, undefined, { forPrint: true });
  assert.equal((svg.match(/<filter id="af-adj-/g) ?? []).length, 2, "due correzioni diverse, due filtri");
  assert.ok(svg.includes(`filter="url(#${adjustFilterId({ brightness: 20 })})"`));
  assert.ok(svg.includes(`filter="url(#${adjustFilterId({ contrast: 30 })})"`));
});
