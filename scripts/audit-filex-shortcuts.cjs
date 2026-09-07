// Run with Electron. Read-only unless --repair is explicitly supplied.
const { app, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const repair = process.argv.includes("--repair");
const outputArg = process.argv.find(arg => arg.startsWith("--output="));
if (!outputArg) throw new Error("Specify --output=<audit directory>");
const output = path.resolve(outputArg.slice("--output=".length));
app.setPath("userData", path.join(output, "electron-profile"));

app.whenReady().then(async () => {
  if (process.platform !== "win32") throw new Error("Windows required");
  const { desktopToolManifest } = await import(pathToFileURL(path.resolve(__dirname, "../apps/filex-desktop/.output/electron/tool-manifest.js")).href);
  fs.mkdirSync(output, { recursive: true });
  const installRoots = [path.join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  const userPrograms = path.join(app.getPath("appData"), "Microsoft/Windows/Start Menu/Programs");
  const roots = [
    app.getPath("desktop"), path.join(process.env.PUBLIC, "Desktop"), userPrograms,
    path.join(process.env.ProgramData, "Microsoft/Windows/Start Menu/Programs"),
    path.join(app.getPath("appData"), "Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar"),
  ];
  const tools = Object.values(desktopToolManifest).map(tool => {
    const candidates = installRoots.map(root => path.join(root, tool.executableName, tool.executableName + ".exe"));
    const target = candidates.find(file => fs.existsSync(file));
    return { ...tool, target, names: [tool.executableName, ...(tool.legacyExecutableNames || [])].map(name => name.replace(/\.exe$/i, "").toLowerCase()) };
  });
  const reports = [];
  const links = new Set();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.toLowerCase().endsWith(".lnk")) links.add(file);
    }
  }
  roots.forEach(walk);
  const covered = new Set();
  function check(file, tool, previous) {
    const icon = path.join(path.dirname(tool.target), "resources/branding", tool.id + ".ico");
    const expectedId = "studio.filex." + tool.id;
    const expectedCwd = previous?.cwd && fs.existsSync(previous.cwd) ? previous.cwd : path.dirname(tool.target);
    const report = { link: file, toolId: tool.id, previous, target: tool.target, icon, appId: expectedId };
    if (!fs.existsSync(icon)) {
      reports.push({ ...report, status: "missing-icon" });
      return;
    }
    const correct = previous && path.resolve(previous.target).toLowerCase() === tool.target.toLowerCase()
      && previous.icon?.toLowerCase() === icon.toLowerCase() && previous.iconIndex === 0 && previous.appUserModelId === expectedId
      && previous.cwd === expectedCwd;
    if (correct) { reports.push({ ...report, status: "ok" }); return; }
    if (!repair) { reports.push({ ...report, status: previous ? "needs-update" : "missing-shortcut" }); return; }
    try {
      if (previous) {
        const backup = path.join(output, createHash("sha256").update(file).digest("hex").slice(0, 16) + ".lnk");
        fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
        report.backup = backup;
      }
      const details = { target: tool.target, cwd: expectedCwd, icon, iconIndex: 0, appUserModelId: expectedId };
      if (!previous) Object.assign(details, { cwd: path.dirname(tool.target), description: tool.productName });
      if (!shell.writeShortcutLink(file, previous ? "update" : "create", details)) throw new Error("Windows refused shortcut update");
      const verified = shell.readShortcutLink(file);
      if (verified.target.toLowerCase() !== tool.target.toLowerCase() || verified.icon.toLowerCase() !== icon.toLowerCase() || verified.appUserModelId !== expectedId) throw new Error("Read-back verification failed");
      reports.push({ ...report, status: "repaired" });
    } catch (error) { reports.push({ ...report, status: "failed", error: error.message }); }
  }
  for (const file of links) {
    let previous;
    try { previous = shell.readShortcutLink(file); } catch { continue; }
    const tool = tools.find(tool => tool.target && tool.names.includes(path.basename(previous.target, ".exe").toLowerCase()));
    if (!tool) continue;
    if (file.toLowerCase().startsWith(userPrograms.toLowerCase() + path.sep)) covered.add(tool.id);
    check(file, tool, previous);
  }
  for (const tool of tools.filter(tool => tool.target && !covered.has(tool.id))) {
    const file = path.join(userPrograms, tool.productName + ".lnk");
    if (fs.existsSync(file)) { reports.push({ toolId: tool.id, link: file, status: "name-conflict" }); continue; }
    check(file, tool, null);
  }
  const result = {
    mode: repair ? "repair" : "audit",
    installed: tools.filter(tool => tool.target).map(tool => tool.id),
    notInstalled: tools.filter(tool => !tool.target).map(tool => tool.id),
    shortcuts: reports,
  };
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  app.exit(reports.some(item => ["failed", "missing-icon", "name-conflict"].includes(item.status)) ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
