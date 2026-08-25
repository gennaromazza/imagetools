import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const COOPERATIVE_SIGNAL_TIMEOUT_MS = 2_000;

type SignalExecutor = (
  executablePath: string,
  args: readonly string[],
  options: {
    windowsHide: boolean;
    timeout: number;
    killSignal: NodeJS.Signals;
  },
) => Promise<unknown>;

const executeSignal: SignalExecutor = (executablePath, args, options) =>
  execFileAsync(executablePath, [...args], options);

/**
 * Invia un comando ad una istanza Electron gia' aperta senza permettere che
 * una versione legacy trattenga per sempre il processo secondario.
 */
export async function sendBoundedProcessSignal(
  executablePath: string,
  args: readonly string[],
  executor: SignalExecutor = executeSignal,
): Promise<void> {
  await executor(executablePath, args, {
    windowsHide: true,
    timeout: COOPERATIVE_SIGNAL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
}
