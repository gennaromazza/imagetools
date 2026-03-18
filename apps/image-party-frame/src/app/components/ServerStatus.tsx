import { useState, useEffect } from "react";
import { useHealthCheck } from "../hooks/useApi";

export function ServerStatus() {
  const { isOnline, checkHealth } = useHealthCheck();

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return (
    <div className={`text-xs px-3 py-1 rounded ${isOnline ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
      API Server: {isOnline ? "Online" : "Offline"}
    </div>
  );
}
