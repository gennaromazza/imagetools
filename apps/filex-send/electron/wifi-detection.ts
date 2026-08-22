import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileSendWifiConfig } from "../src/contracts.js";

const execFileAsync = promisify(execFile);

export interface WifiDetectionResult {
  wifi: FileSendWifiConfig | null;
  error: string | null;
}

export async function detectCurrentWifi(): Promise<WifiDetectionResult> {
  if (process.platform !== "win32") return { wifi: null, error: "Rilevamento automatico disponibile solo su Windows." };
  try {
    const { stdout } = await execFileAsync("netsh.exe", ["wlan", "show", "interfaces"], { encoding: "utf8", windowsHide: true, timeout: 12_000 });
    const ssid = parseConnectedSsid(stdout);
    if (!ssid) return { wifi: null, error: "Il PC non è collegato tramite Wi-Fi. Uso l’ultima rete memorizzata, se disponibile." };
    return { wifi: await readWifiProfile(ssid), error: null };
  } catch (cause) {
    return { wifi: null, error: wifiDetectionError(cause) };
  }
}

export function wifiDetectionError(cause: unknown): string {
  const details = errorMessage(cause).toLowerCase();
  if (details.includes("wireless interface") || details.includes("interfaccia wireless") || details.includes("wlan")) {
    return "Nessuna connessione Wi‑Fi rilevata. Il PC è probabilmente collegato via Ethernet: l’invio locale può funzionare comunque, ma il QR non può includere automaticamente le credenziali Wi‑Fi.";
  }
  return "Non è stato possibile rilevare automaticamente la rete Wi‑Fi. Puoi configurarla manualmente se vuoi includere l’accesso nel QR.";
}

export function parseConnectedSsid(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*SSID\s*:\s*(.+?)\s*$/i);
    if (match?.[1] && !/^BSSID$/i.test(match[1])) return match[1];
  }
  return null;
}

async function readWifiProfile(ssid: string): Promise<FileSendWifiConfig> {
  const exportDir = await mkdtemp(join(tmpdir(), "filex-send-wifi-"));
  try {
    await execFileAsync("netsh.exe", ["wlan", "export", "profile", `name=${ssid}`, "key=clear", `folder=${exportDir}`], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 12_000,
    });
    const xmlFiles = (await readdir(exportDir)).filter((name) => name.toLowerCase().endsWith(".xml"));
    if (xmlFiles.length === 0) throw new Error("profilo Wi-Fi non esportabile");
    for (const fileName of xmlFiles) {
      const xml = await readFile(join(exportDir, fileName), "utf8");
      const profileName = xmlValue(xml, "name");
      if (profileName !== ssid) continue;
      const authentication = xmlValue(xml, "authentication").toLowerCase();
      if (authentication === "open") return { ssid, password: "", security: "nopass" };
      const password = xmlValue(xml, "keyMaterial");
      if (!password) throw new Error("password del profilo non accessibile");
      return { ssid, password, security: "WPA" };
    }
    throw new Error("profilo della rete attiva non trovato");
  } finally {
    await rm(exportDir, { recursive: true, force: true });
  }
}

function xmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function errorMessage(cause: unknown): string {
  if (cause && typeof cause === "object" && "stderr" in cause && typeof cause.stderr === "string" && cause.stderr.trim()) return cause.stderr.trim();
  return cause instanceof Error ? cause.message : String(cause);
}
