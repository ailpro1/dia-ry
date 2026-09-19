/* App entry: routing, theme, wiring. */

import { $, isoDate, el } from './util.js';
import { db, requestPersistence } from './db.js';
import { loadSettings, createNote, getNote, updateNote, deleteNote, listEntries }
  from './store.js';
import { releaseAll } from './images.js';
import { wireSheets, openSheet, closeSheet, closeLightbox, toast, topOverlayId,
  anyOverlayOpen, confirmAction } from './ui.js';
import { initHome, reload as reloadHome, setGreeting } from './views/home.js';
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
  showScreen('screen-home');
  setGreeting(settings.ownerName);
  await reloadHome();
}

function goHome() {
  if (location.hash && location.hash !== '#/') history.back();
  else location.hash = '#/';
}

/* ---------------- note details sheet ---------------- */

let noteFormId = null;

function openNoteForm(note) {
  noteFormId = note ? note.id : null;
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

  if (noteFormId) {
    await updateNote(noteFormId, { title, date, place });
    closeSheet('sheet-note');
    await renderNote(noteFormId);
    toast('saved');
  } else {
    const note = await createNote({ title, date, place });
    closeSheet('sheet-note');
    location.hash = `#/note/${note.id}`;
    // Straight into writing — that is the whole point of a quick diary.
    setTimeout(() => openForNew(note.id), 260);
  }
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
      if (currentNoteId()) await renderNote(currentNoteId());
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
      await db.write(['notes', 'entries', 'photos'], (tx) => {
        tx.objectStore('notes').clear();
        tx.objectStore('entries').clear();
        tx.objectStore('photos').clear();
      });
      releaseAll();
      location.hash = '#/';
      await reloadHome();
    },
  });

  /* buttons */
  $('#btn-new').addEventListener('click', () => openNoteForm(null));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#noteform-save').addEventListener('click', saveNoteForm);
  $('#nf-title').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); saveNoteForm(); }
  });
  $('#nf-delete').addEventListener('click', async () => {
    if (!noteFormId) return;
    if (!confirmAction('Delete this note, its entries and all its photos?')) return;
    await deleteNote(noteFormId);
    closeSheet('sheet-note');
    location.hash = '#/';
    toast('note deleted');
  });

  $('#note-back').addEventListener('click', goHome);
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

  window.addEventListener('hashchange', route);
  await route();
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
  document.body.append(el('div', {
    style: 'padding:40px 20px;font-family:system-ui;text-align:center',
    text: `dia-ry could not start: ${err.message}`,
  }));
});
