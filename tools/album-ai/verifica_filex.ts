// Apre il file progetto con lo stesso controllo di Album Flow («Apri progetto»), senza modificare nulla.
// Uso dalla radice del repository: npx tsx tools/album-ai/verifica_filex.ts <file.filex-album.json>
import { readFileSync } from "node:fs";
import { parseAlbumProject } from "../../apps/album-flow/src/model/portability";

const file = process.argv[2];
const project = parseAlbumProject(readFileSync(file, "utf8"));
const items = project.spreads.reduce((n, s) => n + s.areas.reduce((m, a) => m + a.items.length, 0), 0);
console.log(`OK: ${project.projectName} — ${project.spreads.length} doppie, ${items} foto impaginate, ${project.assets.length} in libreria`);
