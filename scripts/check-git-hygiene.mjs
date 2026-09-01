import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function git(args, cwd = repositoryRoot) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitPath(name) {
  const path = git(["rev-parse", "--git-path", name]);
  return resolve(repositoryRoot, path);
}

const status = git(["status", "--porcelain", "--untracked-files=all"]);
if (status) {
  failures.push(`Il checkout principale contiene modifiche:\n${status}`);
}

for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
  if (existsSync(gitPath(marker))) {
    failures.push(`Operazione Git incompleta rilevata: ${marker}`);
  }
}

const worktreeOutput = git(["worktree", "list", "--porcelain"]);
const registeredWorktrees = worktreeOutput
  .split(/\r?\n/)
  .filter((line) => line.startsWith("worktree "))
  .map((line) => resolve(line.slice("worktree ".length)));

for (const worktree of registeredWorktrees) {
  const worktreeStatus = git(["status", "--porcelain", "--untracked-files=all"], worktree);
  if (worktreeStatus) {
    failures.push(`Worktree non pulito: ${worktree}\n${worktreeStatus}`);
  }
}

const localWorktreeRoot = resolve(repositoryRoot, "worktrees");
if (existsSync(localWorktreeRoot)) {
  const registered = new Set(registeredWorktrees.map((path) => path.toLowerCase()));
  for (const entry of readdirSync(localWorktreeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = resolve(localWorktreeRoot, entry.name);
    if (!registered.has(candidate.toLowerCase())) {
      failures.push(`Cartella di lavoro non registrata da Git: ${candidate}`);
    }
  }
}

const branch = git(["branch", "--show-current"]);
if (branch === "main") {
  try {
    const divergence = git(["rev-list", "--left-right", "--count", "origin/main...main"]);
    if (divergence !== "0\t0") {
      failures.push(`main non e' allineato con origin/main: ${divergence}`);
    }
  } catch {
    failures.push("Impossibile verificare l'allineamento tra main e origin/main.");
  }
}

if (failures.length > 0) {
  console.error("Controllo igiene Git non superato:\n");
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Igiene Git verificata: ${registeredWorktrees.length} checkout registrato/i, stato pulito${branch ? `, branch ${branch}` : ""}.`);
