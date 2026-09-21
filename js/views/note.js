/* Note screen: the entry timeline, styled after a paper diary page. */

import { $, el, clockTime, shortDate, sanitizeHTML } from '../util.js';
import { getNote, listEntries, getPhotos, deleteEntry, restore } from '../store.js';
import { blobURL } from '../images.js';
import { openLightbox, toast, toastAction } from '../ui.js';

let current = null;   // note id
let handlers = {};

export function initNote(opts) {
  handlers = opts;

  $('#note-entries').addEventListener('click', async (ev) => {
    const shot = ev.target.closest('[data-photo-index]');
    if (shot) {
      const entryId = shot.closest('.entry').dataset.id;
      const entry = (await listEntries(current)).find((e) => e.id === entryId);
      const photos = await getPhotos(entry.photos || []);
      openLightbox(photos, Number(shot.dataset.photoIndex));
      return;
    }
    const stamp = ev.target.closest('.at');
    if (stamp) {
      const row = stamp.closest('.entry');
      const wasOpen = row.classList.contains('is-open');
      $('#note-entries').querySelectorAll('.entry.is-open')
        .forEach((r) => r.classList.remove('is-open'));
      row.classList.toggle('is-open', !wasOpen);
      return;
    }
    const editBtn = ev.target.closest('[data-edit-entry]');
    if (editBtn) {
      handlers.onEditEntry(editBtn.closest('.entry').dataset.id);
      return;
    }
    const delBtn = ev.target.closest('[data-delete-entry]');
    if (delBtn) {
      const bundle = await deleteEntry(delBtn.closest('.entry').dataset.id);
      await render(current);
      handlers.onChanged();
      toastAction('entry deleted', 'undo', async () => {
        await restore(bundle);
        await render(current);
        handlers.onChanged();
        toast('entry restored');
      });
    }
  });
}

export function currentNoteId() {
  return current;
}

export async function render(noteId) {
  current = noteId;
  const note = await getNote(noteId);
  if (!note) { handlers.onMissing(); return; }

  // Untitled notes wear their date as the heading instead of the word
  // "untitled", so a quick-captured page still reads like a diary page.
  const bits = note.title ? [shortDate(note.date)] : [];
  if (note.place) bits.push(note.place);
  $('#note-sub').textContent = bits.join(' · ');
  $('#note-title').textContent = note.title || shortDate(note.date);
  $('#note-pin').style.color = note.pinned ? 'var(--tint)' : '';
  $('#note-pin').setAttribute('aria-pressed', note.pinned ? 'true' : 'false');

  const entries = await listEntries(noteId);
  const host = $('#note-entries');
  host.replaceChildren();

  if (!entries.length) {
    host.append(el('div', { class: 'empty' }, [
      el('strong', { text: 'empty page' }),
      'tap + add to this note',
    ]));
    return;
  }

  for (const entry of entries) {
    host.append(await entryNode(entry));
  }
}

async function entryNode(entry) {
  const body = el('div', { class: 'body' });

  // Photos first, words underneath — a moment is seen before it is read.
  const photos = await getPhotos(entry.photos || []);
  if (photos.length) {
    const strip = el('div', {
      class: 'shots',
      'data-count': String(Math.min(photos.length, 3)),
      'data-many': photos.length > 3 ? '' : null,
    });
    photos.forEach((p, i) => {
      strip.append(el('button', { 'data-photo-index': i, 'aria-label': 'Open photo' }, [
        el('img', {
          src: blobURL(`t${p.id}`, p.thumb || p.blob),
          alt: '', loading: 'lazy', decoding: 'async',
        }),
      ]));
    });
    body.append(strip);
  }

  if (entry.html && entry.html.trim()) {
    body.append(el('div', { class: 'text', html: sanitizeHTML(entry.html) }));
  }

  body.append(el('div', { class: 'entry-tools' }, [
    el('button', { 'data-edit-entry': '', text: 'edit' }),
    el('button', { 'data-delete-entry': '', text: 'delete' }),
  ]));

  return el('div', { class: 'entry', 'data-id': entry.id }, [
    el('button', {
      class: 'at', text: clockTime(entry.at),
      'aria-label': `Entry at ${clockTime(entry.at)} — tap for options`,
    }),
    body,
  ]);
}
