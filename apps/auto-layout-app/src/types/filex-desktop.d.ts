import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";

declare global {
  interface Window {
    filexDesktop?: FileXDesktopApi;
  }
}

export {};