/* The shelf: every notebook standing on a plank, newest shelf at the top. */

import { $, el, debounce } from '../util.js';
import { listNotebooks, notebookCounts, listNotes, onThisDay } from '../store.js';
import { coverURL } from '../covers.js';

let handlers = {};
const state = { query: '', current: null };

export function initShelf(opts) {
  handlers = opts;

  const input = $('#search-input');
  input.addEventListener('input', debounce(() => {
    state.query = input.value.trim();
    renderSearch();
  }, 220));

  $('#btn-search').addEventListener('click', () => {
    const bar = $('#searchbar');
    bar.hidden = !bar.hidden;
    if (!bar.hidden) { input.focus(); return; }
    input.value = '';
    state.query = '';
    renderSearch();
  });

  $('#shelf').addEventListener('click', (ev) => {
    const echo = ev.target.closest('.echo');
    if (echo) { handlers.onOpenNote(echo.dataset.id); return; }
    const add = ev.target.closest('.book.add');
    if (add) { handlers.onNewNotebook(); return; }
    const book = ev.target.closest('[data-nb]');
    if (book) handlers.onOpen(book.dataset.nb);
  });

  $('#search-results').addEventListener('click', (ev) => {
    const card = ev.target.closest('.note-card');
    if (card) handlers.onOpenNote(card.dataset.id);
  });
}

export async function renderShelf(currentId) {
  state.current = currentId;
  const [books, { counts, total }] = await Promise.all([
    listNotebooks(), notebookCounts(),
  ]);

  $('#shelf-sub').textContent =
    `${plural(books.length, 'notebook')} · ${plural(total, 'note')} in all`;

  const host = $('#shelf');
  host.replaceChildren();
  await renderEchoes(host);

  // Two to a shelf, with an "add" slot trailing the last one.
  const slots = [...books.map((b) => ({ book: b })), { add: true }];
  for (let i = 0; i < slots.length; i += 2) {
    host.append(shelfRow(slots.slice(i, i + 2), counts, currentId));
  }
  await renderSearch();
}

/** "on this day" — what was written on this date in earlier years. */
async function renderEchoes(host) {
  let past;
  try { past = await onThisDay(); } catch (_) { return; }
  for (const { note, years } of past.slice(0, 2)) {
    host.append(el('button', { class: 'echo', 'data-id': note.id }, [
      el('div', {
        class: 'when',
        text: years === 1 ? 'a year ago today' : `${years} years ago today`,
      }),
      el('div', { class: 'what', text: note.title || note.date }),
    ]));
  }
}

function shelfRow(slots, counts, currentId) {
  const books = el('div', { class: 'shelf-books' });
  const labels = el('div', { class: 'shelf-labels' });

  for (const slot of slots) {
    if (slot.add) {
      books.append(el('button', {
        class: 'book add', 'aria-label': 'New notebook',
      }, [el('span', { text: '+' })]));
      labels.append(el('div', {}));
      continue;
    }
    const b = slot.book;
    const count = counts[b.id] || 0;
    books.append(el('button', { class: 'book', 'data-nb': b.id }, [
      el('img', {
        src: coverURL(b.cover?.design, b.cover?.color, b.name),
        alt: b.name || 'notebook', loading: 'lazy',
      }),
    ]));
    labels.append(el('div', { 'data-nb': b.id }, [
      el('div', { class: 'nb-name', text: b.name || 'untitled' }),
      el('div', { class: 'nb-meta' }, [
        b.id === currentId ? el('span', { class: 'now', text: 'current · ' }) : null,
        plural(count, 'note'),
      ]),
    ]));
  }

  return el('div', { class: 'shelf-row' }, [
    books,
    el('div', { class: 'plank' }),
    labels,
  ]);
}

/** Search spans every notebook, so results replace the shelf while typing. */
async function renderSearch() {
  const host = $('#search-results');
  const shelf = $('#shelf');
  if (!state.query) {
    host.hidden = true;
    host.replaceChildren();
    shelf.hidden = false;
    return;
  }

  shelf.hidden = true;
  host.hidden = false;
  const { notes } = await listNotes({ query: state.query, limit: 40 });
  host.replaceChildren();

  if (!notes.length) {
    host.append(el('div', { class: 'empty' }, [
      el('strong', { text: 'nothing found' }), 'try another word',
    ]));
    return;
  }
  for (const note of notes) host.append(await handlers.card(note));
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || `${one}s`}`;
}
