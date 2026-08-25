function normalizeFolderName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      previous[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

export function findSimilarFolderNames(input: string, existingFolders: string[], limit = 3): string[] {
  const candidate = normalizeFolderName(input.split(/[\\/]/).pop() ?? input);
  if (candidate.length < 3) return [];

  return existingFolders
    .map((folder) => {
      const leaf = normalizeFolderName(folder.split(/[\\/]/).pop() ?? folder);
      const distance = levenshtein(candidate, leaf);
      const threshold = Math.max(1, Math.floor(Math.max(candidate.length, leaf.length) * 0.28));
      const similar = candidate === leaf || candidate.includes(leaf) || leaf.includes(candidate) || distance <= threshold;
      return { folder, distance, similar };
    })
    .filter((entry) => entry.similar)
    .sort((left, right) => left.distance - right.distance || left.folder.localeCompare(right.folder, "it"))
    .slice(0, limit)
    .map((entry) => entry.folder);
}
