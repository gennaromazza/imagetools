import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = join(scriptDir, "..", "src", "google-drive-config.generated.ts");

async function readLocalEnvironment(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return Object.fromEntries(content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/, (_match, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? "");
        return [key, value];
      }));
  } catch {
    return {};
  }
}

const repositoryEnvironment = await readLocalEnvironment(join(scriptDir, "..", "..", "..", ".env.local"));
const shellEnvironment = await readLocalEnvironment(join(scriptDir, "..", ".env.local"));
const localEnvironment = { ...repositoryEnvironment, ...shellEnvironment };
const clientId = process.env.IMAGE_SELECT_GOOGLE_CLIENT_ID?.trim()
  || localEnvironment.IMAGE_SELECT_GOOGLE_CLIENT_ID?.trim()
  || "";
const clientSecret = process.env.IMAGE_SELECT_GOOGLE_CLIENT_SECRET?.trim()
  || localEnvironment.IMAGE_SELECT_GOOGLE_CLIENT_SECRET?.trim()
  || "";

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `// Generated at build time. Do not commit this file.\n` +
    `export const GOOGLE_CLIENT_ID: string = ${JSON.stringify(clientId)};\n` +
    `export const GOOGLE_CLIENT_SECRET: string = ${JSON.stringify(clientSecret)};\n`,
  "utf8",
);

if (process.env.FILEX_RELEASE_CHANNEL && (!clientId || !clientSecret)) {
  throw new Error(
    "Credenziali Google Drive OAuth incomplete: configura IMAGE_SELECT_GOOGLE_CLIENT_ID e IMAGE_SELECT_GOOGLE_CLIENT_SECRET nei secret della release.",
  );
}

console.log(`Google Drive OAuth config generata (${clientId && clientSecret ? "configured" : "not configured"}).`);
