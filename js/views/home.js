/* Home: the timeline of notes, newest first, with search and paging. */

import { $, el, monthLabel, relativeDay, shortDate, debounce } from '../util.js';
import { listNotes, listPinned, getPhotos, onThisDay } from '../store.js';
import { blobURL } from '../images.js';

const PAGE = 20;

const state = {
  cursor: null,
  done: false,
  loading: false,
  query: '',
  lastMonth: null,
  observer: null,
  shown: new Set(),
};

export function initHome({ onOpenNote }) {
  const list = $('#home-list');
  state.onOpenNote = onOpenNote;

  const input = $('#search-input');
  input.addEventListener('input', debounce(() => {
    state.query = input.value;
    reload();
  }, 220));

  $('#btn-search').addEventListener('click', () => {
    const bar = $('#searchbar');
    bar.hidden = !bar.hidden;
    if (!bar.hidden) input.focus();
    else if (state.query) { input.value = ''; state.query = ''; reload(); }
  });

  // Infinite scroll via a sentinel at the end of the list.
  state.observer = new IntersectionObserver((rows) => {
    if (rows.some((r) => r.isIntersecting)) loadMore();
  }, { rootMargin: '600px' });

  list.addEventListener('click', (ev) => {
    const card = ev.target.closest('.note-card, .echo');
    if (card) state.onOpenNote(card.dataset.id);
  });
}

export async function reload() {
  state.cursor = null;
  state.done = false;
  state.lastMonth = null;
  state.shown = new Set();
  const list = $('#home-list');
  list.replaceChildren();

  if (!state.query) await renderEchoes(list);

  // Pinned notes ride above the timeline, and only when not searching.
  if (!state.query) {
    const pinned = await listPinned();
    if (pinned.length) {
      list.append(el('h2', { class: 'month-head', text: 'pinned' }));
      for (const note of pinned) {
        state.shown.add(note.id);
        list.append(await card(note));
      }
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
      cursor: state.cursor, limit: PAGE, query: state.query,
    });
    state.cursor = cursor || state.cursor;
    state.done = done;

    if (!notes.length && !list.querySelector('.note-card')) {
      list.append(emptyState(state.query));
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
      list.append(await card(note));
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

/** "on this day" — what was written on this date in earlier years. */
async function renderEchoes(list) {
  let past;
  try { past = await onThisDay(); } catch (_) { return; }
  if (!past.length) return;

  for (const { note, years } of past.slice(0, 2)) {
    list.append(el('button', { class: 'echo', 'data-id': note.id }, [
      el('div', { class: 'when', text: years === 1 ? 'a year ago today' : `${years} years ago today` }),
      el('div', { class: 'what', text: headingFor(note) }),
    ]));
  }
}

/** Untitled notes read as their date rather than as "untitled". */
function headingFor(note) {
  return note.title || shortDate(note.date);
}

function emptyState(query) {
  return el('div', { class: 'empty' }, [
    el('strong', { text: query ? 'nothing found' : 'nothing here yet' }),
    query ? 'try another word' : 'tap + new note to start today',
  ]);
}

async function card(note) {
  // An untitled note shows its date as the heading, so drop it from the meta.
  const meta = note.title ? [relativeDay(note.date)] : [];
  if (note.place) meta.push(note.place);
  if (note.photoCount) {
    meta.push(`${note.photoCount} photo${note.photoCount > 1 ? 's' : ''}`);
  }

  const node = el('button', { class: 'note-card', 'data-id': note.id }, [
    // An untitled note with no place has nothing to put here; skip the row
    // rather than leave a gap above the heading.
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
