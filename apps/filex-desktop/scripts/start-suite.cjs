// Use the production Suite entry point in development as well.
const { app } = require("electron");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const root = resolve(__dirname, "..");
app.setAppPath(root);
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", () => {
    console.log("[FileX Suite] Finestra pronta.");
  });
});
import(pathToFileURL(resolve(root, ".output/electron/suite-main.js")).href).catch((error) => {
  console.error(error);
  app.exit(1);
});
