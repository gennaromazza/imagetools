import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const sourceDir = join(repoRoot, "ICONE E LOGHI");
const targetDir = join(desktopRoot, "build", "branding");

const toolBranding = [
  { toolId: "suite-launcher", sourceFile: "LOGO_Image_tool.png" },
  { toolId: "auto-layout-app", sourceFile: "auto_layout_logo.png" },
  { toolId: "image-party-frame", sourceFile: "party_frame_logo.png" },
  { toolId: "image-id-print", sourceFile: "id_print_logo.png" },
  { toolId: "archivio-flow", sourceFile: "photo_Archivie.png" },
  { toolId: "photo-selector-app", sourceFile: "photo_selector_icon.png" },
];

await mkdir(targetDir, { recursive: true });

for (const tool of toolBranding) {
  const sourcePath = join(sourceDir, tool.sourceFile);
  const pngTargetPath = join(targetDir, `${tool.toolId}.png`);
  const icoTargetPath = join(targetDir, `${tool.toolId}.ico`);
  const icnsTargetPath = join(targetDir, `${tool.toolId}.icns`);

  await copyFile(sourcePath, pngTargetPath);
  await generateIco(sourcePath, icoTargetPath);
  await maybeGenerateIcns(sourcePath, icnsTargetPath);
}

async function generateIco(sourcePath, icoTargetPath) {
  if (process.platform === "win32") {
    await generateWindowsIco(sourcePath, icoTargetPath);
    return;
  }

  const pngBuffer = await readFile(sourcePath);
  const icoBuffer = wrapPngAsIco(pngBuffer);
  await writeFile(icoTargetPath, icoBuffer);
}

function wrapPngAsIco(pngBuffer) {
  const { width, height } = readPngSize(pngBuffer);

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

function readPngSize(pngBuffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (pngBuffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("Brand asset is not a valid PNG");
  }

  return {
    width: pngBuffer.readUInt32BE(16),
    height: pngBuffer.readUInt32BE(20),
  };
}

async function generateWindowsIco(sourcePath, icoTargetPath) {
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeIcon {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool DestroyIcon(IntPtr hIcon);
}
"@
$source = ${toPowerShellString(sourcePath)}
$target = ${toPowerShellString(icoTargetPath)}
$bitmap = [System.Drawing.Bitmap]::FromFile($source)
$resized = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($resized)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$scale = [Math]::Min(256 / $bitmap.Width, 256 / $bitmap.Height)
$drawWidth = [int][Math]::Round($bitmap.Width * $scale)
$drawHeight = [int][Math]::Round($bitmap.Height * $scale)
$offsetX = [int][Math]::Floor((256 - $drawWidth) / 2)
$offsetY = [int][Math]::Floor((256 - $drawHeight) / 2)
$graphics.DrawImage($bitmap, $offsetX, $offsetY, $drawWidth, $drawHeight)
$icon = [System.Drawing.Icon]::FromHandle($resized.GetHicon())
$fileStream = [System.IO.File]::Create($target)
$icon.Save($fileStream)
$fileStream.Close()
[NativeIcon]::DestroyIcon($icon.Handle) | Out-Null
$icon.Dispose()
$graphics.Dispose()
$resized.Dispose()
$bitmap.Dispose()
`;

  await runCommand("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
}

function toPowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function maybeGenerateIcns(sourcePath, icnsTargetPath) {
  if (process.platform !== "darwin") {
    return;
  }

  const iconsetDir = join(targetDir, `${icnsTargetPath.split(/[/\\]/).pop()?.replace(/\.icns$/, "")}.iconset`);
  await rm(iconsetDir, { recursive: true, force: true });
  await mkdir(iconsetDir, { recursive: true });

  const iconSizes = [
    16,
    32,
    128,
    256,
    512,
  ];

  for (const size of iconSizes) {
    const singleName = `icon_${size}x${size}.png`;
    const retinaName = `icon_${size}x${size}@2x.png`;
    await runCommand("sips", ["-z", String(size), String(size), sourcePath, "--out", join(iconsetDir, singleName)]);
    await runCommand("sips", ["-z", String(size * 2), String(size * 2), sourcePath, "--out", join(iconsetDir, retinaName)]);
  }

  await runCommand("iconutil", ["-c", "icns", iconsetDir, "-o", icnsTargetPath]);
  await rm(iconsetDir, { recursive: true, force: true });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}
