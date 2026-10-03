/**
 * Sfondi di serie: disegnati qui come piccoli SVG, quindi senza file esterni né diritti da gestire.
 * Servono per partire subito; i tuoi sfondi e le tue grafiche si caricano dalla libreria.
 */
export interface BuiltinBackground {
  id: string;
  name: string;
  aspect: number;
  svg: string;
}

const svg = (width: number, height: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none">${body}</svg>`;

const noise = (id: string, frequency: string, seed: number, alpha: number, octaves = 3) =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}" seed="${seed}" result="n"/><feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 ${alpha} 0"/></filter>`;

export const BUILTIN_BACKGROUNDS: readonly BuiltinBackground[] = [
  { id: "builtin-ivory", name: "Carta avorio", aspect: 1.5,
    svg: svg(1500, 1000, `<defs>${noise("n", "0.8", 4, 0.22)}</defs><rect width="1500" height="1000" fill="#f4efe6"/><rect width="1500" height="1000" filter="url(#n)"/>`) },
  { id: "builtin-linen", name: "Lino", aspect: 1.5,
    svg: svg(1500, 1000, `<defs>${noise("n", "0.9 0.03", 9, 0.35, 2)}${noise("m", "0.03 0.9", 3, 0.25, 2)}</defs><rect width="1500" height="1000" fill="#e9e3d6"/><rect width="1500" height="1000" filter="url(#n)"/><rect width="1500" height="1000" filter="url(#m)"/>`) },
  { id: "builtin-marble", name: "Marmo chiaro", aspect: 1.5,
    svg: svg(1500, 1000, `<defs><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="turbulence" baseFrequency="0.006 0.012" numOctaves="5" seed="12"/><feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.45  0 0 0 0 0.47  1.6 0 0 0 -0.55"/></filter></defs><rect width="1500" height="1000" fill="#f3f3f1"/><rect width="1500" height="1000" filter="url(#n)" opacity="0.55"/>`) },
  { id: "builtin-slate", name: "Ardesia", aspect: 1.5,
    svg: svg(1500, 1000, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#363d38"/><stop offset="1" stop-color="#1b1f1c"/></linearGradient>${noise("n", "0.7", 2, 0.12)}</defs><rect width="1500" height="1000" fill="url(#g)"/><rect width="1500" height="1000" filter="url(#n)"/>`) },
  { id: "builtin-dawn", name: "Alba", aspect: 1.5,
    svg: svg(1500, 1000, `<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#f6d5c4"/><stop offset="0.55" stop-color="#f2e3d6"/><stop offset="1" stop-color="#dfe6ee"/></linearGradient></defs><rect width="1500" height="1000" fill="url(#g)"/>`) },
  { id: "builtin-ink", name: "Inchiostro", aspect: 1.5,
    svg: svg(1500, 1000, `<defs><radialGradient id="g" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="#262626"/><stop offset="1" stop-color="#050505"/></radialGradient></defs><rect width="1500" height="1000" fill="url(#g)"/>`) },
];

export const builtinDataUrl = (entry: BuiltinBackground) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.svg)}`;

export const isBuiltinMedia = (id: string) => id.startsWith("builtin-");
