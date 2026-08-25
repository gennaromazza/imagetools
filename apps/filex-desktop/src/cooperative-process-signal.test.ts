import assert from "node:assert/strict";
import test from "node:test";
import {
  COOPERATIVE_SIGNAL_TIMEOUT_MS,
  sendBoundedProcessSignal,
} from "./cooperative-process-signal.js";

test("limita sempre la durata del segnale cooperativo legacy", async () => {
  let captured: unknown;
  await sendBoundedProcessSignal(
    "C:\\Programs\\FileX-Tool.exe",
    ["--filex-update-shutdown"],
    async (path, args, options) => {
      captured = { path, args, options };
    },
  );

  assert.deepEqual(captured, {
    path: "C:\\Programs\\FileX-Tool.exe",
    args: ["--filex-update-shutdown"],
    options: {
      windowsHide: true,
      timeout: COOPERATIVE_SIGNAL_TIMEOUT_MS,
      killSignal: "SIGKILL",
    },
  });
});

test("propaga il fallimento del segnale per attivare il fallback", async () => {
  await assert.rejects(
    sendBoundedProcessSignal("legacy.exe", [], async () => {
      throw new Error("ETIMEDOUT");
    }),
    /ETIMEDOUT/,
  );
});
