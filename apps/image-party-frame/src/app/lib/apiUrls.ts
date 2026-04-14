function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getDefaultApiOrigin(): string {
  if (typeof window === "undefined") {
    return "http://localhost:3001";
  }

  if (window.location.protocol === "file:") {
    return "http://localhost:3001";
  }

  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

const configuredApiOrigin = import.meta.env.VITE_IMAGE_PARTY_FRAME_API_BASE_URL?.trim();

export const API_ORIGIN = trimTrailingSlash(configuredApiOrigin || getDefaultApiOrigin());
export const API_URL = `${API_ORIGIN}/api`;

export function resolveApiAssetUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) {
    return null;
  }

  if (/^https?:\/\//i.test(assetPath)) {
    return assetPath;
  }

  return `${API_ORIGIN}${assetPath.startsWith("/") ? assetPath : `/${assetPath}`}`;
}
