import "react";
import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";

declare module "react" {
  interface InputHTMLAttributes<T> {
    directory?: boolean | string;
    webkitdirectory?: boolean | string;
  }
}

declare global {
  interface Window {
    filexDesktop?: FileXDesktopApi;
  }
}
