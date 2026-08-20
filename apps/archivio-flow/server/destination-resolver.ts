import path from "node:path";

export interface CategoryMapping {
  id: string;
  categoryKey: string;
  displayName: string;
  relativePathPattern: string;
  jobFolderPattern: string;
  enabled: boolean;
}

export interface ResolvedDestination {
  archiveId: string;
  categoryKey: string | null;
  relativeParentPath: string;
  absoluteParentPath: string;
  folderName: string;
  absoluteJobPath: string;
  usedOverride: boolean;
}

function safeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/^\.+|\.+$/g, "").trim();
}

function render(pattern: string, values: Record<string, string>): string {
  return pattern.replace(/\{([a-z-]+)\}/gi, (_all, key: string) => values[key.toLowerCase()] ?? "");
}

function safeRelativePattern(rendered: string): string {
  const segments = rendered.split(/[\\/]+/).map(safeSegment).filter(Boolean);
  if (segments.some((segment) => segment === "..")) throw new Error("Mapping destinazione non valido");
  return segments.join(path.sep);
}

export function resolveDestination(input: {
  archiveId: string;
  archiveRoot: string;
  mappings: CategoryMapping[];
  categoryKey?: string;
  eventDate: string;
  jobName: string;
  overrideParent?: string;
}): ResolvedDestination {
  const archiveRoot = path.resolve(input.archiveRoot);
  const [year = "", month = "", day = ""] = input.eventDate.split("-");
  const values = {
    year, month, day,
    date: input.eventDate,
    "date-dmy": [day, month, year].filter(Boolean).join("-"),
    client: safeSegment(input.jobName),
    job: safeSegment(input.jobName),
  };
  const mapping = input.mappings.find((item) => item.enabled && item.categoryKey === input.categoryKey);
  const usedOverride = Boolean(input.overrideParent?.trim());
  const absoluteParentPath = usedOverride
    ? path.resolve(input.overrideParent!.trim())
    : mapping
      ? path.resolve(archiveRoot, safeRelativePattern(render(mapping.relativePathPattern, values)))
      : archiveRoot;
  const relativeCheck = path.relative(archiveRoot, absoluteParentPath);
  if (!usedOverride && (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck))) {
    throw new Error("Il mapping esce dalla radice archivio");
  }
  const fallbackFolder = `${input.eventDate} - ${values.client} - ${values["date-dmy"]}`;
  const folderName = safeSegment(mapping ? render(mapping.jobFolderPattern || "{date} - {client} - {date-dmy}", values) : fallbackFolder);
  if (!folderName) throw new Error("Nome cartella risolto non valido");
  return {
    archiveId:input.archiveId, categoryKey:mapping?.categoryKey ?? null,
    relativeParentPath:path.relative(archiveRoot, absoluteParentPath), absoluteParentPath,
    folderName, absoluteJobPath:path.join(absoluteParentPath, folderName), usedOverride,
  };
}
