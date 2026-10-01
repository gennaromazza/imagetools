/**
 * Risoluzione dei percorsi foto indipendente dalla piattaforma (Windows, macOS, Linux).
 * Nessun accesso al file system: lavora solo su stringhe, così gira identica nel renderer e nei test.
 */
type PathStyle = "win" | "posix";

const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/;
const OUTSIDE_ERROR = "Il percorso della foto esce dalla cartella sorgente.";

function styleOf(path: string): PathStyle {
  return WINDOWS_ABSOLUTE.test(path) || /^[A-Za-z]:$/.test(path) ? "win" : "posix";
}

function isAbsolute(path: string, style: PathStyle): boolean {
  return style === "win" ? WINDOWS_ABSOLUTE.test(path) : path.startsWith("/");
}

/** Divide prefisso (unità, UNC, "/") e componenti normalizzati; rifiuta ".." oltre la radice. */
function split(path: string, style: PathStyle): { prefix: string; parts: string[] } {
  const separator = style === "win" ? "\\" : "/";
  let rest = style === "win" ? path.replaceAll("/", "\\") : path;
  let prefix = "";
  if (style === "win") {
    const drive = /^[A-Za-z]:/.exec(rest);
    const unc = /^\\\\[^\\]+\\[^\\]+/.exec(rest);
    if (drive) prefix = drive[0].toUpperCase();
    else if (unc) prefix = unc[0];
    rest = rest.slice(prefix.length);
  } else if (rest.startsWith("/")) prefix = "/";
  const parts: string[] = [];
  for (const part of rest.split(separator)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error(OUTSIDE_ERROR);
      parts.pop();
    } else parts.push(part);
  }
  return { prefix, parts };
}

function join({ prefix, parts }: { prefix: string; parts: string[] }, style: PathStyle): string {
  const separator = style === "win" ? "\\" : "/";
  return `${prefix}${style === "win" && parts.length ? separator : ""}${parts.join(separator)}`;
}

export function resolveAlbumAssetPath(sourceRoot: string, assetPath: string): string {
  if (!sourceRoot.trim() || !assetPath.trim()) throw new Error("Radice e percorso foto sono obbligatori.");
  const style = styleOf(sourceRoot.trim());
  const separator = style === "win" ? "\\" : "/";
  const root = split(sourceRoot.trim(), style);
  const raw = assetPath.trim();
  // Un percorso assoluto di stile diverso dalla radice non può appartenerle.
  if (!isAbsolute(raw, style) && (WINDOWS_ABSOLUTE.test(raw) || raw.startsWith("/"))) throw new Error(OUTSIDE_ERROR);
  const candidate = isAbsolute(raw, style) ? split(raw, style) : split(`${join(root, style)}${separator}${raw}`, style);
  const same = (a: string, b: string) => (style === "win" ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!same(candidate.prefix, root.prefix) || root.parts.some((part, index) => !same(candidate.parts[index] ?? "", part))) {
    throw new Error(OUTSIDE_ERROR);
  }
  return join(candidate, style);
}
