import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = join(scriptDir, "..", "src", "google-drive-config.generated.ts");
const clientId = process.env.IMAGE_SELECT_GOOGLE_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.IMAGE_SELECT_GOOGLE_CLIENT_SECRET?.trim() ?? "";

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `// Generated at build time. Do not commit this file.\n` +
    `export const GOOGLE_CLIENT_ID = ${JSON.stringify(clientId)};\n` +
    `export const GOOGLE_CLIENT_SECRET = ${JSON.stringify(clientSecret)};\n`,
  "utf8",
);

if (process.env.FILEX_RELEASE_CHANNEL && (!clientId || !clientSecret)) {
  throw new Error(
    "Google Drive OAuth credentials mancanti: configura IMAGE_SELECT_GOOGLE_CLIENT_ID e IMAGE_SELECT_GOOGLE_CLIENT_SECRET nei secret della release.",
  );
}

console.log(`Google Drive OAuth config generata (${clientId ? "configured" : "not configured"}).`);
