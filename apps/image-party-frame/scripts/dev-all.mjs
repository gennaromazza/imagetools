import { randomBytes } from "node:crypto";
import net from "node:net";
import concurrently from "concurrently";

const HOST = "127.0.0.1";
const WEB_PORT = 4170;
const DEFAULT_API_PORT = 3001;

function parsePort(value) {
  if (!value) return DEFAULT_API_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Porta API PartyFrame non valida: ${value}`);
  }
  return port;
}

export function isPortOccupied(port, host = HOST) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (occupied) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function assertDevPortsAvailable(apiPort = parsePort(process.env.PORT)) {
  const ports = [...new Set([WEB_PORT, apiPort])];
  const occupied = (await Promise.all(ports.map(async (port) => ({
    port,
    occupied: await isPortOccupied(port),
  })))).filter((entry) => entry.occupied);

  if (occupied.length > 0) {
    const labels = occupied.map(({ port }) => port === WEB_PORT ? `interfaccia (${port})` : `motore (${port})`);
    throw new Error(
      `PartyFrame non può avviarsi: ${labels.join(" e ")} già in uso. `
      + "Chiudi le precedenti sessioni PartyFrame e riavvia il comando di sviluppo.",
    );
  }
}

async function main() {
  const apiPort = parsePort(process.env.PORT);
  await assertDevPortsAvailable(apiPort);

  const sessionToken = randomBytes(32).toString("hex");
  const commonEnv = { ...process.env };
  const { result } = concurrently([
    {
      command: "npm run dev",
      name: "interfaccia",
      env: {
        ...commonEnv,
        VITE_IMAGE_PARTY_FRAME_API_BASE_URL: `http://${HOST}:${apiPort}`,
        VITE_IMAGE_PARTY_FRAME_SESSION_TOKEN: sessionToken,
      },
    },
    {
      command: "npm run dev:server",
      name: "motore",
      env: {
        ...commonEnv,
        IMAGE_PARTY_FRAME_SESSION_TOKEN: sessionToken,
        PORT: String(apiPort),
      },
    },
  ], {
    killOthers: ["failure", "success"],
    prefix: "name",
  });

  await result;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
