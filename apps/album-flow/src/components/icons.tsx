import type { SVGProps } from "react";

/** Icone dell'interfaccia: tratti semplici su griglia 24×24, coerenti su Windows e macOS (niente emoji). */
const PATHS = {
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  play: "M8 5.5v13l10.5-6.5z",
  export: "M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v3h16v-3",
  import: "M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M4 17v3h16v-3",
  shuffle: "M16 3h5v5M21 3 4 20M21 16v5h-5M15 15l6 6M4 4l5 5",
  heart: "M12 20.5s-7.5-4.6-9.5-9.3A5.4 5.4 0 0 1 12 6.2a5.4 5.4 0 0 1 9.5 5c-2 4.700-9.500 9.300-9.500 9.300z",
  layouts: "M3.5 4.5h17v6h-17zM3.5 13.5h8v6h-8zM14.500 13.500h6v6h-6z",
  applyAll: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  trash: "M4 7h16M9.500 7V4h5v3M6.500 7l1 13h9l1-13M10.500 11v6M13.500 11v6",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M13 4.500v5M7 14.500v5",
  link: "M10 14a4 4 0 0 0 5.700 0l3-3A4 4 0 0 0 13 5.300l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3A4 4 0 0 0 11 18.700l1-1",
  unlink: "M10 14a4 4 0 0 0 5.700 0l3-3A4 4 0 0 0 13 5.300l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3A4 4 0 0 0 11 18.700l1-1M4 4l16 16",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  splitFull: "M3.500 6.500h17v11h-17z",
  splitHalf: "M3.500 6.500h8v11h-8zM12.500 6.500h8v11h-8z",
  splitThird: "M3.500 6.500h5v11h-5zM9.500 6.500h11v11h-11z",
  splitTwoThirds: "M3.500 6.500h11v11h-11zM15.500 6.500h5v11h-5z",
  alignStart: "M5 5h6M5 5v6M13 13h6v6h-6z",
  alignCenter: "M9 9h6v6H9zM12 3v3M12 18v3M3 12h3M18 12h3",
  alignEnd: "M19 19h-6M19 19v-6M5 5h6v6H5z",
  fill: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9h6v6H9z",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  crop: "M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14",
  pencil: "M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.500M12 7.700v.1",
  lock: "M6 11h12v9H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3",
  unlock: "M6 11h12v9H6zM8.500 11V8a3.500 3.500 0 0 1 6.700-1.400",
  star: "m12 3.500 2.600 5.400 5.900.8-4.300 4.100 1 5.800L12 16.800 6.800 19.600l1-5.800L3.500 9.700l5.900-.8z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  check: "m5 12.500 4.500 4.500L19 7.500",
  warning: "M12 4 2.500 20h19zM12 10v4.500M12 17.200v.1",
  folder: "M3 6.500A1.500 1.500 0 0 1 4.500 5H9l2 2.500h8.500A1.500 1.500 0 0 1 21 9v9.500A1.500 1.500 0 0 1 19.500 20h-15A1.500 1.500 0 0 1 3 18.500z",
  copy: "M9 9h11v11H9zM5 15V5h10",
  search: "M10.500 17a6.500 6.500 0 1 0 0-13 6.500 6.500 0 0 0 0 13zM20 20l-4.800-4.800",
  filter: "M3.500 5h17L14 12.500V19l-4-2v-4.500z",
  sort: "M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4",
  chevronLeft: "m14.500 5-7 7 7 7",
  chevronRight: "m9.500 5 7 7-7 7",
  chevronDown: "m5 9.500 7 7 7-7",
  chevronUp: "m5 14.500 7-7 7 7",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  image: "M3.500 4.500h17v15h-17zM3.500 16l5-5 4 4 3-3 5 5M8.500 9.500h.01",
  book: "M12 6.500C10 5 7 4.500 3.500 5v13c3.500-.5 6.500 0 8.500 1.500 2-1.500 5-2 8.500-1.500V5C17 4.500 14 5 12 6.500zM12 6.500v13",
  columns: "M4 4h4.500v16H4zM9.800 4h4.500v10H9.800zM15.500 4H20v13h-4.500z",
  list: "M4 6h16M4 12h16M4 18h16",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  keyboard: "M3.500 6.500h17v11h-17zM7 10h.01M10.500 10h.01M14 10h.01M17.500 10h.01M7.500 14h9",
  eye: "M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12zM12 14.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z",
  wand: "M5 19 17 7M14 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM19 14l.6 1.400L21 16l-1.400.6L19 18l-.6-1.400L17 16l1.400-.6z",
  tag: "M3.500 12.500V4.500h8l9 9-8 8zM8 8.500h.01",
  mirror: "M12 3v18M8 7 3.500 12 8 17zM16 7l4.500 5-4.500 5z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.500 20a7.500 7.500 0 0 1 15 0",
  archive: "M3.500 5h17v4h-17zM5 9v10.500h14V9M10 13h4",
} as const;

export type IconName = keyof typeof PATHS;

const FILLED = new Set<IconName>(["play"]);

export function Icon({ name, size = 18, strokeWidth = 1.8, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={FILLED.has(name) ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
