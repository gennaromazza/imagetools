const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");

function enabled(status) {
  return typeof status === "string" && status.startsWith("enabled");
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadURL("data:text/html,<canvas id='gpu-test'></canvas>");
  const gpuInfo = await Promise.race([
    app.getGPUInfo("basic"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("GPU info timeout")), 8_000)),
  ]);
  const features = app.getGPUFeatureStatus();
  const deviceName = gpuInfo.gpuDevice?.find((device) => device.deviceString)?.deviceString
    ?? gpuInfo.auxAttributes?.glRenderer
    ?? null;
  const result = {
    hardwareAccelerationEnabled:
      !app.commandLine.hasSwitch("disable-gpu")
      && (enabled(features.gpu_compositing) || enabled(features.webgl)),
    gpuCompositing: features.gpu_compositing,
    webgl: features.webgl,
    rasterization: features.rasterization,
    videoDecode: features.video_decode,
    deviceName,
  };

  writeFileSync(join(__dirname, ".photo-selector-gpu-result.json"), JSON.stringify(result, null, 2), "utf8");
  window.destroy();
  app.exit(0);
}).catch((error) => {
  writeFileSync(
    join(__dirname, ".photo-selector-gpu-result.json"),
    JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
    "utf8",
  );
  app.exit(1);
});
