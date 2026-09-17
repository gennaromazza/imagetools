function clean(value: string): string { return value.replaceAll("/", "\\").replace(/\\+/g, "\\").replace(/\\\.\\/g, "\\"); }
function absolute(root: string, path: string): string { const r = clean(root).replace(/\\$/, ""); const p = clean(path); return /^[A-Za-z]:\\/.test(p) ? p : `${r}\\${p}`; }
export function resolveAlbumAssetPath(sourceRoot: string, assetPath: string): string {
  if (!sourceRoot.trim() || !assetPath.trim()) throw new Error("Radice e percorso foto sono obbligatori.");
  const root = clean(sourceRoot).replace(/\\$/, ""), candidate = absolute(root, assetPath);
  const fromRoot = candidate.slice(root.length).replace(/^\\/, "");
  if (candidate !== root && !candidate.startsWith(`${root}\\`)) throw new Error("Il percorso della foto esce dalla cartella sorgente.");
  const parts: string[] = [];
  for (const part of fromRoot.split("\\")) { if (!part || part === ".") continue; if (part === "..") { if (!parts.length) throw new Error("Il percorso della foto esce dalla cartella sorgente."); parts.pop(); } else parts.push(part); }
  return `${root}\\${parts.join("\\")}`;
}
