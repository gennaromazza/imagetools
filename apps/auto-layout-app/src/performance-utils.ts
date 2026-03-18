export async function measureAsync<T>(label: string, run: () => Promise<T>): Promise<T> {
  if (typeof performance === "undefined") {
    return run();
  }

  const startMark = `${label}:start`;
  const endMark = `${label}:end`;

  performance.mark(startMark);

  try {
    return await run();
  } finally {
    performance.mark(endMark);
    performance.measure(label, startMark, endMark);
  }
}
