import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  InstallerExitError,
  InstallerLaunchError,
  runWindowsInstaller,
  type SpawnInstaller,
} from "./windows-installer-runner.js";

class FakeChild extends EventEmitter {}

test("attende la conclusione reale dell'installer NSIS avviato con /S", async () => {
  const child = new FakeChild();
  let capturedPath = "";
  let capturedArgs: readonly string[] = [];
  let completed = false;
  const spawn: SpawnInstaller = (path, args) => {
    capturedPath = path;
    capturedArgs = args;
    return child;
  };

  const installation = runWindowsInstaller("C:\\updates\\tool-setup.exe", spawn)
    .then(() => { completed = true; });
  await Promise.resolve();

  assert.equal(capturedPath, "C:\\updates\\tool-setup.exe");
  assert.deepEqual(capturedArgs, ["/S"]);
  assert.equal(completed, false);

  child.emit("close", 0, null);
  await installation;
  assert.equal(completed, true);
});

test("propaga errori di avvio ed exit code non riusciti", async () => {
  const spawnErrorChild = new FakeChild();
  const spawnError = runWindowsInstaller("missing.exe", () => spawnErrorChild);
  spawnErrorChild.emit("error", new Error("ENOENT"));
  await assert.rejects(spawnError, InstallerLaunchError);

  const failedChild = new FakeChild();
  const failedInstall = runWindowsInstaller("failed.exe", () => failedChild);
  failedChild.emit("close", 2, null);
  await assert.rejects(failedInstall, InstallerExitError);
});
