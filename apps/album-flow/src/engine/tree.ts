import type { LayoutNode } from "@photo-tools/shared-types";
import { clampRatio } from "./geometry";

/** Operazioni pure sull'albero di layout: nessuna ne modifica un'altra, tutte restituiscono un nuovo albero. */

export type InsertSide = "left" | "right" | "top" | "bottom";

export function leaf(itemId: string): LayoutNode {
  return { kind: "leaf", itemId };
}

export function split(dir: "row" | "column", ratio: number, first: LayoutNode, second: LayoutNode): LayoutNode {
  return { kind: "split", dir, ratio: clampRatio(ratio), first, second };
}

/** Identificativi delle foto nell'ordine di lettura (sinistra→destra, alto→basso). */
export function leafIds(tree: LayoutNode | null): string[] {
  if (!tree) return [];
  const ids: string[] = [];
  const walk = (node: LayoutNode) => {
    if (node.kind === "leaf") ids.push(node.itemId);
    else { walk(node.first); walk(node.second); }
  };
  walk(tree);
  return ids;
}

export function countLeaves(tree: LayoutNode | null): number {
  if (!tree) return 0;
  return tree.kind === "leaf" ? 1 : countLeaves(tree.first) + countLeaves(tree.second);
}

export function hasLeaf(tree: LayoutNode | null, itemId: string): boolean {
  return leafIds(tree).includes(itemId);
}

/** Nodo al percorso indicato ("" = radice), oppure null. */
export function nodeAt(tree: LayoutNode | null, path: string): LayoutNode | null {
  let node = tree;
  for (const step of path) {
    if (!node || node.kind === "leaf") return null;
    node = step === "0" ? node.first : step === "1" ? node.second : null;
  }
  return node;
}

export function pathOfLeaf(tree: LayoutNode | null, itemId: string): string | null {
  if (!tree) return null;
  const walk = (node: LayoutNode, path: string): string | null => {
    if (node.kind === "leaf") return node.itemId === itemId ? path : null;
    return walk(node.first, `${path}0`) ?? walk(node.second, `${path}1`);
  };
  return walk(tree, "");
}

function replaceAt(tree: LayoutNode, path: string, replacement: LayoutNode): LayoutNode {
  if (path === "") return replacement;
  if (tree.kind === "leaf") return tree;
  return path[0] === "0"
    ? { ...tree, first: replaceAt(tree.first, path.slice(1), replacement) }
    : { ...tree, second: replaceAt(tree.second, path.slice(1), replacement) };
}

/** Sostituisce l'identificativo di una foglia (sostituzione di una foto con un'altra). */
export function renameLeaf(tree: LayoutNode, from: string, to: string): LayoutNode {
  if (tree.kind === "leaf") return tree.itemId === from ? leaf(to) : tree;
  return { ...tree, first: renameLeaf(tree.first, from, to), second: renameLeaf(tree.second, from, to) };
}

/** Scambia le posizioni di due foglie. */
export function swapLeaves(tree: LayoutNode, a: string, b: string): LayoutNode {
  const swap = (node: LayoutNode): LayoutNode => {
    if (node.kind === "leaf") return node.itemId === a ? leaf(b) : node.itemId === b ? leaf(a) : node;
    return { ...node, first: swap(node.first), second: swap(node.second) };
  };
  return swap(tree);
}

/** Toglie una foglia: il genitore si fonde con l'altro figlio. Restituisce null se l'albero resta vuoto. */
export function removeLeaf(tree: LayoutNode | null, itemId: string): LayoutNode | null {
  if (!tree) return null;
  if (tree.kind === "leaf") return tree.itemId === itemId ? null : tree;
  const first = removeLeaf(tree.first, itemId);
  const second = removeLeaf(tree.second, itemId);
  if (first === null) return second;
  if (second === null) return first;
  return first === tree.first && second === tree.second ? tree : { ...tree, first, second };
}

/**
 * Inserisce una foto accanto a un'altra, dal lato indicato: la cella bersaglio diventa una divisione.
 * `ratio` è la quota della cella che resta alla foto già presente (default metà).
 */
export function insertBeside(tree: LayoutNode, targetItemId: string, newItemId: string, side: InsertSide, ratio = 0.5): LayoutNode {
  const path = pathOfLeaf(tree, targetItemId);
  if (path === null) return tree;
  const dir = side === "left" || side === "right" ? "row" : "column";
  const newFirst = side === "left" || side === "top";
  const keep = clampRatio(ratio);
  const node: LayoutNode = newFirst
    ? split(dir, 1 - keep, leaf(newItemId), leaf(targetItemId))
    : split(dir, keep, leaf(targetItemId), leaf(newItemId));
  return replaceAt(tree, path, node);
}

/**
 * Inserisce una foto accanto a un intero ramo del layout (non a una sola foto): con il percorso vuoto è una nuova colonna o riga
 * a tutta area, con il percorso di un nodo si infila accanto a quel gruppo. `share` è la quota che prende la foto nuova.
 */
export function insertAtNode(tree: LayoutNode, path: string, newItemId: string, side: InsertSide, share = 0.33): LayoutNode {
  const node = nodeAt(tree, path);
  if (!node) return tree;
  const dir = side === "left" || side === "right" ? "row" : "column";
  const newFirst = side === "left" || side === "top";
  const wrapped: LayoutNode = newFirst ? split(dir, share, leaf(newItemId), node) : split(dir, 1 - share, node, leaf(newItemId));
  return replaceAt(tree, path, wrapped);
}

/** Cambia il rapporto di divisione di un nodo. */
export function setRatioAt(tree: LayoutNode, path: string, ratio: number): LayoutNode {
  const node = nodeAt(tree, path);
  if (!node || node.kind === "leaf") return tree;
  return replaceAt(tree, path, { ...node, ratio: clampRatio(ratio) });
}

const mirrored = (ratio: number) => clampRatio(Number((1 - ratio).toFixed(6)));

/** Specchio orizzontale: i figli delle divisioni "row" si invertono (l'ordine di lettura cambia di conseguenza). */
export function mirrorHorizontal(tree: LayoutNode): LayoutNode {
  if (tree.kind === "leaf") return tree;
  const first = mirrorHorizontal(tree.first);
  const second = mirrorHorizontal(tree.second);
  return tree.dir === "row" ? { ...tree, ratio: mirrored(tree.ratio), first: second, second: first } : { ...tree, first, second };
}

/** Specchio verticale: i figli delle divisioni "column" si invertono. */
export function mirrorVertical(tree: LayoutNode): LayoutNode {
  if (tree.kind === "leaf") return tree;
  const first = mirrorVertical(tree.first);
  const second = mirrorVertical(tree.second);
  return tree.dir === "column" ? { ...tree, ratio: mirrored(tree.ratio), first: second, second: first } : { ...tree, first, second };
}

/** Forma senza foto: le foglie diventano indici ("0", "1", …) nell'ordine di lettura. Serve per i layout preferiti. */
export function shapeOfTree(tree: LayoutNode): LayoutNode {
  let index = 0;
  const walk = (node: LayoutNode): LayoutNode =>
    node.kind === "leaf" ? leaf(String(index++)) : { ...node, first: walk(node.first), second: walk(node.second) };
  return walk(tree);
}

/** Applica una forma a un elenco ordinato di foto (stesso numero di foglie). */
export function applyShape(shape: LayoutNode, itemIds: readonly string[]): LayoutNode | null {
  if (countLeaves(shape) !== itemIds.length) return null;
  let index = 0;
  const walk = (node: LayoutNode): LayoutNode =>
    node.kind === "leaf" ? leaf(itemIds[index++]) : { ...node, first: walk(node.first), second: walk(node.second) };
  return walk(shape);
}

/** Forme dell'albero (direzioni) per riconoscere layout equivalenti. */
export function treeKind(tree: LayoutNode): string {
  if (tree.kind === "leaf") return "o";
  return `${tree.dir === "row" ? "r" : "c"}(${treeKind(tree.first)},${treeKind(tree.second)})`;
}

/** Errori strutturali di un albero (vuoto = valido). */
export function validateTree(tree: LayoutNode | null, expectedIds?: readonly string[]): string[] {
  const errors: string[] = [];
  if (!tree) return expectedIds && expectedIds.length > 0 ? ["Layout mancante con foto presenti."] : errors;
  const seen = new Set<string>();
  const walk = (node: LayoutNode, depth: number) => {
    if (depth > 64) { errors.push("Albero troppo profondo."); return; }
    if (node.kind === "leaf") {
      if (!node.itemId) errors.push("Foglia senza identificativo.");
      if (seen.has(node.itemId)) errors.push(`Foto duplicata nel layout: ${node.itemId}.`);
      seen.add(node.itemId);
      return;
    }
    if (node.dir !== "row" && node.dir !== "column") errors.push("Direzione di divisione non valida.");
    if (!Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) errors.push("Rapporto di divisione non valido.");
    walk(node.first, depth + 1);
    walk(node.second, depth + 1);
  };
  walk(tree, 0);
  if (expectedIds) {
    const expected = new Set(expectedIds);
    if (expected.size !== seen.size || [...expected].some((id) => !seen.has(id))) errors.push("Le foto del layout non corrispondono all'elenco.");
  }
  return errors;
}

/**
 * Rapporti «naturali»: ogni divisione si regola sulle proporzioni delle foto che contiene, tenendo conto anche dello spazio
 * tra le foto, così in una riga tutte le foto hanno esattamente la stessa altezza e in una colonna la stessa larghezza
 * (con «foto intera» risultano allineate). `size` è l'area utile in mm. Restituisce lo stesso albero se nulla cambia.
 *
 * Ogni ramo ha due funzioni lineari: larghezza necessaria a una data altezza e altezza necessaria a una data larghezza.
 */
export function naturalRatios(tree: LayoutNode, aspectOf: (itemId: string) => number, size: { w: number; h: number }, gapMm: number): LayoutNode {
  const gap = Math.max(0, gapMm);
  interface Fit { width: { a: number; b: number }; height: { a: number; b: number } }
  const fits = new Map<LayoutNode, Fit>();
  const measure = (node: LayoutNode): Fit => {
    let fit: Fit;
    if (node.kind === "leaf") {
      const aspect = Math.max(0.05, aspectOf(node.itemId));
      fit = { width: { a: aspect, b: 0 }, height: { a: 1 / aspect, b: 0 } };
    } else {
      const f = measure(node.first);
      const s = measure(node.second);
      if (node.dir === "row") {
        const alpha = f.width.a + s.width.a;
        const beta = f.width.b + s.width.b + gap;
        fit = { width: { a: alpha, b: beta }, height: { a: 1 / alpha, b: -beta / alpha } };
      } else {
        const gamma = f.height.a + s.height.a;
        const delta = f.height.b + s.height.b + gap;
        fit = { height: { a: gamma, b: delta }, width: { a: 1 / gamma, b: -delta / gamma } };
      }
    }
    fits.set(node, fit);
    return fit;
  };
  measure(tree);
  // Lo spazio avanzato resta tutto ai margini esterni dell'area (`pad`): il blocco di foto è esatto e centrato, quindi le
  // foto interne sono allineate. Le celle ai bordi si estendono verso l'esterno (le foto vi si ancorano verso il centro).
  interface Pad { l: number; r: number; t: number; b: number }
  const assign = (node: LayoutNode, w: number, h: number, pad: Pad): LayoutNode => {
    if (node.kind === "leaf") return node;
    const f = fits.get(node.first)!;
    const s = fits.get(node.second)!;
    const usedW = w - pad.l - pad.r;
    const usedH = h - pad.t - pad.b;
    let ratio: number;
    let firstPad: Pad;
    let secondPad: Pad;
    if (node.dir === "row") {
      ratio = (f.width.a * usedH + f.width.b + pad.l) / Math.max(w - gap, 0.001);
      firstPad = { ...pad, r: 0 };
      secondPad = { ...pad, l: 0 };
    } else {
      ratio = (f.height.a * usedW + f.height.b + pad.t) / Math.max(h - gap, 0.001);
      firstPad = { ...pad, b: 0 };
      secondPad = { ...pad, t: 0 };
    }
    ratio = clampRatio(Number(ratio.toFixed(6)));
    const firstW = node.dir === "row" ? (w - gap) * ratio : w;
    const firstH = node.dir === "row" ? h : (h - gap) * ratio;
    const secondW = node.dir === "row" ? w - gap - firstW : w;
    const secondH = node.dir === "row" ? h : h - gap - firstH;
    const first = assign(node.first, firstW, firstH, firstPad);
    const second = assign(node.second, secondW, secondH, secondPad);
    const same = Math.abs(ratio - node.ratio) < 1e-9 && first === node.first && second === node.second;
    return same ? node : { ...node, ratio, first, second };
  };
  if (tree.kind === "leaf") return tree;
  const root = fits.get(tree)!;
  const heightAtFullWidth = root.height.a * size.w + root.height.b;
  const block = heightAtFullWidth <= size.h
    ? { w: size.w, h: heightAtFullWidth }
    : { w: root.width.a * size.h + root.width.b, h: size.h };
  const padX = Math.max(0, (size.w - block.w) / 2);
  const padY = Math.max(0, (size.h - block.h) / 2);
  return assign(tree, size.w, size.h, { l: padX, r: padX, t: padY, b: padY });
}
