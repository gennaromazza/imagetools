import type { FileXDesktopApi, DesktopRuntimeInfo } from '@photo-tools/desktop-contracts'
import type { ImageIdPrintAiDesktopState } from '../lib/desktop-runtime'

declare global {
  interface Window {
    filexDesktop?: FileXDesktopApi & {
      getRuntimeInfo: () => Promise<DesktopRuntimeInfo>
      getImageIdPrintAiServiceState?: () => Promise<ImageIdPrintAiDesktopState>
      ensureImageIdPrintAiService?: () => Promise<ImageIdPrintAiDesktopState>
    }
  }
}

export {}
