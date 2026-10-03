import type { NextFunction, Request, Response } from "express";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostWithoutPort(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  return trimmed.split(":")[0] ?? "";
}

/** Blocca il DNS rebinding: l'header Host deve indicare un indirizzo locale. */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  return typeof hostHeader === "string" && LOOPBACK_HOSTS.has(hostWithoutPort(hostHeader));
}

/** Nessun Origin = chiamata non-browser; altrimenti ammesse solo le pagine servite da localhost. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function createLocalOnlyGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (!isLoopbackHost(req.headers.host) || !isAllowedOrigin(origin)) {
      res.status(403).json({ error: "Richiesta non consentita" });
      return;
    }
    next();
  };
}

export const corsOptions = {
  origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) =>
    callback(null, isAllowedOrigin(origin)),
};
