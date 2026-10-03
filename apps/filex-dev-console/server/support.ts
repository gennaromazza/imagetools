import type { Express, NextFunction, Request, Response } from "express";
import { execFileHidden } from "./hidden-exec.js";
import { ROOT } from "./processes.js";

const NODE = process.execPath;
const TICKET_ID = /^SUP-[A-Z0-9]{8}$/;
const FILTERS = ["all", "new", "read", "resolved"];
const STATUSES = ["new", "read", "resolved"];
const NOT_LOGGED_IN_HINT = "Verifica di essere autenticati con `firebase login`.";

async function runSupportAdmin(args: string[]): Promise<string> {
  const { stdout } = await execFileHidden(NODE, ["scripts/filex-support-admin.mjs", ...args], {
    cwd: ROOT,
    timeout: 60_000,
    maxBuffer: 5_000_000,
  });
  return stdout;
}

function failure(error: unknown) {
  return { ok: false, error: String((error as { message?: string })?.message ?? error), hint: NOT_LOGGED_IN_HINT };
}

/**
 * La console accetta richieste da ogni origine (cors aperto), ma qui passano email di clienti: rispondiamo solo alla
 * pagina della console stessa. Origin vieta le altre pagine del browser, Host vieta il DNS rebinding.
 */
export function isConsoleRequest(origin: string | undefined, host: string | undefined, port: number): boolean {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!host || !allowedHosts.includes(host)) return false;
  return origin === undefined || allowedHosts.some((allowed) => origin === `http://${allowed}`);
}

// Lettura dei messaggi degli utenti: le azioni sono fisse e gli argomenti validati, nessun comando arriva dal browser.
export function registerSupportRoutes(app: Express, port: number): void {
  app.use("/api/support", (req: Request, res: Response, next: NextFunction) => {
    if (isConsoleRequest(req.get("origin"), req.get("host"), port)) { next(); return; }
    res.status(403).json({ error: "Accesso consentito solo dalla pagina della console." });
  });

  app.get("/api/support/messages", async (req, res) => {
    const filter = String(req.query.status ?? "all");
    if (!FILTERS.includes(filter)) {
      res.status(400).json({ error: "Filtro non valido." });
      return;
    }
    try {
      res.json({ ok: true, ...JSON.parse(await runSupportAdmin(["list", filter])) });
    } catch (error) {
      res.status(500).json(failure(error));
    }
  });

  app.get("/api/support/messages/:id/export", async (req, res) => {
    if (!TICKET_ID.test(req.params.id)) {
      res.status(400).json({ error: "Numero richiesta non valido." });
      return;
    }
    try {
      res.json({ ok: true, markdown: (await runSupportAdmin(["export", req.params.id])).trim() });
    } catch (error) {
      res.status(500).json(failure(error));
    }
  });

  app.post("/api/support/messages/:id/status", async (req, res) => {
    const status = String(req.body?.status ?? "");
    if (!TICKET_ID.test(req.params.id) || !STATUSES.includes(status)) {
      res.status(400).json({ error: "Richiesta non valida." });
      return;
    }
    try {
      res.json({ ok: true, ...JSON.parse(await runSupportAdmin(["mark", req.params.id, status])) });
    } catch (error) {
      res.status(500).json(failure(error));
    }
  });
}
