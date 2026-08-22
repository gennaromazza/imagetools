import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, "..", "electron", "firebase-config.generated.ts");
const apiKey = process.env.FILEX_SEND_FIREBASE_API_KEY?.trim() ?? "";
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `// Valore sostituito dallo script di build. Non inserire mai una chiave reale nel repository.\nexport const FIREBASE_API_KEY = ${JSON.stringify(apiKey)};\n`, "utf8");
if (!apiKey) console.warn("FILEX_SEND_FIREBASE_API_KEY non configurata: l'autenticazione remota di FileX Send non sarà disponibile.");
