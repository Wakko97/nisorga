import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
mkdirSync(publicDir, { recursive: true });

// Theme accent used throughout the app (bg-gray-900 / text-white).
const BG = "#111827"; // tailwind gray-900
const FG = "#ffffff";

function svgIcon(size, { maskable = false } = {}) {
  // For maskable icons, keep the glyph within the ~80% "safe zone" circle.
  const pad = maskable ? size * 0.19 : size * 0.14;
  const glyphSize = size - pad * 2;
  const fontSize = glyphSize * 0.62;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text x="50%" y="50%" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" fill="${FG}" text-anchor="middle" dominant-baseline="central">N</text>
</svg>`;
}

const targets = [
  { file: "pwa-192x192.png", size: 192, maskable: false },
  { file: "pwa-512x512.png", size: 512, maskable: false },
  { file: "maskable-icon-512x512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
];

for (const t of targets) {
  const svg = svgIcon(t.size, { maskable: t.maskable });
  await sharp(Buffer.from(svg)).png().toFile(join(publicDir, t.file));
  console.log("wrote", t.file);
}

// Also drop the source SVG for reference / favicon use.
writeFileSync(join(publicDir, "icon-source.svg"), svgIcon(512));
// Simple favicon (same glyph, small size) as ICO-less PNG fallback.
await sharp(Buffer.from(svgIcon(64))).png().toFile(join(publicDir, "favicon.png"));
console.log("done");
