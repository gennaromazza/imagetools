import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const execFileRaw = promisify(execFile);

/**
 * Opzioni di esecuzione sempre senza finestra: su Windows, un programma a riga di comando (gh, git, powershell,
 * taskkill) lanciato da un processo senza console apre una finestra di terminale a ogni chiamata. La Dev Console
 * li chiama di continuo per aggiornare lo stato, e senza questa opzione si riempie lo schermo di terminali.
 */
export function withHiddenWindow(options?: ExecFileOptions): ExecFileOptions & { windowsHide: true; encoding: BufferEncoding } {
  return { encoding: "utf8", ...options, windowsHide: true } as ExecFileOptions & { windowsHide: true; encoding: BufferEncoding };
}

export function execFileHidden(file: string, args: readonly string[], options?: ExecFileOptions): Promise<{ stdout: string; stderr: string }> {
  return execFileRaw(file, [...args], withHiddenWindow(options)) as unknown as Promise<{ stdout: string; stderr: string }>;
}
