/* One notebook's timeline: its notes, newest first, paged. */

import { $, el, monthLabel, relativeDay } from '../util.js';
import { listNotes, listPinned, getPhotos } from '../store.js';
import { blobURL } from '../images.js';

const PAGE = 20;

const state = {
  notebookId: null,
  cursor: null,
  done: false,
  loading: false,
  lastMonth: null,
  observer: null,
  shown: new Set(),
  onOpenNote: () => {},
};

export function initHome({ onOpenNote }) {
  state.onOpenNote = onOpenNote;

  state.observer = new IntersectionObserver((rows) => {
    if (rows.some((r) => r.isIntersecting)) loadMore();
  }, { rootMargin: '600px' });

  $('#home-list').addEventListener('click', (ev) => {
    const card = ev.target.closest('.note-card');
    if (card) state.onOpenNote(card.dataset.id);
  });
}

export async function reload(notebookId = state.notebookId) {
  state.notebookId = notebookId;
  state.cursor = null;
  state.done = false;
  state.lastMonth = null;
  state.shown = new Set();

  const list = $('#home-list');
  list.replaceChildren();

  const pinned = await listPinned(notebookId);
  if (pinned.length) {
    list.append(el('h2', { class: 'month-head', text: 'pinned' }));
    for (const note of pinned) {
      state.shown.add(note.id);
      list.append(await noteCard(note));
    }
  }
  return loadMore();
}

async function loadMore() {
  if (state.loading || state.done) return;
  state.loading = true;
  const list = $('#home-list');
  const sentinel = list.querySelector('.loading-more');
  if (sentinel) sentinel.remove();

  try {
    const { notes, done, cursor } = await listNotes({
      cursor: state.cursor, limit: PAGE, notebookId: state.notebookId,
    });
    state.cursor = cursor || state.cursor;
    state.done = done;

    if (!notes.length && !list.querySelector('.note-card')) {
      list.append(el('div', { class: 'empty' }, [
        el('strong', { text: 'nothing here yet' }),
        'tap + write to start today',
      ]));
      return;
    }

    for (const note of notes) {
      if (state.shown.has(note.id)) continue;
      state.shown.add(note.id);
      const month = monthLabel(note.date);
      if (month !== state.lastMonth) {
        state.lastMonth = month;
        list.append(el('h2', { class: 'month-head', text: month }));
      }
      list.append(await noteCard(note));
    }

    if (!state.done) {
      const more = el('div', { class: 'loading-more', text: '···' });
      list.append(more);
      state.observer.observe(more);
    }
  } finally {
    state.loading = false;
  }
}

/** One note as a card. Shared with the shelf's search results. */
export async function noteCard(note) {
  // An untitled note shows its date as the heading, so drop it from the meta.
  const meta = note.title ? [relativeDay(note.date)] : [];
  if (note.place) meta.push(note.place);
  if (note.photoCount) {
    meta.push(`${note.photoCount} photo${note.photoCount > 1 ? 's' : ''}`);
  }

  const node = el('button', { class: 'note-card', 'data-id': note.id }, [
    (meta.length || note.pinned)
      ? el('div', { class: 'meta' }, [
        note.pinned ? el('span', { class: 'pin', text: '★' }) : null,
        meta.join(' · '),
      ])
      : null,
    el('h2', { text: note.title || relativeDay(note.date) }),
  ]);

  if (note.preview) node.append(el('div', { class: 'excerpt', text: note.preview }));

  if (note.cover && note.cover.length) {
    const photos = await getPhotos(note.cover.slice(0, 3));
    if (photos.length) {
      const strip = el('div', { class: 'strip' });
      photos.forEach((p) => {
        strip.append(el('img', {
          src: blobURL(`t${p.id}`, p.thumb || p.blob), alt: '', loading: 'lazy',
        }));
      });
      if (note.photoCount > photos.length) {
        strip.append(el('div', { class: 'more', text: `+${note.photoCount - photos.length}` }));
      }
      node.append(strip);
    }
  }
  return node;
}

export function setGreeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'still up' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  $('#hello').textContent = name ? `${part}, ${name}` : part;
}
