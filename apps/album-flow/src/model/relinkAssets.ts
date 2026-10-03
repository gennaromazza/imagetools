import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { normalizePathKey } from "./import";
import type { Project } from "./project";

/**
 * Ricollegamento delle foto quando l'album viene aperto su un altro computer (o le foto sono state spostate).
 * Non guarda il disco: lavora su elenchi già letti, così gira identico nei test. Non indovina mai tra nomi doppi.
 */

/** Un file trovato nella nuova cartella. `relativePath` è relativo a quella cartella, con «/». */
export interface FoundFile {
  absolutePath: string;
  fileName: string;
  size?: number;
  relativePath: string;
}

export type RelinkHow = "percorso" | "nome e dimensione" | "nome";

export interface RelinkResult {
  /** Nuovo percorso assoluto per ogni foto ritrovata. */
  found: Map<string, { absolutePath: string; how: RelinkHow }>;
  /** Foto con più candidati ugualmente validi: non si sceglie al posto tuo. */
  ambiguous: string[];
  /** Foto senza alcun candidato. */
  missing: string[];
  /** Radice della nuova cartella ricavata dagli abbinamenti per percorso, se coerente. */
  newRoot: string | null;
}

const lower = (value: string) => value.toLowerCase();

/** Percorso di `asset` relativo alla vecchia radice dell'album, se ci sta dentro. */
export function relativeToRoot(absolutePath: string, oldRoot: string): string | null {
  const full = absolutePath.replaceAll("\\", "/").replace(/\/+/g, "/");
  const root = oldRoot.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/+$/, "");
  if (!root) return null;
  const windowsLike = /^[A-Za-z]:\/|^\/\//.test(full);
  const fold = (value: string) => (windowsLike ? value.toLowerCase() : value);
  return fold(full).startsWith(`${fold(root)}/`) ? full.slice(root.length + 1) : null;
}

/**
 * Abbina le foto indicate (`assetIds`: quelle non trovate) ai file della nuova cartella.
 * Ordine: stesso percorso relativo → stesso nome e stessa dimensione (se unico) → stesso nome (solo se la dimensione non è nota e il nome è unico).
 * Un file già assegnato a una foto non viene dato a un'altra.
 */
export function relinkAssets(assets: readonly AlbumAssetV2[], assetIds: ReadonlySet<string>, files: readonly FoundFile[], oldRoot: string): RelinkResult {
  const byPath = new Map<string, FoundFile[]>();
  const byNameSize = new Map<string, FoundFile[]>();
  const byName = new Map<string, FoundFile[]>();
  const push = (map: Map<string, FoundFile[]>, key: string, file: FoundFile) => { const list = map.get(key); if (list) list.push(file); else map.set(key, [file]); };
  for (const file of files) {
    push(byPath, lower(file.relativePath.replaceAll("\\", "/")), file);
    push(byName, lower(file.fileName), file);
    if (file.size !== undefined) push(byNameSize, `${lower(file.fileName)}|${file.size}`, file);
  }

  const found: RelinkResult["found"] = new Map();
  const ambiguous: string[] = [];
  const claimed = new Set<string>();
  const roots = new Map<string, number>();
  const targets = assets.filter((asset) => assetIds.has(asset.id));

  const take = (asset: AlbumAssetV2, candidates: FoundFile[] | undefined, how: RelinkHow): "ok" | "ambiguous" | "none" => {
    const free = (candidates ?? []).filter((file) => !claimed.has(normalizePathKey(file.absolutePath)));
    if (free.length === 0) return (candidates?.length ?? 0) > 0 ? "ambiguous" : "none";
    if (free.length > 1) return "ambiguous";
    claimed.add(normalizePathKey(free[0].absolutePath));
    found.set(asset.id, { absolutePath: free[0].absolutePath, how });
    return "ok";
  };

  // Prima i percorsi relativi: sono i più affidabili e non devono essere "rubati" da un abbinamento per nome.
  const pending: AlbumAssetV2[] = [];
  for (const asset of targets) {
    const relative = asset.absolutePath && oldRoot ? relativeToRoot(asset.absolutePath, oldRoot) : null;
    const candidates = relative ? byPath.get(lower(relative)) : undefined;
    const sizeMatches = candidates?.filter((file) => file.size === undefined || asset.size === undefined || file.size === asset.size);
    if (sizeMatches && sizeMatches.length === 1 && take(asset, sizeMatches, "percorso") === "ok") {
      const file = sizeMatches[0];
      const root = file.absolutePath.slice(0, file.absolutePath.length - file.relativePath.length).replace(/[\\/]+$/, "");
      roots.set(root, (roots.get(root) ?? 0) + 1);
    } else pending.push(asset);
  }

  const missing: string[] = [];
  for (const asset of pending) {
    const name = lower(asset.fileName);
    let outcome: "ok" | "ambiguous" | "none" = "none";
    if (asset.size !== undefined) outcome = take(asset, byNameSize.get(`${name}|${asset.size}`), "nome e dimensione");
    else if ((byName.get(name)?.length ?? 0) === 1) outcome = take(asset, byName.get(name), "nome");
    else if ((byName.get(name)?.length ?? 0) > 1) outcome = "ambiguous";
    if (outcome === "ambiguous") ambiguous.push(asset.id);
    else if (outcome === "none") missing.push(asset.id);
  }

  const best = [...roots.entries()].sort((a, b) => b[1] - a[1])[0];
  const newRoot = best && roots.size === 1 ? best[0] : null;
  return { found, ambiguous, missing, newRoot };
}

/** Applica un ricollegamento: aggiorna i percorsi delle foto ritrovate (e la radice dell'album se è chiara). */
export function applyRelink(project: Project, result: RelinkResult): Project {
  if (result.found.size === 0) return project;
  const assets = project.assets.map((asset) => {
    const hit = result.found.get(asset.id);
    return hit && hit.absolutePath !== asset.absolutePath ? { ...asset, absolutePath: hit.absolutePath } : asset;
  });
  return { ...project, assets, ...(result.newRoot ? { sourceFolderPath: result.newRoot } : {}), updatedAt: new Date().toISOString() };
}

/** Percorso relativo di un candidato letto da una cartella: l'etichetta «cartella/sotto/…» senza la radice, più il nome. */
export function relativePathOfCandidate(folderLabel: string | undefined, fileName: string): string {
  const parts = (folderLabel ?? "").replaceAll("\\", "/").split("/").filter(Boolean).slice(1);
  return [...parts, fileName].join("/");
}

/** Cartella comune a più percorsi (la «vecchia radice» quando l'album non l'ha memorizzata); stringa vuota se non c'è. */
export function commonRoot(paths: readonly string[]): string {
  const split = paths.filter(Boolean).map((path) => path.replaceAll("\\", "/").replace(/\/+/g, "/").split("/").slice(0, -1));
  if (split.length === 0) return "";
  const windowsLike = /^[A-Za-z]:$/.test(split[0][0] ?? "");
  const same = (a: string, b: string) => (windowsLike ? a.toLowerCase() === b.toLowerCase() : a === b);
  let shared = split[0];
  for (const parts of split.slice(1)) {
    let length = 0;
    while (length < shared.length && length < parts.length && same(shared[length], parts[length])) length += 1;
    shared = shared.slice(0, length);
  }
  const joined = shared.join("/");
  // Una sola unità o la radice non sono una cartella di lavoro: meglio nessuna radice che una radice sbagliata.
  return shared.length >= 2 || (shared.length === 1 && shared[0] !== "" && !/^[A-Za-z]:$/.test(shared[0])) ? joined : "";
}
