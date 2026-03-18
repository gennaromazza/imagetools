import "react";

declare module "react" {
  interface InputHTMLAttributes<T> {
    directory?: boolean | string;
    webkitdirectory?: boolean | string;
  }
}
