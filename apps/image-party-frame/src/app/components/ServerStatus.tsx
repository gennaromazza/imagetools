import { useEffect } from "react";
import { useHealthCheck } from "../hooks/useApi";

export function ServerStatus() {
  const { status, error, checkHealth } = useHealthCheck();

  useEffect(() => {
    void checkHealth();
    const interval = window.setInterval(() => void checkHealth(), 10_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const isOnline = status === "online";
  const statusLabel = status === "checking"
    ? "verifica..."
    : status === "online"
      ? "pronto"
      : status === "incompatible"
        ? "riavvio necessario"
        : "non disponibile";
  return (
    <div
      role="status"
      title={error ?? undefined}
      className={`text-xs px-3 py-1 rounded ${
        status === "checking"
          ? "bg-[var(--app-field)] text-[var(--app-text-muted)]"
          : isOnline
            ? "bg-green-900/30 text-green-400"
            : "bg-red-900/30 text-red-400"
      }`}
    >
      Motore locale: {statusLabel}
    </div>
  );
}
