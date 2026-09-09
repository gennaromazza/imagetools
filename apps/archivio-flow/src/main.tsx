import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

export function mountApp(onError: (error: unknown) => void): void {
  createRoot(document.getElementById("root")!, {
    onUncaughtError: onError,
  }).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
