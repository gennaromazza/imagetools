import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Server } from "node:http";
import dotenv from "dotenv";
import { createPartyFrameApp } from "./app.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(moduleDir, ".env") });

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid PartyFrame PORT: ${value}`);
  }
  return parsed;
}

function parseConcurrency(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error(`Invalid IMAGE_PARTY_FRAME_MAX_CONCURRENT_JOBS: ${value}`);
  }
  return parsed;
}

const port = parsePort(process.env.PORT);
const dataDir = process.env.IMAGE_PARTY_FRAME_DATA_DIR
  ? path.resolve(process.env.IMAGE_PARTY_FRAME_DATA_DIR)
  : path.resolve(moduleDir, "..");

export const runtime = await createPartyFrameApp({
  dataDir,
  maxConcurrentJobs: parseConcurrency(process.env.IMAGE_PARTY_FRAME_MAX_CONCURRENT_JOBS),
});

async function listen(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const candidate = runtime.app.listen(port, HOST);
    const onError = (error: Error) => {
      candidate.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      candidate.off("error", onError);
      resolve(candidate);
    };
    candidate.once("error", onError);
    candidate.once("listening", onListening);
  });
}

export const server = await listen().catch(async (error: unknown) => {
  await runtime.close();
  throw error;
});

console.log(`Image Party Frame API listening on http://${HOST}:${port}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  await runtime.close();
  await serverClosed;
}

process.once("SIGINT", () => {
  void shutdown().finally(() => { process.exitCode = 0; });
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => { process.exitCode = 0; });
});
