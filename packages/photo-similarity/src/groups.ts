import { colorDistance, hashDistance } from "./fingerprint";
import { byCaptureTime } from "./moments";
import type { SimilarGroup, SimilarGroupKind, SimilarityOverrides, SimilarityPhoto } from "./types";

export interface GroupOptions {
  /** Scatti più vicini di così (stessa fotocamera, stesso orientamento) sono una raffica. */
  burstMs: number;
  /** Due foto quasi uguali scattate più lontane di così non si raggruppano (la stessa posa ripresa ore dopo è un'altra foto). */
  windowMs: number;
  /** Senza impronta visiva una raffica non si allunga oltre questo intervallo (evita catene di decine di scatti). */
  maxSpanMs: number;
  /** Entro una raffica le impronte possono differire al massimo di tanti bit (oltre, la fotocamera si è girata). */
  burstHashMax: number;
  /** Fuori dalle raffiche due foto sono «quasi uguali» fino a tanti bit di differenza. */
  nearHashMax: number;
  /** Ogni coppia dentro un gruppo deve restare entro tanti bit (niente catene a-b-c con a e c diverse). */
  linkHashMax: number;
  /** Differenza massima dei colori medi (ΔE) tra foto quasi uguali. */
  colorMax: number;
  maxGroupSize: number;
  /** Senza ora di scatto si confrontano i file con numeri vicini (IMG_0412 e IMG_0413) fino a questa distanza. */
  fileGap: number;
}

export const DEFAULT_GROUP_OPTIONS: GroupOptions = {
  burstMs: 2_000,
  windowMs: 60_000,
  maxSpanMs: 12_000,
  burstHashMax: 24,
  nearHashMax: 12,
  linkHashMax: 20,
  colorMax: 18,
  maxGroupSize: 12,
  fileGap: 2,
};

type Shape = "h" | "v" | "s";
const shapeOf = (aspect: number): Shape => (aspect > 1.05 ? "h" : aspect < 0.95 ? "v" : "s");

/** Prefisso e numero finale del nome file (IMG_0412.jpg → «img_», 412). */
export function fileSequence(fileName: string | undefined): { prefix: string; number: number } | null {
  if (!fileName) return null;
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  const match = /^(.*?)(\d+)(\D*)$/.exec(stem);
  if (!match) return null;
  return { prefix: `${match[1]}|${match[3]}`.toLocaleLowerCase(), number: Number(match[2]) };
}

interface Edge { a: number; b: number; weight: number; kind: Exclude<SimilarGroupKind, "manual"> }

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * Raggruppa le varianti dello stesso scatto: raffiche (dall'ora di scatto) e foto quasi uguali (dall'impronta visiva,
 * solo se scattate a poca distanza). Le correzioni del fotografo vincono sempre: le coppie «non simili» non stanno mai
 * insieme, i gruppi uniti a mano restano uniti. Restituisce solo gruppi di almeno due foto, in ordine di scatto.
 */
export function findSimilarGroups(photos: readonly SimilarityPhoto[], overrides: SimilarityOverrides = {}, options: Partial<GroupOptions> = {}): SimilarGroup[] {
  const settings = { ...DEFAULT_GROUP_OPTIONS, ...options };
  const index = new Map(photos.map((photo, position) => [photo.id, position]));
  const apart = new Set((overrides.apart ?? []).map(([a, b]) => pairKey(a, b)));
  const edges: Edge[] = [];

  const visual = (a: SimilarityPhoto, b: SimilarityPhoto) => {
    if (!a.fingerprint || !b.fingerprint) return null;
    return { hash: hashDistance(a.fingerprint.hash, b.fingerprint.hash), color: colorDistance(a.fingerprint, b.fingerprint) };
  };
  const consider = (a: SimilarityPhoto, b: SimilarityPhoto, dt: number | null) => {
    if (shapeOf(a.aspect) !== shapeOf(b.aspect)) return;
    const look = visual(a, b);
    const sameCamera = !a.cameraModel || !b.cameraModel || a.cameraModel === b.cameraModel;
    const ai = index.get(a.id)!;
    const bi = index.get(b.id)!;
    if (dt !== null && dt <= settings.burstMs && sameCamera && (!look || look.hash <= settings.burstHashMax)) {
      edges.push({ a: ai, b: bi, weight: look ? look.hash : 8 * (dt / settings.burstMs), kind: "burst" });
    } else if (look && look.hash <= settings.nearHashMax && look.color <= settings.colorMax) {
      edges.push({ a: ai, b: bi, weight: look.hash + 0.5, kind: "similar" });
    }
  };

  const timed = byCaptureTime(photos);
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length && timed[j].captureTimeMs - timed[i].captureTimeMs <= settings.windowMs; j += 1) {
      consider(timed[i], timed[j], timed[j].captureTimeMs - timed[i].captureTimeMs);
    }
  }
  // Senza ora di scatto: file con numeri vicini, solo con l'impronta visiva (il numero da solo non basta).
  const untimed = photos
    .map((photo) => ({ photo, sequence: fileSequence(photo.fileName) }))
    .filter((entry) => !(typeof entry.photo.captureTimeMs === "number" && Number.isFinite(entry.photo.captureTimeMs)) && entry.sequence)
    .sort((x, y) => (x.sequence!.prefix < y.sequence!.prefix ? -1 : x.sequence!.prefix > y.sequence!.prefix ? 1 : x.sequence!.number - y.sequence!.number));
  for (let i = 0; i < untimed.length; i += 1) {
    for (let j = i + 1; j < untimed.length && untimed[j].sequence!.prefix === untimed[i].sequence!.prefix && untimed[j].sequence!.number - untimed[i].sequence!.number <= settings.fileGap; j += 1) {
      consider(untimed[i].photo, untimed[j].photo, null);
    }
  }

  // Unione con vincoli: si parte dagli abbinamenti più sicuri.
  const parent = photos.map((_, position) => position);
  const members = photos.map((_, position) => [position]);
  const kinds = photos.map((): SimilarGroupKind | null => null);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const forbidden = (ra: number, rb: number) => members[ra].some((x) => members[rb].some((y) => apart.has(pairKey(photos[x].id, photos[y].id))));
  const join = (ra: number, rb: number, kind: SimilarGroupKind) => {
    parent[rb] = ra;
    members[ra] = members[ra].concat(members[rb]);
    members[rb] = [];
    const before = [kinds[ra], kinds[rb]];
    kinds[ra] = before.includes("manual") || kind === "manual" ? "manual" : before.includes("similar") || kind === "similar" ? "similar" : "burst";
  };

  for (const group of overrides.together ?? []) {
    const positions = group.map((id) => index.get(id)).filter((position): position is number => position !== undefined);
    for (const position of positions.slice(1)) {
      const ra = find(positions[0]);
      const rb = find(position);
      if (ra !== rb) join(ra, rb, "manual");
    }
    if (positions.length > 1) kinds[find(positions[0])] = "manual";
  }

  const timeOf = (position: number) => photos[position].captureTimeMs;
  const compatible = (ra: number, rb: number) => {
    const all = members[ra].concat(members[rb]);
    if (all.length > settings.maxGroupSize) return false;
    for (const x of members[ra]) {
      for (const y of members[rb]) {
        const look = visual(photos[x], photos[y]);
        if (look && look.hash > settings.linkHashMax) return false;
      }
    }
    const times = all.map(timeOf).filter((time): time is number => typeof time === "number" && Number.isFinite(time));
    if (times.length > 1) {
      const span = Math.max(...times) - Math.min(...times);
      const everyLook = all.every((position) => photos[position].fingerprint);
      if (span > (everyLook ? settings.windowMs : settings.maxSpanMs)) return false;
    }
    return true;
  };

  for (const edge of edges.sort((x, y) => x.weight - y.weight || x.a - y.a || x.b - y.b)) {
    const ra = find(edge.a);
    const rb = find(edge.b);
    if (ra === rb || forbidden(ra, rb)) continue;
    // I gruppi uniti a mano accolgono foto simili, ma un gruppo automatico non scavalca i limiti per entrarci.
    if (kinds[ra] !== "manual" && kinds[rb] !== "manual" && !compatible(ra, rb)) continue;
    if ((kinds[ra] === "manual" || kinds[rb] === "manual") && members[ra].length + members[rb].length > settings.maxGroupSize * 2) continue;
    join(ra, rb, edge.kind);
  }

  const order = (position: number) => [timeOf(position) ?? Number.POSITIVE_INFINITY, position] as const;
  const groups: SimilarGroup[] = [];
  photos.forEach((_, position) => {
    if (find(position) !== position || members[position].length < 2) return;
    const sorted = [...members[position]].sort((x, y) => { const [tx, px] = order(x); const [ty, py] = order(y); return tx - ty || px - py; });
    groups.push({ id: `g:${photos[sorted[0]].id}`, photoIds: sorted.map((x) => photos[x].id), kind: kinds[position] ?? "burst" });
  });
  return groups.sort((x, y) => (index.get(x.photoIds[0])! - index.get(y.photoIds[0])!));
}
