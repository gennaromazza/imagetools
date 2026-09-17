import type { AlbumProject } from "@photo-tools/shared-types";

type RecordValue = Record<string, unknown>;
function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Campo non valido: ${path}.`);
  return value as RecordValue;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Elenco mancante: ${path}.`);
  return value;
}
function text(value: unknown, path: string, empty = false): asserts value is string {
  if (typeof value !== "string" || (!empty && !value.trim())) throw new Error(`Testo non valido: ${path}.`);
}
function number(value: unknown, path: string, min: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) throw new Error(`Numero non valido: ${path}.`);
}
function choice(value: unknown, values: readonly unknown[], path: string) {
  if (!values.includes(value)) throw new Error(`Valore non supportato: ${path}.`);
}
function sheet(value: unknown) {
  const s = record(value, "sheet");
  for (const key of ["presetId", "label"]) text(s[key], `sheet.${key}`);
  for (const key of ["widthCm", "heightCm", "dpi"]) number(s[key], `sheet.${key}`, Number.MIN_VALUE);
  for (const key of ["marginCm", "gapCm"]) number(s[key], `sheet.${key}`, 0);
  if (s.bleedCm !== undefined) number(s.bleedCm, "sheet.bleedCm", 0);
}
function uniqueRecords(value: unknown, path: string): RecordValue[] {
  const ids = new Set<string>();
  return array(value, path).map(item => {
    const entry = record(item, path); text(entry.id, `${path}.id`);
    if (ids.has(entry.id)) throw new Error(`Identificativo duplicato: ${path}.${entry.id}.`);
    ids.add(entry.id); return entry;
  });
}

function validateProject(value: unknown): asserts value is AlbumProject {
  const p = record(value, "project");
  choice(p.schemaVersion, [1], "schemaVersion");
  for (const key of ["projectId", "projectName", "createdAt", "updatedAt"]) text(p[key], key);
  text(p.sourceFolderPath, "sourceFolderPath", true);
  const settings = record(p.settings, "settings"); sheet(settings.sheet);
  choice(settings.defaultFitMode, ["fit", "fill", "crop"], "defaultFitMode");
  choice(settings.cropStrategy, ["balanced", "portraitSafe", "landscapeSafe"], "cropStrategy");
  choice(settings.outputFormat, ["jpg", "png", "tif"], "outputFormat");
  const labels = uniqueRecords(p.labels, "labels");
  for (const label of labels) { text(label.name, "label.name"); choice(label.source, ["album", "selector-custom", "selector-color"], "label.source"); }
  const assets = uniqueRecords(p.assets, "assets");
  const assetIds = new Set(assets.map(asset => asset.id));
  for (const asset of assets) {
    for (const key of ["fileName", "path"]) text(asset[key], `asset.${key}`);
    for (const key of ["width", "height", "aspectRatio"]) number(asset[key], `asset.${key}`, Number.MIN_VALUE);
    number(asset.selectionOrder, "selectionOrder", 0);
    choice(asset.selected, [true, false], "selected");
    choice(asset.orientation, ["horizontal", "vertical", "square"], "orientation");
    array(asset.labelIds, "labelIds").forEach(id => text(id, "labelId"));
    if (asset.customLabels !== undefined) array(asset.customLabels, "customLabels").forEach(label => text(label, "customLabel"));
  }
  for (const chapter of uniqueRecords(p.chapters, "chapters")) {
    text(chapter.title, "chapter.title"); choice(chapter.source, ["manual", "selector-label"], "chapter.source");
    array(chapter.labelIds, "chapter.labelIds").forEach(id => text(id, "labelId"));
    for (const id of array(chapter.orderedAssetIds, "orderedAssetIds")) {
      if (!assetIds.has(id)) throw new Error("Capitolo con riferimento a foto inesistente.");
    }
  }
  for (const page of uniqueRecords(p.pages, "pages")) {
    sheet(page.sheetSpec); number(page.pageNumber, "pageNumber", 1);
    text(page.templateId, "templateId"); text(page.templateLabel, "templateLabel");
    choice(page.pageSide, ["left", "right", "single"], "pageSide");
    const slots = uniqueRecords(page.slotDefinitions, "slotDefinitions");
    const slotIds = new Set(slots.map(slot => slot.id));
    for (const slot of slots) {
      for (const key of ["x", "y", "width", "height"]) number(slot[key], `slot.${key}`, 0);
    }
    for (const item of array(page.assignments, "assignments")) {
      const assignment = record(item, "assignment");
      if (!assetIds.has(assignment.imageId) || !slotIds.has(assignment.slotId)) throw new Error("Assegnazione con foto o slot inesistente.");
      choice(assignment.fitMode, ["fit", "fill", "crop"], "fitMode");
      for (const key of ["zoom", "offsetX", "offsetY", "rotation"]) number(assignment[key], key, -Number.MAX_VALUE);
    }
    array(page.imageIds, "imageIds").forEach(id => { if (!assetIds.has(id)) throw new Error("Pagina con foto inesistente."); });
    array(page.warnings, "warnings").forEach(warning => text(warning, "warning", true));
  }
}

export function serializeAlbumProject(project: AlbumProject): string {
  return JSON.stringify({ format: "filex-album-project", version: 1, project }, null, 2);
}

export function parseAlbumProject(raw: string): AlbumProject {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("File progetto non valido: JSON corrotto."); }
  const envelope = record(parsed, "file");
  if (envelope.format !== "filex-album-project" || envelope.version !== 1) {
    throw new Error("Versione o formato progetto non supportato.");
  }
  const project = envelope.project;
  validateProject(project);
  return project;
}
