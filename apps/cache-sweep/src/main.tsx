import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if (import.meta.env.DEV && !window.cacheSweep) {
  const { devApi } = await import("./dev-api");
  window.cacheSweep = devApi;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
