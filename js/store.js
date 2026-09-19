/* Domain layer: notes, entries, photos, settings.
   Everything the UI needs goes through here so invariants (counts, covers,
   search text) are maintained in one place. */

import { db } from './db.js';
import { uid, isoDate, htmlToText, sanitizeHTML } from './util.js';
import { processFile, releaseURL } from './images.js';

const SEARCH_CAP = 6000; // chars of note body kept for search

export const DEFAULT_SETTINGS = {
  ownerName: '',
  theme: 'peach',
  mode: 'auto',       // auto | light | dark
  fontScale: 1,
  lastBackupAt: 0,
  backupReminderDays: 30,
};

/* ---------------- settings ---------------- */

export async function loadSettings() {
  const rows = await db.all('settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) out[row.key] = row.value;
  }
  return out;
}

export function setSetting(key, value) {
  return db.put('settings', { key, value });
}

/* ---------------- notes ---------------- */

function sortKeyFor(date, createdAt) {
  return `${date}|${String(createdAt).padStart(15, '0')}`;
}

export async function createNote({ title = '', date = isoDate(), place = '' } = {}) {
  const now = Date.now();
  const note = {
    id: uid(),
    title: title.trim(),
    date,
    place: place.trim(),
    createdAt: now,
    updatedAt: now,
    sortKey: sortKeyFor(date, now),
    text: title.trim().toLowerCase(),
    preview: '',
    entryCount: 0,
    photoCount: 0,
    cover: [],
  };
  await db.put('notes', note);
  return note;
}

export function getNote(id) {
  return db.get('notes', id);
}

export async function updateNote(id, patch) {
  const note = await db.get('notes', id);
  if (!note) throw new Error('Note not found');
  Object.assign(note, patch);
  note.updatedAt = Date.now();
  note.sortKey = sortKeyFor(note.date, note.createdAt);
  if (patch.pinned === false || patch.pinned === 0) delete note.pinned;
  else if (patch.pinned === true) note.pinned = 1;
  await db.put('notes', note);
  await refreshNote(id);
  return db.get('notes', id);
}

export async function deleteNote(id) {
  const photos = await db.index('photos', 'by_note', IDBKeyRange.only(id));
  const entries = await db.index('entries', 'by_note', IDBKeyRange.only(id));
  await db.write(['notes', 'entries', 'photos'], (tx) => {
    for (const p of photos) tx.objectStore('photos').delete(p.id);
    for (const e of entries) tx.objectStore('entries').delete(e.id);
    tx.objectStore('notes').delete(id);
  });
  photos.forEach((p) => releaseURL(p.id));
}

/**
 * One page of the timeline, newest first.
 * @param {object} opts
 * @param {string} [opts.cursor] sortKey of the last note already shown
 * @param {number} [opts.limit]
 * @param {string} [opts.query] case-insensitive substring over title + body
 */
export async function listNotes({ cursor = null, limit = 25, query = '' } = {}) {
  const q = query.trim().toLowerCase();
  const range = cursor
    ? IDBKeyRange.upperBound(cursor, true)
    : null;

  return db.read('notes', (tx) => {
    const idx = tx.objectStore('notes').index('by_sort');
    const out = [];
    return new Promise((resolve, reject) => {
      const cur = idx.openCursor(range, 'prev');
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) { resolve({ notes: out, done: true }); return; }
        const note = c.value;
        if (!q || (note.text || '').includes(q)) out.push(note);
        if (out.length >= limit) {
          resolve({ notes: out, done: false, cursor: note.sortKey });
          return;
        }
        c.continue();
      };
    });
  });
}

export async function listPinned() {
  const rows = await db.index('notes', 'by_pinned', IDBKeyRange.only(1));
  return rows.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
}

/* ---------------- entries ---------------- */

export async function listEntries(noteId) {
  const rows = await db.index('entries', 'by_note', IDBKeyRange.only(noteId));
  return rows.sort((a, b) => a.at - b.at || a.createdAt - b.createdAt);
}

export async function addEntry(noteId, { at = Date.now(), html = '', photos = [] } = {}) {
  const now = Date.now();
  const entry = {
    id: uid(),
    noteId,
    at,
    html: sanitizeHTML(html),
    photos: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.put('entries', entry);
  if (photos.length) await attachPhotos(entry.id, photos);
  await refreshNote(noteId);
  return db.get('entries', entry.id);
}

export async function updateEntry(id, { at, html, photoOrder } = {}) {
  const entry = await db.get('entries', id);
  if (!entry) throw new Error('Entry not found');
  if (at !== undefined) entry.at = at;
  if (html !== undefined) entry.html = sanitizeHTML(html);
  if (photoOrder) entry.photos = photoOrder.filter((p) => entry.photos.includes(p));
  entry.updatedAt = Date.now();
  await db.put('entries', entry);
  await refreshNote(entry.noteId);
  return entry;
}

export async function deleteEntry(id) {
  const entry = await db.get('entries', id);
  if (!entry) return;
  const photos = await db.index('photos', 'by_entry', IDBKeyRange.only(id));
  await db.write(['entries', 'photos'], (tx) => {
    for (const p of photos) tx.objectStore('photos').delete(p.id);
    tx.objectStore('entries').delete(id);
  });
  photos.forEach((p) => releaseURL(p.id));
  await refreshNote(entry.noteId);
}

/* ---------------- photos ---------------- */

/**
 * Store photos against an entry.
 * @param {(File|{blob:Blob,thumb:Blob,w:number,h:number})[]} files  raw picks
 *        are compressed here; already-processed objects are stored as-is.
 * @param {Function} [onProgress] called as (done, total)
 */
export async function attachPhotos(entryId, files, onProgress) {
  const entry = await db.get('entries', entryId);
  if (!entry) throw new Error('Entry not found');
  const list = [...files];
  const added = [];

  for (let i = 0; i < list.length; i += 1) {
    const file = list[i];
    const ready = file && file.blob instanceof Blob && file.thumb instanceof Blob;
    if (!ready &&
        !/^image\//.test(file.type) &&
        !/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || '')) {
      continue;
    }
    // Sequential on purpose: parallel canvas decodes crash Safari on big batches.
    const shot = ready ? file : await processFile(file);
    const photo = {
      id: uid(),
      noteId: entry.noteId,
      entryId,
      blob: shot.blob,
      thumb: shot.thumb,
      w: shot.w,
      h: shot.h,
      size: shot.blob.size + shot.thumb.size,
      createdAt: Date.now(),
    };
    await db.put('photos', photo);
    added.push(photo.id);
    if (onProgress) onProgress(i + 1, list.length);
  }

  if (added.length) {
    const fresh = await db.get('entries', entryId);
    fresh.photos = [...(fresh.photos || []), ...added];
    fresh.updatedAt = Date.now();
    await db.put('entries', fresh);
    await refreshNote(fresh.noteId);
  }
  return added;
}

export async function removePhoto(photoId) {
  const photo = await db.get('photos', photoId);
  if (!photo) return;
  const entry = await db.get('entries', photo.entryId);
  await db.write(['photos', 'entries'], (tx) => {
    tx.objectStore('photos').delete(photoId);
    if (entry) {
      entry.photos = (entry.photos || []).filter((p) => p !== photoId);
      entry.updatedAt = Date.now();
      tx.objectStore('entries').put(entry);
    }
  });
  releaseURL(photoId);
  if (entry) await refreshNote(entry.noteId);
}

export function getPhoto(id) {
  return db.get('photos', id);
}

export async function getPhotos(ids) {
  if (!ids || !ids.length) return [];
  const found = await db.read('photos', (tx) => {
    const store = tx.objectStore('photos');
    return Promise.all(ids.map((id) => db.req(store.get(id))));
  });
  return found.filter(Boolean);
}

/* ---------------- derived note fields ---------------- */

/** Recompute counts, cover thumbnails and search text for a note. */
export async function refreshNote(noteId) {
  const note = await db.get('notes', noteId);
  if (!note) return null;
  const entries = await listEntries(noteId);

  let text = `${note.title} ${note.place || ''}`.toLowerCase();
  let preview = '';
  let photoCount = 0;
  const cover = [];
  for (const e of entries) {
    const plain = htmlToText(e.html);
    if (text.length < SEARCH_CAP) text += ` ${plain.toLowerCase()}`;
    if (preview.length < 200 && plain) preview += `${preview ? ' ' : ''}${plain}`;
    const shots = e.photos || [];
    photoCount += shots.length;
    for (const id of shots) if (cover.length < 4) cover.push(id);
  }

  note.entryCount = entries.length;
  note.photoCount = photoCount;
  note.cover = cover;
  note.preview = preview.slice(0, 220);
  note.text = text.slice(0, SEARCH_CAP);
  note.updatedAt = Date.now();
  note.sortKey = sortKeyFor(note.date, note.createdAt);
  await db.put('notes', note);
  return note;
}

/* ---------------- stats ---------------- */

export async function stats() {
  const [notes, entries, photos] = await Promise.all([
    db.count('notes'), db.count('entries'), db.count('photos'),
  ]);
  return { notes, entries, photos };
}
