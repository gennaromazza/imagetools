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
const photoSelectorAssetsDir = join(repoRoot, "apps", "photo-selector-app", "src", "assets");
const autoLayoutAssetsDir = join(repoRoot, "apps", "auto-layout-app", "src", "assets");
const autoLayoutPublicDir = join(repoRoot, "apps", "auto-layout-app", "public");
const photoSelectorLogoPath = join(sourceDir, "photo_selector.png");
const photoSelectorIconPath = join(sourceDir, "photo_selector_icon.png");
const autoLayoutLogoPath = join(sourceDir, "album_maker.png");
const autoLayoutIconPath = join(sourceDir, "album_maker.ico");

const toolBranding = [
  { toolId: "suite-launcher", sourceFile: "LOGO_Image_tool.png" },
  {
    toolId: "auto-layout-app",
    pngSourcePath: autoLayoutLogoPath,
    icoSourcePath: autoLayoutIconPath,
  },
  {
    toolId: "image-party-frame",
    sourceFile: "party_frame_logo.png",
    pngSourcePath: join(repoRoot, "apps", "image-party-frame", "logo.png"),
    icoSourcePath: join(repoRoot, "apps", "image-party-frame", "favico.ico"),
  },
  { toolId: "image-id-print", sourceFile: "id_print_logo.png" },
  { toolId: "archivio-flow", sourceFile: "photo_Archivie.png" },
  {
    toolId: "photo-selector-app",
    pngSourcePath: photoSelectorLogoPath,
    icoSourcePath: photoSelectorIconPath,
  },
];

const rendererAssetCopies = [
  { from: autoLayoutLogoPath, to: join(autoLayoutAssetsDir, "album_maker.png") },
  { from: autoLayoutIconPath, to: join(autoLayoutPublicDir, "album_maker.ico") },
  { from: photoSelectorLogoPath, to: join(photoSelectorAssetsDir, "photo_selector.png") },
  { from: photoSelectorLogoPath, to: join(photoSelectorAssetsDir, "logo.png") },
  { from: photoSelectorIconPath, to: join(photoSelectorAssetsDir, "photo_selector_icon.png") },
  { from: photoSelectorIconPath, to: join(photoSelectorAssetsDir, "favicon.png") },
];

await mkdir(targetDir, { recursive: true });
await mkdir(photoSelectorAssetsDir, { recursive: true });
await mkdir(autoLayoutAssetsDir, { recursive: true });
await mkdir(autoLayoutPublicDir, { recursive: true });

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

  await copyFile(pngSourcePath, pngTargetPath);
  await copyBrandIco(icoSourcePath, icoTargetPath);
  await maybeGenerateIcns(pngSourcePath, icnsTargetPath);
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
