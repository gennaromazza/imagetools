import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const sourceDir = join(repoRoot, "ICONE E LOGHI");
const targetDir = join(desktopRoot, ".output", "branding");
const websiteIconsDir = join(repoRoot, "website", "assets", "icons");
const generatedBrandingDir = join(desktopRoot, "branding-sources");
const photoSelectorAssetsDir = join(repoRoot, "apps", "photo-selector-app", "src", "assets");
const filexSendAssetsDir = join(repoRoot, "apps", "filex-send", "public");
const filexSendWebAssetsDir = join(repoRoot, "apps", "filex-send-web", "public");
const photoSelectorLogoPath = join(sourceDir, "photo_selector.png");
const photoSelectorIconPath = join(sourceDir, "photo_selector_icon.png");
const generatedBrandingSource = (fileName) => join(generatedBrandingDir, fileName);

const toolBranding = [
  { toolId: "suite-launcher", sourceFile: "filex-system/suite-launcher.png" },
  {
    toolId: "image-party-frame",
    sourceFile: "filex-generated/image-party-frame.png",
    pngSourcePath: generatedBrandingSource("image-party-frame.png"),
  },
  {
    toolId: "batch-print-layout",
    sourceFile: "filex-generated/batch-print-layout.png",
    pngSourcePath: generatedBrandingSource("batch-print-layout.png"),
  },
  { toolId: "id-photo", sourceFile: "filex-generated/id-photo.svg" },
  {
    toolId: "archivio-flow",
    sourceFile: "filex-generated/archivio-flow.png",
    pngSourcePath: generatedBrandingSource("archivio-flow.png"),
  },
  {
    toolId: "image-converter",
    sourceFile: "filex-generated/image-converter.png",
    pngSourcePath: generatedBrandingSource("image-converter.png"),
  },
  {
    toolId: "image-file-finder",
    sourceFile: "filex-generated/image-file-finder.png",
    pngSourcePath: generatedBrandingSource("image-file-finder.png"),
  },
  {
    toolId: "cache-sweep",
    sourceFile: "filex-generated/cache-sweep.png",
    pngSourcePath: generatedBrandingSource("cache-sweep.png"),
  },
  {
    toolId: "filex-send",
    sourceFile: "filex-generated/filex-send.png",
    pngSourcePath: generatedBrandingSource("filex-send.png"),
  },
  {
    toolId: "backup-guard",
    sourceFile: "filex-generated/backup-guard.png",
    pngSourcePath: generatedBrandingSource("backup-guard.png"),
  },
  {
    toolId: "photo-selector-app",
    sourceFile: "filex-generated/photo-selector-app.png",
    pngSourcePath: generatedBrandingSource("photo-selector-app.png"),
  },
];

const rendererAssetCopies = [
  { from: photoSelectorLogoPath, to: join(photoSelectorAssetsDir, "photo_selector.png") },
  { from: photoSelectorLogoPath, to: join(photoSelectorAssetsDir, "logo.png") },
  { from: photoSelectorIconPath, to: join(photoSelectorAssetsDir, "photo_selector_icon.png") },
  { from: photoSelectorIconPath, to: join(photoSelectorAssetsDir, "favicon.png") },
];

await mkdir(targetDir, { recursive: true });
await mkdir(websiteIconsDir, { recursive: true });
await mkdir(photoSelectorAssetsDir, { recursive: true });

for (const asset of rendererAssetCopies) {
  await copyFile(asset.from, asset.to);
}

for (const tool of toolBranding) {
  const fallbackSourcePath = tool.sourceFile ? join(sourceDir, tool.sourceFile) : null;
  const pngSourcePath = tool.pngSourcePath && existsSync(tool.pngSourcePath)
    ? tool.pngSourcePath
    : fallbackSourcePath;
  const icoSourcePath = tool.icoSourcePath && existsSync(tool.icoSourcePath)
    ? tool.icoSourcePath
    : pngSourcePath;
  const pngTargetPath = join(targetDir, `${tool.toolId}.png`);
  const icoTargetPath = join(targetDir, `${tool.toolId}.ico`);
  const icnsTargetPath = join(targetDir, `${tool.toolId}.icns`);

  if (!pngSourcePath) {
    throw new Error(`Missing branding source for ${tool.toolId}`);
  }

  if (pngSourcePath.toLowerCase().endsWith(".svg")) {
    await writeFile(
      pngTargetPath,
      await sharp(pngSourcePath).resize(1024, 1024).png().toBuffer(),
    );
  } else if (tool.pngSourcePath && existsSync(tool.pngSourcePath)) {
    const metadata = await sharp(pngSourcePath).metadata();
    const size = Math.min(metadata.width ?? 0, metadata.height ?? 0);
    if (size <= 0) {
      throw new Error(`Invalid branding master for ${tool.toolId}`);
    }

    const inset = Math.round(size * 0.024);
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="${inset}" y="${inset}" width="${size - (inset * 2)}" height="${size - (inset * 2)}" rx="${Math.round(size * 0.239)}" fill="white"/></svg>`,
    );
    await writeFile(
      pngTargetPath,
      await sharp(pngSourcePath)
        .ensureAlpha()
        .composite([{ input: mask, blend: "dest-in" }])
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    );
  } else {
    await copyFile(pngSourcePath, pngTargetPath);
  }

  if (tool.toolId !== "suite-launcher") {
    await writeFile(
      join(websiteIconsDir, `${tool.toolId}.png`),
      await sharp(pngTargetPath)
        .resize(256, 256, { fit: "contain" })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    );
  }

  await copyBrandIco(icoSourcePath, icoTargetPath);
  await maybeGenerateIcns(pngSourcePath, icnsTargetPath);
}

const coordinatedRendererCopies = [
  ["photo-selector-app.png", join(photoSelectorAssetsDir, "photo_selector.png")],
  ["photo-selector-app.png", join(photoSelectorAssetsDir, "logo.png")],
  ["photo-selector-app.png", join(photoSelectorAssetsDir, "photo_selector_icon.png")],
  ["photo-selector-app.png", join(photoSelectorAssetsDir, "favicon.png")],
  ["image-party-frame.png", join(repoRoot, "apps", "image-party-frame", "logo.png")],
  ["archivio-flow.png", join(repoRoot, "apps", "archivio-flow", "src", "assets", "photo_Archivie.png")],
  ["backup-guard.png", join(repoRoot, "apps", "backup-guard", "src", "assets", "backup-guard.png")],
  ["filex-send.png", join(filexSendAssetsDir, "filex-send-logo.png")],
  ["filex-send.png", join(filexSendWebAssetsDir, "filex-send-logo.png")],
];
for (const [sourceName, destination] of coordinatedRendererCopies) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(targetDir, sourceName), destination);
}

async function copyBrandIco(sourcePath, icoTargetPath) {
  if (sourcePath.toLowerCase().endsWith(".ico") && await isRealIco(sourcePath)) {
    await copyFile(sourcePath, icoTargetPath);
    return;
  }

  await generateIco(sourcePath, icoTargetPath);
}

async function isRealIco(sourcePath) {
  const header = await readFile(sourcePath, { encoding: null });
  return header.length >= 4
    && header[0] === 0x00
    && header[1] === 0x00
    && header[2] === 0x01
    && header[3] === 0x00;
}

async function generateIco(sourcePath, icoTargetPath) {
  const icoBuffer = await buildMultiResolutionIco(sourcePath);
  await writeFile(icoTargetPath, icoBuffer);
}

function wrapPngsAsIco(pngBuffers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);

  const directory = Buffer.alloc(16 * pngBuffers.length);
  let offset = header.length + directory.length;

  for (const [index, pngBuffer] of pngBuffers.entries()) {
    const { width, height } = readPngSize(pngBuffer);
    const entryOffset = index * 16;
    directory.writeUInt8(width >= 256 ? 0 : width, entryOffset);
    directory.writeUInt8(height >= 256 ? 0 : height, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(pngBuffer.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += pngBuffer.length;
  }

  return Buffer.concat([header, directory, ...pngBuffers]);
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

async function buildMultiResolutionIco(sourcePath) {
  const iconSizes = [16, 24, 32, 40, 48, 64, 96, 128, 256];
  const pngBuffers = [];

  for (const size of iconSizes) {
    const scale = size <= 24 ? 0.78 : size <= 48 ? 0.84 : size <= 64 ? 0.88 : 0.92;
    const innerSize = Math.max(1, Math.round(size * scale));
    const foreground = await sharp(sourcePath)
      .resize(innerSize, innerSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const framed = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: foreground, gravity: "center" }])
      .png()
      .toBuffer();

    pngBuffers.push(framed);
  }

  return wrapPngsAsIco(pngBuffers);
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
