import { spawn } from "node:child_process";

type InstallerChild = {
  once(event: "error", listener: (error: Error) => void): InstallerChild;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): InstallerChild;
};

export type SpawnInstaller = (
  executablePath: string,
  args: readonly string[],
) => InstallerChild;

const spawnInstaller: SpawnInstaller = (executablePath, args) => spawn(
  executablePath,
  [...args],
  {
    windowsHide: false,
    stdio: "ignore",
  },
);

export class InstallerLaunchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InstallerLaunchError";
  }
}

export class InstallerExitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallerExitError";
  }
}

/**
 * Esegue l'installer NSIS in modo silenzioso e termina soltanto quando il
 * processo ha concluso realmente. A differenza di shell.openPath, un esito
 * positivo non puo' rappresentare un avvio accettato da Windows ma mai partito.
 */
export function runWindowsInstaller(
  installerPath: string,
  spawnProcess: SpawnInstaller = spawnInstaller,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    let child: InstallerChild;
    try {
      child = spawnProcess(installerPath, ["/S"]);
    } catch (error) {
      reject(new InstallerLaunchError("Windows non ha avviato l'installer FileX.", { cause: error }));
      return;
    }

    child.once("error", (error) => finish(() => reject(
      new InstallerLaunchError(`Windows non ha avviato l'installer FileX: ${error.message}`, { cause: error }),
    )));
    child.once("close", (code, signal) => finish(() => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ? `segnale ${signal}` : `codice ${code ?? "sconosciuto"}`;
      reject(new InstallerExitError(`Installer FileX terminato con ${detail}.`));
    }));
  });
}
