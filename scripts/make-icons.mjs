/* Rebuilds icons/ from icons/source.png.
   The artwork is trimmed to its opaque bounds, flattened onto its own
   background colour (iOS paints transparency black) and rendered full-bleed,
   because iOS applies its own rounded mask on top. The maskable variant is
   inset instead, so Android's mask cannot clip the book.

   Needs a Chromium for the resampling:
     node scripts/make-icons.mjs
   Icons are committed, so this only runs when the artwork changes. */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = new URL('../icons/', import.meta.url);
const source = readFileSync(new URL('source.png', ROOT));

const JOBS = [
  // iOS home screen (apple-touch-icon)
  ['icon-120.png', 120, {}],
  ['icon-152.png', 152, {}],
  ['icon-167.png', 167, {}],
  ['icon-180.png', 180, {}],
  // web app manifest
  ['icon-192.png', 192, {}],
  ['icon-256.png', 256, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { inset: 0.8 }],
  // browser tab
  ['favicon.png', 64, {}],
];

const browser = await chromium.launch();
const page = await browser.newPage();

const results = await page.evaluate(async ({ dataUrl, jobs }) => {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = () => rej(new Error('bad source image'));
    img.src = dataUrl;
  });

  // --- trim to opaque bounds ---
  const probe = document.createElement('canvas');
  probe.width = img.width; probe.height = img.height;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(img, 0, 0);
  const { data } = pctx.getImageData(0, 0, img.width, img.height);

  let minX = img.width; let minY = img.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (data[(y * img.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('source image is fully transparent');

  // Square the crop so nothing is stretched.
  const side = Math.max(maxX - minX + 1, maxY - minY + 1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const crop = {
    x: Math.round(cx - side / 2), y: Math.round(cy - side / 2), side,
  };

  // Background: the artwork's own fill, sampled just inside its top edge.
  const sx = Math.round(cx);
  const sy = Math.round(minY + (maxY - minY) * 0.06);
  const p = (sy * img.width + sx) * 4;
  const bg = `rgb(${data[p]}, ${data[p + 1]}, ${data[p + 2]})`;

  /* Progressive halving keeps small sizes crisp; a single big downscale
     in Chromium leaves the lettering ragged. */
  const shrink = (src, sw, sh, tw, th) => {
    let cur = src; let cw = sw; let ch = sh;
    while (cw / 2 > tw) {
      const half = document.createElement('canvas');
      half.width = Math.round(cw / 2); half.height = Math.round(ch / 2);
      const hctx = half.getContext('2d');
      hctx.imageSmoothingEnabled = true;
      hctx.imageSmoothingQuality = 'high';
      hctx.drawImage(cur, 0, 0, half.width, half.height);
      cur = half; cw = half.width; ch = half.height;
    }
    return { cur, cw, ch };
  };

  const cropped = document.createElement('canvas');
  cropped.width = crop.side; cropped.height = crop.side;
  const cctx = cropped.getContext('2d');
  cctx.fillStyle = bg;
  cctx.fillRect(0, 0, crop.side, crop.side);
  cctx.drawImage(img, crop.x, crop.y, crop.side, crop.side,
    0, 0, crop.side, crop.side);

  const out = [];
  for (const [name, size, opts] of jobs) {
    const box = Math.round(size * (opts.inset || 1));
    const { cur, cw, ch } = shrink(cropped, crop.side, crop.side, box, box);

    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const off = Math.round((size - box) / 2);
    ctx.drawImage(cur, 0, 0, cw, ch, off, off, box, box);

    out.push([name, canvas.toDataURL('image/png')]);
  }
  return { bg, crop, out };
}, {
  dataUrl: `data:image/png;base64,${source.toString('base64')}`,
  jobs: JOBS,
});

for (const [name, dataUrl] of results.out) {
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(new URL(name, ROOT), bytes);
  console.log('wrote icons/%s (%d bytes)', name, bytes.length);
}
console.log('background %s, cropped from %o', results.bg, results.crop);

await browser.close();
