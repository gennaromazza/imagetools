/** Dimensioni della finestra limitate all'area utile dello schermo (esclusa la barra delle applicazioni), centrate in essa. */
export function fitWindowToWorkArea(
  wanted: { width: number; height: number; minWidth: number; minHeight: number },
  workArea: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number; minWidth: number; minHeight: number } {
  const width = Math.max(320, Math.min(wanted.width, workArea.width));
  const height = Math.max(240, Math.min(wanted.height, workArea.height));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
    minWidth: Math.min(wanted.minWidth, width),
    minHeight: Math.min(wanted.minHeight, height),
  };
}
