function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getDefaultApiOrigin(): string {
  return "http://127.0.0.1:3001";
}

const configuredApiOrigin = import.meta.env.VITE_IMAGE_PARTY_FRAME_API_BASE_URL?.trim();
const configuredSessionToken = import.meta.env.VITE_IMAGE_PARTY_FRAME_SESSION_TOKEN?.trim();

export const API_ORIGIN = trimTrailingSlash(configuredApiOrigin || getDefaultApiOrigin());
export const API_URL = `${API_ORIGIN}/api`;

let desktopSessionTokenPromise: Promise<string | null> | null = null;

export async function getPartyFrameApiHeaders(
  headers: HeadersInit = {}
): Promise<Headers> {
  const result = new Headers(headers);
  let token = configuredSessionToken || null;

  if (!token && window.filexDesktop?.getPartyFrameSessionToken) {
    desktopSessionTokenPromise ??= window.filexDesktop.getPartyFrameSessionToken().catch(() => null);
    token = await desktopSessionTokenPromise;
  }

  if (token) {
    result.set("X-PartyFrame-Token", token);
  }
  return result;
}

export function resolveApiAssetUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) {
    return null;
  }

  if (/^https?:\/\//i.test(assetPath)) {
    return assetPath;
  }

  return `${API_ORIGIN}${assetPath.startsWith("/") ? assetPath : `/${assetPath}`}`;
}
