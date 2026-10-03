/// <reference types="vite/client" />
/** Versione di Album Flow (da package.json), inserita in fase di build. */
declare global { const __APP_VERSION__: string; }
import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";
declare global { interface Window { filexDesktop?: FileXDesktopApi; } }
export {};
