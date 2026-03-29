export type ImageIdPrintAiDesktopStatus =
  | 'disabled'
  | 'starting'
  | 'ready'
  | 'error'
  | 'stopped'

export interface DesktopRuntimeInfoLike {
  shell: 'electron'
  platform: string
  isPackaged: boolean
  appVersion: string
  toolId: string
  toolName: string
}

export interface ImageIdPrintAiDesktopState {
  enabled: boolean
  managedByDesktopShell: boolean
  status: ImageIdPrintAiDesktopStatus
  url: string
  detail: string
  lastError: string | null
  pid: number | null
}

const DEFAULT_BASE_URL = (
  (import.meta as unknown as { env?: { VITE_REMBG_ENDPOINT?: string } }).env?.VITE_REMBG_ENDPOINT
  ?? 'http://localhost:7010/remove-background'
).replace(/\/remove-background$/, '')

export function hasDesktopBridge(): boolean {
  return typeof window !== 'undefined' && !!window.filexDesktop
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfoLike | null> {
  const api = window.filexDesktop
  if (!api) return null
  try {
    return await api.getRuntimeInfo()
  } catch {
    return null
  }
}

export async function getImageIdPrintAiDesktopState(): Promise<ImageIdPrintAiDesktopState | null> {
  const api = window.filexDesktop
  if (!api?.getImageIdPrintAiServiceState) return null
  try {
    return await api.getImageIdPrintAiServiceState()
  } catch {
    return null
  }
}

export async function ensureImageIdPrintAiDesktopState(): Promise<ImageIdPrintAiDesktopState | null> {
  const api = window.filexDesktop
  if (!api?.ensureImageIdPrintAiService) return null
  try {
    return await api.ensureImageIdPrintAiService()
  } catch {
    return null
  }
}

export function getRembgBaseUrl(): string {
  return DEFAULT_BASE_URL
}

export function getRembgEndpoint(path: '/health' | '/remove-background' | '/detect-face'): string {
  return `${getRembgBaseUrl()}${path}`
}

export function getAiUnavailableMessage(isDesktopMode: boolean): string {
  return isDesktopMode
    ? 'Motore AI desktop non disponibile. Verifica che il pacchetto includa il runtime locale e riavvia l’app.'
    : 'Motore AI locale non disponibile. Avvia il sidecar AI oppure configura VITE_REMBG_ENDPOINT.'
}
