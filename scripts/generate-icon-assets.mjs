import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const root = process.cwd();
const source = path.join(root, "desktop", "icon.svg");
const assetDirectory = path.join(root, "desktop", "assets");
const iconsetDirectory = path.join(assetDirectory, "AI-Dev-Orchestrator.iconset");
const masterPath = path.join(assetDirectory, "AI-Dev-Orchestrator-1024.png");
const icnsPath = path.join(assetDirectory, "AI-Dev-Orchestrator.icns");
const dockAnimationDirectory = path.join(assetDirectory, "dock-animation");
const outputDirectory = path.join(root, "outputs");
const dockPreviewPath = path.join(outputDirectory, "AI-Dev-Orchestrator-Dock-Animation-Frames.png");
const dockGifPath = path.join(outputDirectory, "AI-Dev-Orchestrator-Dock-Animation.gif");

const sizes = [16, 32, 128, 256, 512];
const modernIcnsTypes = new Map([
  [16, "icp4"],
  [32, "icp5"],
  [64, "icp6"],
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
  [1024, "ic10"],
]);

function icnsChunk(type, png) {
  const chunk = Buffer.allocUnsafe(8 + png.length);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32BE(chunk.length, 4);
  png.copy(chunk, 8);
  return chunk;
}

await rm(iconsetDirectory, { recursive: true, force: true });
await rm(dockAnimationDirectory, { recursive: true, force: true });
await mkdir(iconsetDirectory, { recursive: true });
await mkdir(dockAnimationDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(assetDirectory, "AI-Dev-Orchestrator.svg"), await readFile(source));

const pngBySize = new Map();
for (const size of [...new Set(sizes.flatMap((value) => [value, value * 2]))].sort((a, b) => a - b)) {
  pngBySize.set(size, await sharp(source).resize(size, size).png().toBuffer());
}

await writeFile(masterPath, pngBySize.get(1024));
for (const size of sizes) {
  await writeFile(path.join(iconsetDirectory, `icon_${size}x${size}.png`), pngBySize.get(size));
  await writeFile(path.join(iconsetDirectory, `icon_${size}x${size}@2x.png`), pngBySize.get(size * 2));
}

const chunks = [...modernIcnsTypes].map(([size, type]) => icnsChunk(type, pngBySize.get(size)));
const header = Buffer.allocUnsafe(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
await writeFile(icnsPath, Buffer.concat([header, ...chunks]));

const frameCount = 20;
const frameDurationMs = 80;
const dockFrameBuffers = [];
const clamp = (value) => Math.min(1, Math.max(0, value));
const easeOut = (value) => 1 - ((1 - value) ** 3);

function dockFrameSvg(index) {
  const time = index / (frameCount - 1);
  const markProgress = easeOut(clamp(time / .48));
  const arcProgress = easeOut(clamp((time - .34) / .4));
  const settleProgress = easeOut(clamp((time - .68) / .32));
  const scale = .91 + (.12 * markProgress) - (.03 * settleProgress);
  const glowOpacity = .1 + (.36 * arcProgress) - (.08 * settleProgress);
  const orbitRadius = 116 + (210 * easeOut(clamp(time / .72)));
  const orbitOpacity = Math.sin(clamp(time / .78) * Math.PI) * .34;
  const aDashOffset = 1500 * (1 - markProgress);
  const arcDashOffset = 520 * (1 - arcProgress);

  return `<svg width="512" height="512" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="tile"><rect x="28" y="28" width="968" height="968" rx="214"/></clipPath>
      <linearGradient id="background" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1e31"/><stop offset="1" stop-color="#0a0b12"/></linearGradient>
      <radialGradient id="glow" cx="0.52" cy="0.82" r="0.78"><stop offset="0" stop-color="#796ce9" stop-opacity="${glowOpacity.toFixed(3)}"/><stop offset=".58" stop-color="#5b5fce" stop-opacity=".1"/><stop offset="1" stop-color="#5b5fce" stop-opacity="0"/></radialGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b93f8"/><stop offset="1" stop-color="#9f6ef0"/></linearGradient>
      <filter id="arcGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g clip-path="url(#tile)">
      <rect width="1024" height="1024" fill="url(#background)"/>
      <rect width="1024" height="1024" fill="url(#glow)"/>
      <circle cx="512" cy="536" r="${orbitRadius.toFixed(1)}" fill="none" stroke="#eef0fa" stroke-width="2" opacity="${orbitOpacity.toFixed(3)}"/>
      <g transform="translate(512 512) scale(${scale.toFixed(4)}) translate(-512 -512)">
        <path d="M365 652 Q512 492 659 652" fill="none" stroke="url(#accent)" stroke-width="76" stroke-linecap="round" stroke-dasharray="520" stroke-dashoffset="${arcDashOffset.toFixed(1)}" filter="url(#arcGlow)"/>
        <path d="M286 760 468 304 Q484 264 512 264 Q540 264 556 304 L738 760" fill="none" stroke="#eef0fa" stroke-width="102" stroke-linecap="butt" stroke-linejoin="round" stroke-dasharray="1500" stroke-dashoffset="${aDashOffset.toFixed(1)}"/>
      </g>
    </g>
  </svg>`;
}

for (let index = 0; index < frameCount; index += 1) {
  const buffer = await sharp(Buffer.from(dockFrameSvg(index))).png().toBuffer();
  dockFrameBuffers.push(buffer);
  await writeFile(path.join(dockAnimationDirectory, `frame-${String(index).padStart(2, "0")}.png`), buffer);
}

const previewSize = 160;
const previewColumns = 5;
const previewRows = Math.ceil(frameCount / previewColumns);
const previewFrames = await Promise.all(dockFrameBuffers.map((buffer) => sharp(buffer).resize(previewSize, previewSize).png().toBuffer()));
await sharp({
  create: {
    width: previewColumns * previewSize,
    height: previewRows * previewSize,
    channels: 4,
    background: { r: 8, g: 9, b: 15, alpha: 1 },
  },
}).composite(previewFrames.map((input, index) => ({
  input,
  left: (index % previewColumns) * previewSize,
  top: Math.floor(index / previewColumns) * previewSize,
}))).png().toFile(dockPreviewPath);
await sharp(dockFrameBuffers, { join: { animated: true } })
  .resize(256, 256)
  .gif({ delay: Array(frameCount).fill(frameDurationMs), loop: 0 })
  .toFile(dockGifPath);

console.log(`Generated icon assets in ${assetDirectory}`);
console.log(`Generated ${frameCount} Dock animation frames at ${frameDurationMs}ms each`);
console.log(`Dock animation preview created at ${dockPreviewPath}`);
console.log(`Animated Dock preview created at ${dockGifPath}`);
