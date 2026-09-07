export type OverlayRect = { x: number; y: number; width: number; height: number };

/** A full-width text box can move: unused line space contracts at the edge. */
export function moveTextBox(origin: OverlayRect, dx: number, dy: number, bounds: { width: number; height: number }) {
  const x = Math.max(0, Math.min(bounds.width - 40, Math.round(origin.x + dx)));
  const y = Math.max(0, Math.min(bounds.height - Math.min(origin.height, bounds.height), Math.round(origin.y + dy)));
  return { x, y, width: Math.min(origin.width, bounds.width - x) };
}

/** Deltas always refer to the pointer-down rectangle, never the previous frame. */
export function dragOverlayRect(origin: OverlayRect, mode: "move" | "resize", dx: number, dy: number,
  bounds: { width: number; height: number }, keepRatio = false): OverlayRect {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));
  const width = clamp(origin.width, 8, bounds.width);
  const height = clamp(origin.height, 8, bounds.height);
  if (mode === "move") return {
    x: clamp(origin.x + dx, 0, bounds.width - width),
    y: clamp(origin.y + dy, 0, bounds.height - height), width, height,
  };
  const x = clamp(origin.x, 0, bounds.width - 8);
  const y = clamp(origin.y, 0, bounds.height - 8);
  if (keepRatio) {
    const ratio = width / height;
    const nextWidth = clamp(width + dx, Math.max(16, 16 * ratio), Math.min(bounds.width - x, (bounds.height - y) * ratio));
    return { x, y, width: nextWidth, height: Math.max(1, Math.round(nextWidth / ratio)) };
  }
  return { x, y, width: clamp(width + dx, 8, bounds.width - x), height: clamp(height + dy, 8, bounds.height - y) };
}
