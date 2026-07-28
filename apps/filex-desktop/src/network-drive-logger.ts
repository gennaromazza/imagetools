import type { NetworkDriveLogEntry } from "@photo-tools/desktop-contracts";

export class NetworkDriveLogger {
  private readonly entries: NetworkDriveLogEntry[] = [];

  info(message: string): void {
    this.push("info", message);
  }

  warn(message: string): void {
    this.push("warn", message);
  }

  error(message: string): void {
    this.push("error", message);
  }

  list(): NetworkDriveLogEntry[] {
    return [...this.entries];
  }

  private push(level: NetworkDriveLogEntry["level"], message: string): void {
    this.entries.push({
      timestamp: Date.now(),
      level,
      message,
    });
  }
}
