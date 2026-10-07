export const MAX_COPIES = 99;

export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_COPIES, Math.round(value)));
}

export function copiesFor(id: string, defaultCopies: number, overrides: Record<string, number>): number {
  return clampCopies(overrides[id] ?? defaultCopies);
}

/** Ripete ogni foto per il numero di copie richiesto (quello della singola foto, altrimenti quello generale). */
export function expandAssetsByCopies<T extends { id: string }>(
  assets: T[],
  defaultCopies: number,
  overrides: Record<string, number>,
): T[] {
  return assets.flatMap((asset) => Array.from({ length: copiesFor(asset.id, defaultCopies, overrides) }, () => asset));
}

export function totalPrintCount(assets: Array<{ id: string }>, defaultCopies: number, overrides: Record<string, number>): number {
  return assets.reduce((sum, asset) => sum + copiesFor(asset.id, defaultCopies, overrides), 0);
}

/** Sposta una foto al posto di un'altra, mantenendo l'ordine delle restanti. */
export function moveItem<T extends { id: string }>(list: T[], fromId: string, toId: string): T[] {
  const fromIndex = list.findIndex((item) => item.id === fromId);
  const toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return list;
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
