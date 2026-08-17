export interface ParsedFileNames {
  names: string[];
  ignoredDuplicates: string[];
}

function normalizeBaseName(value: string): string {
  const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, "");
  const parts = trimmed.replace(/[\\/]+/g, "/").split("/");
  return (parts.at(-1) ?? "").trim();
}

export function parseFileNameInput(rawInput: string): ParsedFileNames {
  const tokens = rawInput
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .split(/[\r\n,;\t]+| {2,}/g)
    .map(normalizeBaseName)
    .filter(Boolean);

  const seen = new Set<string>();
  const names: string[] = [];
  const ignoredDuplicates: string[] = [];

  for (const token of tokens) {
    const key = token.toLocaleLowerCase();
    if (seen.has(key)) {
      ignoredDuplicates.push(token);
      continue;
    }
    seen.add(key);
    names.push(token);
  }

  return { names, ignoredDuplicates };
}
