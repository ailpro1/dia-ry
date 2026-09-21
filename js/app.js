/* App entry: routing, theme, wiring. */

import { $, isoDate, el } from './util.js';
import { db, requestPersistence } from './db.js';
import { loadSettings, setSetting, createNote, getNote, updateNote, deleteNote,
  listEntries, todayNote, restore, listNotebooks, getNotebook, createNotebook,
  updateNotebook, deleteNotebook, notebookCounts } from './store.js';
import { DEFAULT_NOTEBOOK } from './db.js';
import { DESIGNS, COLORS, coverURL } from './covers.js';
import { releaseAll } from './images.js';
import { wireSheets, openSheet, closeSheet, closeLightbox, toast, toastAction,
  topOverlayId, anyOverlayOpen, confirmAction } from './ui.js';
import { initHome, reload as reloadHome, setGreeting, noteCard }
  from './views/home.js';
import { initShelf, renderShelf } from './views/shelf.js';
import { initNote, render as renderNote, currentNoteId } from './views/note.js';
import { initComposer, openForNew, openForEdit, composerHasWork }
  from './views/composer.js';
import { initUpdates } from './update.js';
import { initSettings, openSettings } from './views/settings.js';

const THEME_BG = {
  // Kept in sync with --bg in css/app.css so the iOS status bar matches.
  peach: ['#fbe8d3', '#1b1714'],
  blush: ['#f7ddd4', '#1a1513'],
  linen: ['#f3efe6', '#16161a'],
  sage: ['#e6ece1', '#13170f'],
  mist: ['#e7ecf1', '#101418'],
  ink: ['#f4f4f4', '#0d0e10'],
};

let settings = null;

/* The splash covers the blank moment while modules and the database open.
   It is held for a beat so it reads as a greeting rather than a flicker, and
   never for long enough to get in the way. */
const SPLASH_MIN_MS = 700;
const SPLASH_MAX_MS = 3500;
const splashShownAt = Date.now();
let splashDone = false;

function hideSplash() {
  if (splashDone) return;
  splashDone = true;
  const node = document.getElementById('splash');
  if (!node) return;
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
  setTimeout(() => {
    node.classList.add('gone');
    setTimeout(() => node.remove(), 400);
  }, wait);
}

// A failure to boot must not leave the splash sitting there for ever.
setTimeout(hideSplash, SPLASH_MAX_MS);

/* ---------------- theme ---------------- */

function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme() {
  const root = document.documentElement;
  const dark = settings.mode === 'dark' || (settings.mode === 'auto' && prefersDark());
  root.dataset.theme = THEME_BG[settings.theme] ? settings.theme : 'peach';
  root.dataset.mode = dark ? 'dark' : 'light';
  root.style.setProperty('--font-scale', String(settings.fontScale || 1));
  const bg = (THEME_BG[root.dataset.theme] || THEME_BG.peach)[dark ? 1 : 0];
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    .setAttribute('content', dark ? 'black-translucent' : 'default');
}

/* ---------------- routing ---------------- */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.toggle('is-active', s.id === id);
  });
  window.scrollTo(0, 0);
}

async function route() {
  const hash = location.hash || '#/';

  const noteMatch = hash.match(/^#\/note\/([\w-]+)$/);
  if (noteMatch) {
    const note = await getNote(noteMatch[1]);
    if (!note) { location.hash = '#/'; return; }
    showScreen('screen-note');
    await renderNote(note.id);
    return;
  }

  const bookMatch = hash.match(/^#\/nb\/([\w-]+)$/);
  if (bookMatch) {
    const book = await getNotebook(bookMatch[1]);
    if (!book) { location.hash = '#/'; return; }
    await setCurrentNotebook(book.id);
    showScreen('screen-home');
    $('#nb-name').textContent = book.name || 'untitled';
    const { counts } = await notebookCounts();
    const n = counts[book.id] || 0;
    $('#nb-count').textContent = `${n} note${n === 1 ? '' : 's'}`;
    await reloadHome(book.id);
    return;
  }

  showScreen('screen-shelf');
  setGreeting(settings.ownerName);
  await renderShelf(settings.currentNotebook);
}

/** The notebook quick capture writes into: whichever was opened last. */
async function setCurrentNotebook(id) {
  if (settings.currentNotebook === id) return;
  settings.currentNotebook = id;
  await setSetting('currentNotebook', id);
}

/* Where the last hashchange came from, or null when nothing has been
   navigated yet. Real back is nicer when it applies (it keeps scroll position
   and the forward entry), but after a note moves notebooks the previous entry
   is the wrong shelf — and on a resumed cold start there is no entry behind
   us at all, so pressing back would leave the app. */
let prevHash = null;

function goBackTo(hash) {
  if (prevHash === hash && location.hash !== hash) history.back();
  else if (location.hash !== hash) location.hash = hash;
  else route();
}

function currentBook() {
  const m = (location.hash || '').match(/^#\/nb\/([\w-]+)$/);
  return m ? m[1] : settings.currentNotebook;
}

/* ---------------- quick capture ---------------- */

/** Straight into writing: today's page, made if it does not exist yet. */
async function quickCapture(notebookId = settings.currentNotebook) {
  const book = await getNotebook(notebookId) || (await listNotebooks())[0];
  const note = await todayNote(book.id);
  const target = `#/note/${note.id}`;
  // Compare against the route, not the note view's last-rendered id: that id
  // survives going home, which would leave the composer saving into a screen
  // nobody is looking at.
  const alreadyThere = location.hash === target;
  if (!alreadyThere) location.hash = target;
  // Let the note screen paint under the sheet before it slides up.
  setTimeout(() => openForNew(note.id), alreadyThere ? 0 : 260);
}

/* ---------------- note details sheet ---------------- */

let noteFormId = null;
let newNoteNotebook = null;

async function openNoteForm(note, notebookId = null) {
  noteFormId = note ? note.id : null;
  newNoteNotebook = notebookId || settings.currentNotebook;

  const books = await listNotebooks();
  const chosen = note ? note.notebookId : newNoteNotebook;
  $('#nf-notebook').replaceChildren(...books.map((b) => el('option', {
    value: b.id,
    selected: b.id === chosen,
  }, [b.name || 'untitled'])));
  $('#noteform-title').textContent = note ? 'note details' : 'new note';
  $('#nf-title').value = note ? note.title : '';
  $('#nf-date').value = note ? note.date : isoDate();
  $('#nf-place').value = note ? note.place || '' : '';
  $('#nf-danger').hidden = !note;
  openSheet('sheet-note');
  if (!note) setTimeout(() => $('#nf-title').focus(), 150);
}

async function saveNoteForm() {
  const title = $('#nf-title').value.trim();
  const date = $('#nf-date').value || isoDate();
  const place = $('#nf-place').value.trim();
  const notebookId = $('#nf-notebook').value || settings.currentNotebook;

  if (noteFormId) {
    await updateNote(noteFormId, { title, date, place, notebookId });
    closeSheet('sheet-note');
    await renderNote(noteFormId);
    toast('saved');
  } else {
    const note = await createNote({
      title, date, place, notebookId: notebookId || DEFAULT_NOTEBOOK,
    });
    closeSheet('sheet-note');
    location.hash = `#/note/${note.id}`;
    // Straight into writing — that is the whole point of a quick diary.
    setTimeout(() => openForNew(note.id), 260);
  }
}

/* ---------------- notebook sheet ---------------- */

let nbFormId = null;
let nbDraft = { design: 'kraft', color: 'sand' };

async function openNotebookForm(book) {
  nbFormId = book ? book.id : null;
  nbDraft = book
    ? { design: book.cover?.design || 'kraft', color: book.cover?.color || 'sand' }
    : { design: 'kraft', color: 'sand' };

  $('#nbform-title').textContent = book ? 'notebook' : 'new notebook';
  $('#nbf-name').value = book ? book.name : '';

  const books = await listNotebooks();
  // The last notebook cannot go: every note needs a shelf to stand on.
  const removable = !!book && books.length > 1;
  $('#nbf-danger').hidden = !removable;
  if (removable) {
    const { counts } = await notebookCounts();
    const n = counts[book.id] || 0;
    $('#nbf-delete-note').textContent = n ? `${n} note${n === 1 ? '' : 's'} too` : '';
  }

  buildCoverPickers();
  openSheet('sheet-notebook');
  if (!book) setTimeout(() => $('#nbf-name').focus(), 150);
}

function buildCoverPickers() {
  const name = () => $('#nbf-name').value.trim();

  const designs = $('#nbf-designs');
  designs.replaceChildren(...DESIGNS.map((d) => el('button', {
    class: d === nbDraft.design ? 'on' : '',
    'aria-label': d,
    onclick: () => { nbDraft.design = d; buildCoverPickers(); },
  }, [el('img', { src: coverURL(d, nbDraft.color, ''), alt: '' })])));

  const colors = $('#nbf-colors');
  colors.replaceChildren(...Object.keys(COLORS).map((c) => el('button', {
    class: c === nbDraft.color ? 'on' : '',
    'aria-label': c,
    onclick: () => { nbDraft.color = c; buildCoverPickers(); },
  }, [el('span', {
    class: 'chip',
    style: `display:block;background:${COLORS[c].base}`,
  })])));

  $('#nbf-preview').src = coverURL(nbDraft.design, nbDraft.color, name());
}

async function saveNotebookForm() {
  const name = $('#nbf-name').value.trim();
  const cover = { ...nbDraft };
  if (nbFormId) {
    await updateNotebook(nbFormId, { name, cover });
    closeSheet('sheet-notebook');
    await route();
    toast('saved');
  } else {
    const book = await createNotebook({ name, cover });
    await setCurrentNotebook(book.id);
    closeSheet('sheet-notebook');
    location.hash = `#/nb/${book.id}`;
  }
}

/**
 * Open where the diary was left. Only on a cold start with no route of its
 * own — tapping back to the shelf must still land on the shelf.
 */
async function resumeLastNotebook() {
  if (location.hash && location.hash !== '#/') return;
  if (!settings.currentNotebook) return;
  const book = await getNotebook(settings.currentNotebook);
  if (!book) return;
  // replaceState, so the first back press leaves the app rather than
  // bouncing between the shelf and the notebook.
  history.replaceState(null, '', `#/nb/${book.id}`);
}

/* ---------------- boot ---------------- */

async function boot() {
  settings = await loadSettings();
  applyTheme();
  wireSheets();

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.mode === 'auto') applyTheme();
  });

  initHome({
    onOpenNote: (id) => { location.hash = `#/note/${id}`; },
  });

  initShelf({
    onOpen: (id) => { location.hash = `#/nb/${id}`; },
    onOpenNote: (id) => { location.hash = `#/note/${id}`; },
    onNewNotebook: () => openNotebookForm(null),
    card: noteCard,
  });

  initNote({
    onChanged: () => { /* home reloads on navigation */ },
    onMissing: () => { location.hash = '#/'; },
    onEditEntry: async (entryId) => {
      const entries = await listEntries(currentNoteId());
      const entry = entries.find((e) => e.id === entryId);
      if (entry) openForEdit(currentNoteId(), entry);
    },
  });

  initComposer({
    onSaved: async () => {
      // Re-render whichever screen is actually on show.
      const id = currentNoteId();
      if (id && location.hash === `#/note/${id}`) await renderNote(id);
      else await route();
    },
  });

  initSettings({
    settings,
    applyTheme,
    refresh: () => setGreeting(settings.ownerName),
    reloadSettings: async () => {
      const fresh = await loadSettings();
      Object.assign(settings, fresh);
      applyTheme();
      setGreeting(settings.ownerName);
    },
    eraseAll: async () => {
      await db.write(['notes', 'entries', 'photos', 'notebooks'], (tx) => {
        tx.objectStore('notes').clear();
        tx.objectStore('entries').clear();
        tx.objectStore('photos').clear();
        tx.objectStore('notebooks').clear();
      });
      releaseAll();
      settings.currentNotebook = '';
      await setSetting('currentNotebook', '');
      location.hash = '#/';
      await route();
    },
  });

  /* buttons */
  $('#btn-write').addEventListener('click', () => quickCapture());
  $('#btn-write-here').addEventListener('click', () => quickCapture(currentBook()));
  $('#btn-new').addEventListener('click', () => openNoteForm(null, currentBook()));
  $('#home-back').addEventListener('click', () => goBackTo('#/'));
  $('#nb-edit').addEventListener('click', async () => {
    openNotebookForm(await getNotebook(currentBook()));
  });
  $('#nbform-save').addEventListener('click', saveNotebookForm);
  $('#nbf-name').addEventListener('input', () => {
    $('#nbf-preview').src = coverURL(nbDraft.design, nbDraft.color,
      $('#nbf-name').value.trim());
  });
  $('#nbf-delete').addEventListener('click', async () => {
    if (!nbFormId) return;
    if (!confirmAction('Delete this notebook and every note in it?')) return;
    const bundle = await deleteNotebook(nbFormId);
    closeSheet('sheet-notebook');
    location.hash = '#/';
    await route();
    toastAction('notebook deleted', 'undo', async () => {
      await restore(bundle);
      toast('notebook restored');
      await route();
    });
  });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#noteform-save').addEventListener('click', saveNoteForm);
  $('#nf-title').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); saveNoteForm(); }
  });
  $('#nf-delete').addEventListener('click', async () => {
    if (!noteFormId) return;
    if (!confirmAction('Delete this note, its entries and all its photos?')) return;
    const bundle = await deleteNote(noteFormId);
    closeSheet('sheet-note');
    location.hash = bundle ? `#/nb/${bundle.notes[0].notebookId}` : '#/';
    toastAction('note deleted', 'undo', async () => {
      await restore(bundle);
      location.hash = `#/note/${bundle.notes[0].id}`;
      toast('note restored');
    });
  });

  $('#note-back').addEventListener('click', async () => {
    const note = await getNote(currentNoteId());
    goBackTo(note ? `#/nb/${note.notebookId}` : '#/');
  });
  $('#btn-add-entry').addEventListener('click', () => openForNew(currentNoteId()));
  $('#note-edit').addEventListener('click', async () => {
    openNoteForm(await getNote(currentNoteId()));
  });
  $('#note-pin').addEventListener('click', async () => {
    const note = await getNote(currentNoteId());
    await updateNote(note.id, { pinned: !note.pinned });
    await renderNote(note.id);
    toast(note.pinned ? 'unpinned' : 'pinned');
  });

  $('#lightbox-close').addEventListener('click', closeLightbox);

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const top = topOverlayId();
    if (top === 'lightbox') closeLightbox();
    else if (top) closeSheet(top);
  });

  window.addEventListener('hashchange', (ev) => {
    try { prevHash = new URL(ev.oldURL).hash || '#/'; } catch (_) { prevHash = '#/'; }
    route();
  });

  await resumeLastNotebook();
  await route();
  hideSplash();
  await requestPersistence();

  initUpdates({
    // Never reload out from under an open sheet or a half-written entry.
    isBusy: () => composerHasWork() || anyOverlayOpen(),
  });
  nudgeBackup();
}

function nudgeBackup() {
  const days = settings.backupReminderDays || 30;
  const since = Date.now() - (settings.lastBackupAt || 0);
  if (settings.lastBackupAt && since < days * 864e5) return;
  db.count('notes').then((n) => {
    if (n < 3) return;
    setTimeout(() => toast('tip: back up your diary from settings', 4000), 2500);
  });
}

boot().catch((err) => {
  console.error(err);
  hideSplash();
  document.body.append(el('div', {
    style: 'padding:40px 20px;font-family:system-ui;text-align:center',
    text: `dia-ry could not start: ${err.message}`,
  }));
});
