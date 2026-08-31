import assert from "node:assert/strict";
import test from "node:test";
import {
  createIdPhotoQuitCoordinator,
  createIdPhotoUnloadGuard,
  type IdPhotoUnloadDecision,
} from "./id-photo-unload-guard.js";

function deferredDecision(): {
  promise: Promise<IdPhotoUnloadDecision>;
  resolve: (decision: IdPhotoUnloadDecision) => void;
} {
  let resolve!: (decision: IdPhotoUnloadDecision) => void;
  const promise = new Promise<IdPhotoUnloadDecision>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("resta nella finestra quando l'utente vuole salvare le modifiche", async () => {
  const guard = createIdPhotoUnloadGuard();
  let closeCount = 0;

  guard.handlePreventedUnload({
    requestDecision: async () => "stay",
    closeAnyway: () => { closeCount += 1; },
  });
  await flushPromises();

  assert.equal(closeCount, 0);
  assert.equal(guard.isConfirmationPending(), false);
});

test("chiude soltanto dopo una conferma esplicita di perdita delle modifiche", async () => {
  const guard = createIdPhotoUnloadGuard();
  let closeCount = 0;

  guard.handlePreventedUnload({
    requestDecision: async () => "close-anyway",
    closeAnyway: () => { closeCount += 1; },
  });
  await flushPromises();

  assert.equal(closeCount, 1);
  assert.equal(guard.isConfirmationPending(), false);
});

test("mantiene un solo dialogo attivo e consente un nuovo tentativo dopo la scelta", async () => {
  const guard = createIdPhotoUnloadGuard();
  const firstDecision = deferredDecision();
  let requestCount = 0;

  const firstRequest = {
    requestDecision: () => {
      requestCount += 1;
      return firstDecision.promise;
    },
    closeAnyway: () => undefined,
  };
  guard.handlePreventedUnload(firstRequest);
  guard.handlePreventedUnload(firstRequest);

  assert.equal(requestCount, 1);
  assert.equal(guard.isConfirmationPending(), true);

  firstDecision.resolve("stay");
  await flushPromises();
  guard.handlePreventedUnload({
    requestDecision: async () => {
      requestCount += 1;
      return "stay";
    },
    closeAnyway: () => undefined,
  });
  await flushPromises();

  assert.equal(requestCount, 2);
  assert.equal(guard.isConfirmationPending(), false);
});

test("un errore del dialogo mantiene la finestra aperta e libera il guard", async () => {
  const guard = createIdPhotoUnloadGuard();
  const dialogError = new Error("dialog unavailable");
  let reportedError: unknown;
  let closeCount = 0;

  guard.handlePreventedUnload({
    requestDecision: async () => { throw dialogError; },
    closeAnyway: () => { closeCount += 1; },
    onError: (error) => { reportedError = error; },
  });
  await flushPromises();

  assert.equal(closeCount, 0);
  assert.equal(reportedError, dialogError);
  assert.equal(guard.isConfirmationPending(), false);
});

test("quit con unload annullato resta aperto senza autorizzare lo shutdown nativo", async () => {
  const quit = createIdPhotoQuitCoordinator();
  const unload = createIdPhotoUnloadGuard();
  let closeWindowRequests = 0;
  let nativeShutdowns = 0;

  const beforeQuitAction = quit.handleBeforeQuit(true);
  if (beforeQuitAction === "close-window-first") closeWindowRequests += 1;
  else nativeShutdowns += 1;
  unload.handlePreventedUnload({
    requestDecision: async () => {
      quit.cancelPendingQuit();
      return "stay";
    },
    closeAnyway: () => undefined,
  });
  await flushPromises();

  assert.equal(closeWindowRequests, 1);
  assert.equal(nativeShutdowns, 0);
  assert.equal(quit.hasPendingQuit(), false);
  assert.equal(quit.consumePendingQuitAfterWindowClosed(), false);
});

test("errore del dialogo o del close annulla una richiesta quit latente", async () => {
  for (const failureMode of ["dialog", "close"] as const) {
    const quit = createIdPhotoQuitCoordinator();
    const unload = createIdPhotoUnloadGuard();
    assert.equal(quit.handleBeforeQuit(true), "close-window-first", failureMode);

    if (failureMode === "dialog") {
      unload.handlePreventedUnload({
        requestDecision: async () => { throw new Error("dialog unavailable"); },
        closeAnyway: () => undefined,
        onError: () => { quit.cancelPendingQuit(); },
      });
      await flushPromises();
    } else {
      quit.cancelPendingQuit();
    }

    assert.equal(quit.hasPendingQuit(), false, failureMode);
    assert.equal(quit.consumePendingQuitAfterWindowClosed(), false, failureMode);
  }
});

test("quit avvia lo shutdown solo dopo la chiusura autorizzata della finestra", () => {
  for (const closeMode of ["saved", "close-anyway"] as const) {
    const quit = createIdPhotoQuitCoordinator();
    let nativeShutdowns = 0;

    assert.equal(quit.handleBeforeQuit(true), "close-window-first", closeMode);
    assert.equal(quit.consumePendingQuitAfterWindowClosed(), true, closeMode);
    if (quit.handleBeforeQuit(false) === "start-native-shutdown") nativeShutdowns += 1;

    assert.equal(nativeShutdowns, 1, closeMode);
    assert.equal(quit.hasPendingQuit(), false, closeMode);
  }
});
