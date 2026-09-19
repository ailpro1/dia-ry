/* Photo intake: downscale on device before storing, so a decade of entries
   stays a sane size and scrolling stays smooth. Originals are never kept. */

const FULL_EDGE = 1800;   // longest edge of the stored photo
const THUMB_EDGE = 480;   // longest edge of the list/strip thumbnail
const QUALITY = 0.82;
const THUMB_QUALITY = 0.72;

const urlCache = new Map(); // id -> object URL

export async function processFile(file) {
  const bitmap = await decode(file);
  try {
    const full = await encode(bitmap, FULL_EDGE, QUALITY);
    const thumb = await encode(bitmap, THUMB_EDGE, THUMB_QUALITY);
    const scale = Math.min(1, FULL_EDGE / Math.max(bitmap.width, bitmap.height));
    return {
      blob: full,
      thumb,
      w: Math.round(bitmap.width * scale),
      h: Math.round(bitmap.height * scale),
    };
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

async function decode(file) {
  // createImageBitmap honours EXIF orientation when asked; Safari needs the
  // <img> fallback for HEIC-converted JPEGs on older versions.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function encode(source, maxEdge, quality) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  // Free the backing store promptly on iOS, which caps total canvas memory.
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error('Could not compress that image');
  return blob;
}

/** Stable object URL per photo id, reused across renders. */
export function blobURL(id, blob) {
  let url = urlCache.get(id);
  if (!url) {
    url = URL.createObjectURL(blob);
    urlCache.set(id, url);
  }
  return url;
}

export function releaseURL(id) {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

export function releaseAll() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}
