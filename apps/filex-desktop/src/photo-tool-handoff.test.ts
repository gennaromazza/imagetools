import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  DesktopPhotoToolHandoff,
  DesktopPhotoToolHandoffRequest,
  DesktopPhotoToolHandoffTargetToolId,
} from "@photo-tools/desktop-contracts";
import { OpenProjectRequestQueue, PhotoToolHandoffManager } from "./photo-tool-handoff.js";

interface Fixture {
  temporaryRoot: string;
  sourceRoot: string;
  storageRoot: string;
  photos: string[];
}

async function createFixture(t: test.TestContext, photoCount = 2): Promise<Fixture> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "filex-photo-handoff-"));
  const sourceRoot = join(temporaryRoot, "scheda");
  const storageRoot = join(temporaryRoot, "shared", "photo-tool-handoffs");
  await mkdir(sourceRoot, { recursive: true });
  const photos = await Promise.all(Array.from({ length: photoCount }, async (_value, index) => {
    const path = join(sourceRoot, `foto-${index + 1}.jpg`);
    await writeFile(path, Buffer.from(`jpeg-${index + 1}`));
    return path;
  }));
  t.after(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  return { temporaryRoot, sourceRoot, storageRoot, photos };
}

function requestFor(
  fixture: Fixture,
  targetToolId: DesktopPhotoToolHandoffTargetToolId,
  absolutePaths = fixture.photos,
): DesktopPhotoToolHandoffRequest {
  return { targetToolId, sourceRoot: fixture.sourceRoot, absolutePaths };
}

function sender(
  fixture: Fixture,
  launchTool: ConstructorParameters<typeof PhotoToolHandoffManager>[0]["launchTool"],
  options: Partial<ConstructorParameters<typeof PhotoToolHandoffManager>[0]> = {},
): PhotoToolHandoffManager {
  return new PhotoToolHandoffManager({
    storageRoot: fixture.storageRoot,
    currentToolId: "archivio-flow",
    launchTool,
    ...options,
  });
}

type ManagerOptions = ConstructorParameters<typeof PhotoToolHandoffManager>[0];
type LaunchTool = NonNullable<ManagerOptions["launchTool"]>;

function receiver(
  fixture: Fixture,
  currentToolId: DesktopPhotoToolHandoffTargetToolId,
  options: Partial<ManagerOptions> = {},
): PhotoToolHandoffManager {
  return new PhotoToolHandoffManager({
    storageRoot: fixture.storageRoot,
    currentToolId,
    ...options,
  });
}

function extractHandoffPath(args: string[]): string {
  assert.equal(args[0], "--open-project");
  assert.equal(typeof args[1], "string");
  return args[1]!;
}

function acknowledgedLaunch(
  fixture: Fixture,
  hooks: {
    beforeConsume?: (handoffPath: string, target: DesktopPhotoToolHandoffTargetToolId) => Promise<void>;
    afterConsume?: (
      handoffPath: string,
      target: DesktopPhotoToolHandoffTargetToolId,
      manifest: DesktopPhotoToolHandoff,
    ) => Promise<void>;
    receiverOptions?: Partial<ManagerOptions>;
  } = {},
): LaunchTool {
  return async (target, args) => {
    const handoffPath = extractHandoffPath(args);
    await hooks.beforeConsume?.(handoffPath, target);
    const manifest = await receiver(fixture, target, hooks.receiverOptions)
      .consumePhotoSelectionHandoff(handoffPath);
    assert.ok(manifest, "Il target deve consumare il manifest pubblicato.");
    await hooks.afterConsume?.(handoffPath, target, manifest);
    return { ok: true, message: "avviato" };
  };
}

function fakeTimeoutOptions(start = 1_800_000_000_000): {
  options: Partial<ManagerOptions>;
  getNow: () => number;
  advance: (milliseconds: number) => void;
} {
  let currentTime = start;
  return {
    options: {
      now: () => currentTime,
      acknowledgementTimeoutMs: 5,
      acknowledgementPollIntervalMs: 1,
      wait: async (milliseconds) => {
        currentTime += milliseconds;
      },
    },
    getNow: () => currentTime,
    advance: (milliseconds) => {
      currentTime += milliseconds;
    },
  };
}

test("scrive soli riferimenti, avvia il target e attende una ricevuta autenticata", async (t) => {
  const fixture = await createFixture(t);
  const launches: Array<{ target: string; args: string[] }> = [];
  let rawManifest = "";
  let rawAcknowledgement = "";
  const manager = sender(fixture, acknowledgedLaunch(fixture, {
    beforeConsume: async (handoffPath, target) => {
      launches.push({ target, args: ["--open-project", handoffPath] });
      rawManifest = await readFile(handoffPath, "utf8");
    },
    afterConsume: async (_handoffPath, _target, manifest) => {
      rawAcknowledgement = await readFile(
        join(fixture.storageRoot, `photo-tool-handoff-${manifest.handoffId}.ack.json`),
        "utf8",
      );
    },
  }));

  const result = await manager.sendPhotoSelectionToTool(requestFor(fixture, "batch-print-layout"));

  assert.equal(result.ok, true);
  assert.equal(result.fileCount, 2);
  assert.ok(result.handoffPath);
  assert.deepEqual(launches, [{
    target: "batch-print-layout",
    args: ["--open-project", result.handoffPath],
  }]);
  const manifest = JSON.parse(rawManifest) as Record<string, unknown>;
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.sourceRoot, fixture.sourceRoot);
  assert.equal(manifest.targetToolId, "batch-print-layout");
  assert.equal((manifest.files as unknown[]).length, 2);
  assert.match(String(manifest.acknowledgementSecret), /^[0-9a-f]{64}$/);
  assert.equal(rawManifest.includes("data:"), false);
  assert.equal(rawManifest.includes("base64"), false);

  const acknowledgement = JSON.parse(rawAcknowledgement) as Record<string, unknown>;
  assert.equal(acknowledgement.handoffId, manifest.handoffId);
  assert.equal(acknowledgement.targetToolId, "batch-print-layout");
  assert.match(String(acknowledgement.proof), /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(acknowledgement, "acknowledgementSecret"), false);
  assert.deepEqual(await readdir(fixture.storageRoot), []);
});

test("applica le cardinalità: Party e Batch massimo 500, ID Photo esattamente una", async (t) => {
  const fixture = await createFixture(t);
  const manager = sender(fixture, acknowledgedLaunch(fixture));
  const repeated501 = Array.from({ length: 501 }, () => fixture.photos[0]);

  await assert.rejects(
    manager.sendPhotoSelectionToTool(requestFor(fixture, "image-party-frame", repeated501)),
    /da 1 a 500/,
  );
  await assert.rejects(
    manager.sendPhotoSelectionToTool(requestFor(fixture, "batch-print-layout", [])),
    /da 1 a 500/,
  );
  await assert.rejects(
    manager.sendPhotoSelectionToTool(requestFor(fixture, "id-photo", fixture.photos)),
    /esattamente una foto/,
  );

  const accepted = await manager.sendPhotoSelectionToTool(
    requestFor(fixture, "id-photo", [fixture.photos[0]]),
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.fileCount, 1);
});

test("rifiuta file esterni alla radice e duplicati", async (t) => {
  const fixture = await createFixture(t);
  const outside = join(fixture.temporaryRoot, "esterna.jpg");
  await writeFile(outside, "outside");
  const manager = sender(fixture, async () => ({ ok: true, message: "ok" }));

  await assert.rejects(
    manager.sendPhotoSelectionToTool(requestFor(fixture, "batch-print-layout", [outside])),
    /esterna alla radice/,
  );
  await assert.rejects(
    manager.sendPhotoSelectionToTool(requestFor(
      fixture,
      "batch-print-layout",
      [fixture.photos[0], fixture.photos[0]],
    )),
    /due volte la stessa foto/,
  );
});

test("rifiuta percorsi che attraversano symlink o junction", async (t) => {
  const fixture = await createFixture(t, 1);
  const outsideRoot = join(fixture.temporaryRoot, "fuori");
  const linkedRoot = join(fixture.sourceRoot, "collegamento");
  await mkdir(outsideRoot);
  const outsidePhoto = join(outsideRoot, "foto.jpg");
  await writeFile(outsidePhoto, "outside");
  try {
    await symlink(outsideRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("La creazione di symlink non è consentita su questo host.");
      return;
    }
    throw error;
  }

  const manager = sender(fixture, async () => ({ ok: true, message: "ok" }));
  await assert.rejects(
    manager.sendPhotoSelectionToTool(requestFor(
      fixture,
      "batch-print-layout",
      [join(linkedRoot, "foto.jpg")],
    )),
    /collegamenti simbolici/,
  );
});

test("consuma il manifest una sola volta anche con richieste concorrenti", async (t) => {
  const fixture = await createFixture(t);
  let consumed: Array<DesktopPhotoToolHandoff | null> = [];
  const manager = sender(fixture, async (target, args) => {
    const handoffPath = extractHandoffPath(args);
    const consumer = receiver(fixture, target);
    consumed = await Promise.all([
      consumer.consumePhotoSelectionHandoff(handoffPath),
      consumer.consumePhotoSelectionHandoff(handoffPath),
    ]);
    return { ok: true, message: "avviato" };
  });

  const sent = await manager.sendPhotoSelectionToTool(requestFor(fixture, "batch-print-layout"));
  assert.equal(sent.ok, true);
  assert.equal(consumed.filter(Boolean).length, 1);
  assert.equal(consumed.find(Boolean)?.files.length, 2);
  assert.equal(
    await receiver(fixture, "batch-print-layout").consumePhotoSelectionHandoff(sent.handoffPath!),
    null,
  );
});

test("un target diverso non può consumare il passaggio e il mittente non dichiara successo", async (t) => {
  const fixture = await createFixture(t, 1);
  const clock = fakeTimeoutOptions();
  let rejection: unknown;
  const manager = sender(fixture, async (_target, args) => {
    try {
      await receiver(fixture, "batch-print-layout", { now: clock.getNow })
        .consumePhotoSelectionHandoff(extractHandoffPath(args));
    } catch (error) {
      rejection = error;
    }
    return { ok: true, message: "avviato" };
  }, clock.options);

  const result = await manager.sendPhotoSelectionToTool(requestFor(fixture, "id-photo"));
  assert.match(String(rejection), /destinato a un altro tool/);
  assert.equal(result.ok, false);
  assert.match(result.message, /non ha confermato la ricezione/);
  assert.deepEqual(await readdir(fixture.storageRoot), []);
});

test("un handoff scaduto viene eliminato e non produce ricevuta", async (t) => {
  const fixture = await createFixture(t, 1);
  const clock = fakeTimeoutOptions();
  let consumed: DesktopPhotoToolHandoff | null | undefined;
  const manager = sender(fixture, async (target, args) => {
    clock.advance(1_001);
    consumed = await receiver(fixture, target, {
      now: clock.getNow,
      ttlMs: 1_000,
      acknowledgementTimeoutMs: 5,
      acknowledgementPollIntervalMs: 1,
      wait: clock.options.wait,
    }).consumePhotoSelectionHandoff(extractHandoffPath(args));
    return { ok: true, message: "avviato" };
  }, { ...clock.options, ttlMs: 1_000 });

  const result = await manager.sendPhotoSelectionToTool(requestFor(fixture, "id-photo"));
  assert.equal(consumed, null);
  assert.equal(result.ok, false);
  assert.deepEqual(await readdir(fixture.storageRoot), []);
});

test("rifiuta una foto modificata tra invio e consumo", async (t) => {
  const fixture = await createFixture(t, 1);
  const clock = fakeTimeoutOptions();
  let rejection: unknown;
  const manager = sender(fixture, async (target, args) => {
    await writeFile(fixture.photos[0], "contenuto modificato e più lungo");
    try {
      await receiver(fixture, target, { now: clock.getNow })
        .consumePhotoSelectionHandoff(extractHandoffPath(args));
    } catch (error) {
      rejection = error;
    }
    return { ok: true, message: "avviato" };
  }, clock.options);

  const result = await manager.sendPhotoSelectionToTool(requestFor(fixture, "id-photo"));
  assert.match(String(rejection), /cambiate dopo la creazione/);
  assert.equal(result.ok, false);
});

test("rifiuta campi payload estranei al manifest di riferimenti", async (t) => {
  const fixture = await createFixture(t, 1);
  const clock = fakeTimeoutOptions();
  let rejection: unknown;
  const manager = sender(fixture, async (target, args) => {
    const handoffPath = extractHandoffPath(args);
    const manifest = JSON.parse(await readFile(handoffPath, "utf8")) as Record<string, unknown>;
    manifest.inlineImage = "data:image/jpeg;base64,AAAA";
    await writeFile(handoffPath, JSON.stringify(manifest));
    try {
      await receiver(fixture, target, { now: clock.getNow })
        .consumePhotoSelectionHandoff(handoffPath);
    } catch (error) {
      rejection = error;
    }
    return { ok: true, message: "avviato" };
  }, clock.options);

  const result = await manager.sendPhotoSelectionToTool(requestFor(fixture, "id-photo"));
  assert.match(String(rejection), /formato riconosciuto/);
  assert.equal(result.ok, false);
});

test("se il tool non parte elimina il manifest e restituisce un errore gestibile", async (t) => {
  const fixture = await createFixture(t, 1);
  const manager = sender(fixture, async () => ({ ok: false, message: "Tool non installato" }));

  const result = await manager.sendPhotoSelectionToTool(requestFor(fixture, "id-photo"));

  assert.deepEqual(result, {
    ok: false,
    message: "Tool non installato",
    fileCount: 1,
    targetToolId: "id-photo",
  });
  assert.deepEqual(await readdir(fixture.storageRoot), []);
});

test("un target legacy che si limita ad avviarsi fallisce esplicitamente senza ricevuta", async (t) => {
  const fixture = await createFixture(t, 1);
  const clock = fakeTimeoutOptions();
  const manager = sender(
    fixture,
    async () => ({ ok: true, message: "processo avviato" }),
    clock.options,
  );

  const result = await manager.sendPhotoSelectionToTool(requestFor(fixture, "id-photo"));

  assert.equal(result.ok, false);
  assert.match(result.message, /non ha confermato la ricezione/);
  assert.equal(result.handoffPath, undefined);
  assert.deepEqual(await readdir(fixture.storageRoot), []);
});

test("una ricevuta forgiata non autentica il consumo", async (t) => {
  const fixture = await createFixture(t, 1);
  const clock = fakeTimeoutOptions();
  const manager = sender(fixture, async (_target, args) => {
    const handoffPath = extractHandoffPath(args);
    const stored = JSON.parse(await readFile(handoffPath, "utf8")) as {
      handoffId: string;
      targetToolId: DesktopPhotoToolHandoffTargetToolId;
    };
    await writeFile(
      join(fixture.storageRoot, `photo-tool-handoff-${stored.handoffId}.ack.json`),
      JSON.stringify({
        schemaVersion: 1,
        handoffId: stored.handoffId,
        targetToolId: stored.targetToolId,
        consumedAt: new Date(clock.getNow()).toISOString(),
        proof: "0".repeat(64),
      }),
    );
    return { ok: true, message: "avviato" };
  }, clock.options);

  const result = await manager.sendPhotoSelectionToTool(requestFor(fixture, "id-photo"));
  assert.equal(result.ok, false);
  assert.deepEqual(await readdir(fixture.storageRoot), []);
});

test("la coda open-project è FIFO e consumePending non rimuove la testa", () => {
  const queue = new OpenProjectRequestQueue();
  const first = join("C:\\", "handoff", "first.json");
  const second = join("C:\\", "handoff", "second.json");
  const third = join("C:\\", "handoff", "third.json");
  queue.enqueue(first);
  queue.enqueue(second);
  queue.enqueue(third);

  assert.equal(queue.consumePending(), first);
  assert.equal(queue.consumePending(), first);
  assert.equal(queue.peek(), first);
  assert.equal(queue.size, 3);
  assert.equal(queue.acknowledge(second), false);
  assert.equal(queue.size, 3);
  assert.equal(queue.acknowledge(first), true);

  queue.markRendererReady();
  assert.equal(queue.takeForDelivery(), second);
  assert.equal(queue.takeForDelivery(), null);
  assert.equal(queue.acknowledge(second), true);
  assert.equal(queue.takeForDelivery(), third);
  assert.equal(queue.acknowledge(third), true);
  assert.equal(queue.peek(), null);
});

test("reload e chiusura renderer rilasciano l'in-flight senza perdere richieste", () => {
  const queue = new OpenProjectRequestQueue();
  const first = join("C:\\", "handoff", "first.json");
  const second = join("C:\\", "handoff", "second.json");
  queue.enqueue(first);
  queue.enqueue(second);
  queue.markRendererReady();

  assert.equal(queue.takeForDelivery(), first);
  queue.resetRenderer();
  assert.equal(queue.peek(), first);
  assert.equal(queue.size, 2);
  assert.equal(queue.takeForDelivery(), null);

  queue.markRendererReady();
  assert.equal(queue.takeForDelivery(), first);
  assert.equal(queue.acknowledge(first), true);
  assert.equal(queue.takeForDelivery(), second);
});
