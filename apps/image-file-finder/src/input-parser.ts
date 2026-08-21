export interface ParsedFileNames {
  names: string[];
  ignoredDuplicates: string[];
}

function tokenizeInput(rawInput: string): string[] {
  const input = rawInput.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | "`" | null = null;

  const flush = () => {
    if (current.trim()) tokens.push(current);
    current = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (/[\r\n,;\t]/u.test(character)) {
      flush();
      continue;
    }
    if (character === " " && input[index + 1] === " ") {
      flush();
      while (input[index + 1] === " ") index += 1;
      continue;
    }
    current += character;
  }
  flush();
  return tokens;
}

function normalizeBaseName(value: string): string {
  const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, "");
  const parts = trimmed.replace(/[\\/]+/g, "/").split("/");
  return (parts.at(-1) ?? "").trim();
}

export function parseFileNameInput(rawInput: string): ParsedFileNames {
  const tokens = tokenizeInput(rawInput)
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
