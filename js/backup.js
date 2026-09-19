/* Backup and restore.
   Format: a .zip containing diary.json (all text/metadata) plus photos/ as
   plain JPEGs. Both halves are readable without this app, which matters for
   an archive meant to outlive it. */

import { db } from './db.js';
import { sanitizeHTML } from './util.js';
import { releaseAll } from './images.js';
import { writeZip, readZip } from './zip.js';
import { refreshNote } from './store.js';

export const FORMAT = 1;

export async function exportArchive(onProgress = () => {}) {
  const [notes, entries, settings, photos] = await Promise.all([
    db.all('notes'), db.all('entries'), db.all('settings'), db.all('photos'),
  ]);

  const manifest = {
    format: FORMAT,
    app: 'dia-ry',
    exportedAt: new Date().toISOString(),
    counts: { notes: notes.length, entries: entries.length, photos: photos.length },
    settings: settings.map(({ key, value }) => ({ key, value })),
    notes: notes.map((n) => ({
      id: n.id, title: n.title, date: n.date, place: n.place,
      createdAt: n.createdAt, updatedAt: n.updatedAt, pinned: n.pinned ? 1 : 0,
    })),
    entries: entries.map((e) => ({
      id: e.id, noteId: e.noteId, at: e.at, html: e.html,
      photos: e.photos || [], createdAt: e.createdAt, updatedAt: e.updatedAt,
    })),
    photos: photos.map((p) => ({
      id: p.id, noteId: p.noteId, entryId: p.entryId,
      w: p.w, h: p.h, createdAt: p.createdAt,
      file: `photos/${p.id}.jpg`, thumb: `photos/${p.id}.thumb.jpg`,
    })),
  };

  const files = [
    { name: 'diary.json', blob: new Blob([JSON.stringify(manifest, null, 1)],
      { type: 'application/json' }) },
    { name: 'README.txt', blob: new Blob([README], { type: 'text/plain' }) },
  ];
  for (const p of photos) {
    files.push({ name: `photos/${p.id}.jpg`, blob: p.blob });
    if (p.thumb) files.push({ name: `photos/${p.id}.thumb.jpg`, blob: p.thumb });
  }

  return writeZip(files, onProgress);
}

const README = `dia-ry backup
-------------
diary.json  every note, entry and setting, as plain JSON
photos/     every photo as a normal .jpg (<id>.jpg is full size,
            <id>.thumb.jpg is the small preview)

Restore it from Settings > Restore from backup. Even without the app the
text is readable in any editor and the photos open anywhere.
`;

/**
 * Restore an archive.
 * @param {File|Blob} file
 * @param {'merge'|'replace'} mode  merge keeps existing records and adds
 *        anything missing; replace wipes the diary first.
 */
export async function importArchive(file, mode = 'merge', onProgress = () => {}) {
  const zip = await readZip(file);
  const manifestEntry = zip.get('diary.json');
  if (!manifestEntry) throw new Error('This ZIP has no diary.json in it');

  const data = JSON.parse(await manifestEntry.text());
  if (!data || !Array.isArray(data.notes)) throw new Error('diary.json is not a dia-ry backup');
  if (data.format > FORMAT) {
    throw new Error('This backup was made by a newer version of the app');
  }

  if (mode === 'replace') {
    await db.write(['notes', 'entries', 'photos'], (tx) => {
      tx.objectStore('notes').clear();
      tx.objectStore('entries').clear();
      tx.objectStore('photos').clear();
    });
    releaseAll();
  }

  const existingNotes = new Set((await db.all('notes')).map((n) => n.id));
  const existingEntries = new Set((await db.all('entries')).map((e) => e.id));
  const existingPhotos = new Set((await db.all('photos')).map((p) => p.id));

  const result = { notes: 0, entries: 0, photos: 0, skipped: 0 };
  const touched = new Set();

  const notes = data.notes.filter((n) => n && n.id && !existingNotes.has(n.id));
  const entries = (data.entries || []).filter((e) => e && e.id && !existingEntries.has(e.id));
  const photoRows = (data.photos || []).filter((p) => p && p.id && !existingPhotos.has(p.id));
  const total = notes.length + entries.length + photoRows.length;
  let done = 0;
  const tick = () => { done += 1; if (done % 10 === 0 || done === total) onProgress(done, total); };

  for (const n of notes) {
    await db.put('notes', {
      id: n.id,
      title: String(n.title || ''),
      date: String(n.date || '').slice(0, 10) || '1970-01-01',
      place: String(n.place || ''),
      createdAt: Number(n.createdAt) || Date.now(),
      updatedAt: Number(n.updatedAt) || Date.now(),
      ...(n.pinned ? { pinned: 1 } : {}),
      sortKey: '', text: '', entryCount: 0, photoCount: 0, cover: [],
    });
    touched.add(n.id);
    result.notes += 1;
    tick();
  }

  for (const e of entries) {
    if (!e.noteId) { result.skipped += 1; tick(); continue; }
    await db.put('entries', {
      id: e.id,
      noteId: e.noteId,
      at: Number(e.at) || Date.now(),
      html: sanitizeHTML(e.html || ''),
      photos: Array.isArray(e.photos) ? e.photos.map(String) : [],
      createdAt: Number(e.createdAt) || Date.now(),
      updatedAt: Number(e.updatedAt) || Date.now(),
    });
    touched.add(e.noteId);
    result.entries += 1;
    tick();
  }

  for (const p of photoRows) {
    const full = zip.get(p.file || `photos/${p.id}.jpg`);
    if (!full) { result.skipped += 1; tick(); continue; }
    const thumbEntry = zip.get(p.thumb || `photos/${p.id}.thumb.jpg`);
    const blob = await full.blob();
    const thumb = thumbEntry ? await thumbEntry.blob() : blob;
    await db.put('photos', {
      id: p.id,
      noteId: p.noteId,
      entryId: p.entryId,
      blob: new Blob([blob], { type: 'image/jpeg' }),
      thumb: new Blob([thumb], { type: 'image/jpeg' }),
      w: Number(p.w) || 0,
      h: Number(p.h) || 0,
      size: blob.size + thumb.size,
      createdAt: Number(p.createdAt) || Date.now(),
    });
    touched.add(p.noteId);
    result.photos += 1;
    tick();
  }

  if (mode === 'replace' && Array.isArray(data.settings)) {
    for (const s of data.settings) {
      if (s && typeof s.key === 'string') await db.put('settings', { key: s.key, value: s.value });
    }
  }

  for (const id of touched) await refreshNote(id);
  onProgress(total, total);
  return result;
}

/**
 * Hand the archive to the OS. On iOS the share sheet is the only sane route
 * to iCloud Drive, so try it first and fall back to a plain download.
 * Must be called from a user gesture or Safari refuses the share.
 * @returns {Promise<'shared'|'downloaded'|'blocked'>}
 */
export async function saveArchive(blob, filename) {
  const file = new File([blob], filename, { type: 'application/zip' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'dia-ry backup' });
      return 'shared';
    } catch (err) {
      // The user dismissing the sheet is not a failure worth reporting.
      if (err && err.name === 'AbortError') return 'shared';
      // No transient activation left: the caller offers a second tap.
      if (err && err.name === 'NotAllowedError') return 'blocked';
    }
  }
  download(blob, filename);
  return 'downloaded';
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function backupFilename() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `dia-ry-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.zip`;
}
