const { app } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const profile = process.argv[2];
app.setPath("appData", profile);
app.setPath("userData", join(profile, "suite"));
app.setAppPath(resolve(__dirname, "../apps/filex-desktop"));
process.argv.push("--filex-background");
const directory = join(profile, "FileX", "notifications-dev");
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "1770000000000-aaaa.json"), JSON.stringify({
  id:"arrival", toolId:"filex-send", title:"FileX Send", message:"3 file ricevuti · Prova", createdAt:1770000000000,
}));
writeFileSync(join(directory, "1770000000001-bbbb.json"), "{incomplete");
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    try {
      const notifications = await window.webContents.executeJavaScript("window.filexDesktop.getSuiteNotifications()");
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].id, "arrival");
      assert.match(notifications[0].message, /3 file ricevuti/);
      console.log("PASS: inbox FileX Send letta dal vero IPC Suite, evento corrotto ignorato");
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
import(pathToFileURL(resolve(__dirname, "../apps/filex-desktop/.output/electron/suite-main.js")).href)
  .catch(error => { console.error(error); app.exit(1); });
