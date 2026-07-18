// Regenerates the PWA icons in public/icons/ by rasterizing an inline SVG
// with headless chromium. Run from frontend/: node scripts/gen-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// scale shrinks the glyph toward the center (maskable icons need the content
// inside the central safe zone).
function iconHtml(scale) {
  return `<!doctype html><html><body style="margin:0">
<svg width="100%" height="100%" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#202633"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <text x="240" y="310" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif"
          font-size="190" font-weight="700" fill="#f4f6fa" text-anchor="middle">md</text>
    <rect x="352" y="288" width="76" height="22" rx="4" fill="#5b8def"/>
  </g>
</svg></body></html>`;
}

const targets = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(iconHtml(t.scale));
  await page.screenshot({ path: join(outDir, t.file) });
  console.log('wrote', t.file);
}
await browser.close();
