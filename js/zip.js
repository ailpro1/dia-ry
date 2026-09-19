/* Minimal ZIP reader/writer (store + deflate-raw on read).
   Written by hand so backups never depend on a third-party library that may
   stop being available years from now. ZIP64 is emitted when needed, so an
   archive with more than 65535 members or over 4 GB still restores. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, seed = 0) {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}

async function blobCRC(blob) {
  const CHUNK = 4 * 1024 * 1024;
  let crc = 0;
  for (let off = 0; off < blob.size; off += CHUNK) {
    const part = blob.slice(off, Math.min(off + CHUNK, blob.size));
    crc = crc32(new Uint8Array(await part.arrayBuffer()), crc);
  }
  return crc;
}

function dosTime(date) {
  const y = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2)),
    date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const U32 = 0xffffffff;
const U16 = 0xffff;

/**
 * Build a ZIP Blob. Each file is {name, blob}. Data is stored uncompressed —
 * the payload is already-compressed JPEG plus one small JSON file.
 * @param {Function} [onProgress] (done, total)
 */
export async function writeZip(files, onProgress) {
  const parts = [];
  const central = [];
  let offset = 0;
  const stamp = dosTime(new Date());

  for (let i = 0; i < files.length; i += 1) {
    const { name, blob } = files[i];
    const nameBytes = new TextEncoder().encode(name);
    const crc = await blobCRC(blob);
    const size = blob.size;
    const needsZip64 = size > U32 || offset > U32;

    const local = new DataView(new ArrayBuffer(30 + nameBytes.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, needsZip64 ? 45 : 20, true);
    local.setUint16(6, 0, true);          // flags
    local.setUint16(8, 0, true);          // method: store
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, Math.min(size, U32), true);
    local.setUint32(22, Math.min(size, U32), true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    const localBytes = new Uint8Array(local.buffer);
    localBytes.set(nameBytes, 30);

    parts.push(localBytes, blob);

    // Central directory record (with a ZIP64 extra field when required).
    const extra = needsZip64 ? zip64Extra(size, offset) : new Uint8Array(0);
    const cd = new DataView(new ArrayBuffer(46 + nameBytes.length + extra.length));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 45, true);
    cd.setUint16(6, needsZip64 ? 45 : 20, true);
    cd.setUint16(8, 0, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, stamp.time, true);
    cd.setUint16(14, stamp.date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, Math.min(size, U32), true);
    cd.setUint32(24, Math.min(size, U32), true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, extra.length, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, Math.min(offset, U32), true);
    const cdBytes = new Uint8Array(cd.buffer);
    cdBytes.set(nameBytes, 46);
    cdBytes.set(extra, 46 + nameBytes.length);
    central.push(cdBytes);

    offset += localBytes.length + size;
    if (onProgress) onProgress(i + 1, files.length);
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  parts.push(...central);

  const zip64 = files.length > U16 || cdOffset > U32 || cdSize > U32;
  if (zip64) {
    const rec = new DataView(new ArrayBuffer(56 + 20));
    rec.setUint32(0, 0x06064b50, true);
    rec.setBigUint64(4, 44n, true);        // size of record after this field
    rec.setUint16(12, 45, true);
    rec.setUint16(14, 45, true);
    rec.setUint32(16, 0, true);
    rec.setUint32(20, 0, true);
    rec.setBigUint64(24, BigInt(files.length), true);
    rec.setBigUint64(32, BigInt(files.length), true);
    rec.setBigUint64(40, BigInt(cdSize), true);
    rec.setBigUint64(48, BigInt(cdOffset), true);
    // ZIP64 end-of-central-directory locator
    rec.setUint32(56, 0x07064b50, true);
    rec.setUint32(60, 0, true);
    rec.setBigUint64(64, BigInt(cdOffset + cdSize), true);
    rec.setUint32(72, 1, true);
    parts.push(new Uint8Array(rec.buffer));
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, Math.min(files.length, U16), true);
  eocd.setUint16(10, Math.min(files.length, U16), true);
  eocd.setUint32(12, Math.min(cdSize, U32), true);
  eocd.setUint32(16, Math.min(cdOffset, U32), true);
  eocd.setUint16(20, 0, true);
  parts.push(new Uint8Array(eocd.buffer));

  return new Blob(parts, { type: 'application/zip' });
}

function zip64Extra(size, offset) {
  const v = new DataView(new ArrayBuffer(4 + 24));
  v.setUint16(0, 0x0001, true);
  v.setUint16(2, 24, true);
  v.setBigUint64(4, BigInt(size), true);
  v.setBigUint64(12, BigInt(size), true);
  v.setBigUint64(20, BigInt(offset), true);
  return new Uint8Array(v.buffer);
}

/* ---------------- reading ---------------- */

/**
 * Read a ZIP Blob's central directory.
 * @returns {Promise<Map<string, {blob: () => Promise<Blob>, size: number}>>}
 */
export async function readZip(file) {
  const tailSize = Math.min(file.size, 66 * 1024);
  const tail = new DataView(
    await file.slice(file.size - tailSize, file.size).arrayBuffer()
  );

  let eocdAt = -1;
  for (let i = tail.byteLength - 22; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocdAt = i; break; }
  }
  if (eocdAt < 0) throw new Error('Not a ZIP file (no end record found)');

  let count = tail.getUint16(eocdAt + 10, true);
  let cdOffset = tail.getUint32(eocdAt + 16, true);
  let cdSize = tail.getUint32(eocdAt + 12, true);

  // ZIP64 locator sits immediately before the end record.
  if (count === U16 || cdOffset === U32 || cdSize === U32) {
    const locAt = eocdAt - 20;
    if (locAt >= 0 && tail.getUint32(locAt, true) === 0x07064b50) {
      const z64At = Number(tail.getBigUint64(locAt + 8, true));
      const z64 = new DataView(
        await file.slice(z64At, z64At + 56).arrayBuffer()
      );
      if (z64.getUint32(0, true) === 0x06064b50) {
        count = Number(z64.getBigUint64(32, true));
        cdSize = Number(z64.getBigUint64(40, true));
        cdOffset = Number(z64.getBigUint64(48, true));
      }
    }
  }

  const cd = new DataView(
    await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer()
  );
  const decoder = new TextDecoder();
  const entries = new Map();
  let p = 0;

  for (let i = 0; i < count && p + 46 <= cd.byteLength; i += 1) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let compSize = cd.getUint32(p + 20, true);
    let rawSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localAt = cd.getUint32(p + 42, true);
    const name = decoder.decode(
      new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen)
    );

    if (compSize === U32 || rawSize === U32 || localAt === U32) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const tag = cd.getUint16(e, true);
        const len = cd.getUint16(e + 2, true);
        if (tag === 0x0001) {
          let q = e + 4;
          if (rawSize === U32) { rawSize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (compSize === U32) { compSize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (localAt === U32) { localAt = Number(cd.getBigUint64(q, true)); }
          break;
        }
        e += 4 + len;
      }
    }

    entries.set(name, makeReader(file, localAt, compSize, method));
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

function makeReader(file, localAt, compSize, method) {
  return {
    size: compSize,
    async blob() {
      const head = new DataView(
        await file.slice(localAt, localAt + 30).arrayBuffer()
      );
      if (head.getUint32(0, true) !== 0x04034b50) {
        throw new Error('Damaged archive (bad local header)');
      }
      const start = localAt + 30 + head.getUint16(26, true) +
        head.getUint16(28, true);
      const raw = file.slice(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) {
        if (typeof DecompressionStream !== 'function') {
          throw new Error('This browser cannot read compressed archives');
        }
        const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).blob();
      }
      throw new Error(`Unsupported compression method ${method}`);
    },
    async text() {
      return (await this.blob()).text();
    },
  };
}
