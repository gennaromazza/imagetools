import type {
  DesktopSupportEnvironment,
  DesktopSupportMessageInput,
  DesktopSupportMessageKind,
  DesktopSupportMessageResult,
} from "@photo-tools/desktop-contracts";

export interface SupportDependencies {
  appVersion: string;
  platform: string;
  osRelease: string;
  locale: string;
  transportAllowed: () => boolean;
  getIdentity: () => Promise<{ installationId: string; activationToken: string | null }>;
  getLicenseStatus: () => Promise<string>;
  post: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const KINDS: readonly DesktopSupportMessageKind[] = ["problem", "suggestion", "question"];
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;

export class SupportSendError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export function describeSystem(platform: string, release: string): string {
  if (platform === "win32") {
    const build = Number(release.split(".")[2] ?? 0);
    return `Windows ${build >= 22000 ? "11" : "10"} (${release})`;
  }
  if (platform === "darwin") return `macOS (Darwin ${release})`;
  return `${platform} ${release}`;
}

export async function getSupportEnvironment(deps: SupportDependencies): Promise<DesktopSupportEnvironment> {
  return {
    suiteVersion: deps.appVersion,
    system: describeSystem(deps.platform, deps.osRelease),
    licenseStatus: await deps.getLicenseStatus().catch(() => "unavailable"),
  };
}

export async function sendSupportMessage(input: DesktopSupportMessageInput, deps: SupportDependencies): Promise<DesktopSupportMessageResult> {
  if (!KINDS.includes(input?.kind)) throw new SupportSendError("Scegli il tipo di messaggio.", false);
  const email = String(input.email ?? "").trim();
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new SupportSendError("Inserisci un indirizzo email valido per ricevere la risposta.", false);
  const message = String(input.message ?? "").trim();
  if (message.length < MESSAGE_MIN) throw new SupportSendError("Descrivi meglio la richiesta: servono almeno 10 caratteri.", false);
  if (message.length > MESSAGE_MAX) throw new SupportSendError(`Il messaggio e' troppo lungo: massimo ${MESSAGE_MAX} caratteri.`, false);
  if (!deps.transportAllowed()) throw new SupportSendError("In sviluppo l'invio e' disattivato. Usa «Scrivi con la tua email».", false);

  const [identity, environment] = await Promise.all([deps.getIdentity(), getSupportEnvironment(deps)]);
  const body: Record<string, unknown> = {
    kind: input.kind,
    toolId: String(input.toolId ?? "generale"),
    email,
    name: String(input.name ?? "").trim(),
    message,
    installationId: identity.installationId,
  };
  if (identity.activationToken) body.activationToken = identity.activationToken;
  if (input.includeDiagnostics) body.diagnostics = { ...environment, locale: deps.locale };

  let payload: Record<string, unknown>;
  try {
    payload = await deps.post(body);
  } catch (error) {
    const status = (error as { status?: number }).status;
    // Un rifiuto del server (dati o limiti) ha gia' un testo chiaro; un errore di rete va spiegato.
    if (typeof status === "number") throw new SupportSendError(error instanceof Error ? error.message : "Invio non riuscito.", status >= 500);
    throw new SupportSendError("Non riesco a raggiungere il servizio. Controlla la connessione, oppure usa «Scrivi con la tua email».", true);
  }
  const ticketId = typeof payload.ticketId === "string" ? payload.ticketId : "";
  if (!ticketId) throw new SupportSendError("Il servizio non ha confermato la ricezione. Riprova tra poco.", true);
  return { ticketId };
}
