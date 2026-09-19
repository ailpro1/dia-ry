/* Composer sheet: write an entry, attach photos, pick its time.
   Photos are compressed as soon as they are picked so saving is instant. */

import { $, el, timeInputValue, sanitizeHTML, isBlankHTML } from '../util.js';
import { addEntry, updateEntry, attachPhotos, removePhoto, getPhotos } from '../store.js';
import { processFile, blobURL } from '../images.js';
import { openSheet, closeSheet, toast, confirmAction } from '../ui.js';

const DRAFT_KEY = 'diary.draft';

const state = {
  noteId: null,
  entryId: null,      // set when editing
  pending: [],        // {key, blob, thumb, w, h}
  existing: [],       // photo records already saved
  removed: new Set(),
  at: Date.now(),
  busy: false,
  onSaved: null,
};

export function initComposer({ onSaved }) {
  state.onSaved = onSaved;

  $('#composer-save').addEventListener('click', save);

  $('#composer-toolbar').addEventListener('mousedown', (ev) => {
    // Keep the caret in the editor when a toolbar button is pressed.
    if (ev.target.closest('button')) ev.preventDefault();
  });
  $('#composer-toolbar').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-photo')) { $('#file-input').click(); return; }
    applyCommand(btn.dataset.cmd, btn.dataset.arg);
  });

  $('#file-input').addEventListener('change', async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    await intake(files);
  });

  const editor = $('#composer-editor');
  editor.addEventListener('input', saveDraft);
  editor.addEventListener('paste', (ev) => {
    // Paste as plain text: pasted markup from other apps is never wanted here.
    ev.preventDefault();
    const text = (ev.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  document.addEventListener('selectionchange', syncToolbar);

  $('#composer-at').addEventListener('change', (ev) => {
    const [h, m] = ev.target.value.split(':').map(Number);
    const d = new Date(state.at);
    if (!Number.isNaN(h)) { d.setHours(h, m || 0, 0, 0); state.at = d.getTime(); }
  });

  $('#sheet-composer').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]')) guardClose(ev);
  }, true);
}

function guardClose(ev) {
  if (state.busy) { ev.stopPropagation(); return; }
  if (dirty() && !confirmAction('Discard what you wrote?')) {
    ev.stopPropagation();
    ev.preventDefault();
  } else {
    clearDraft();
  }
}

function dirty() {
  const html = $('#composer-editor').innerHTML;
  return !isBlankHTML(html) || state.pending.length > 0 || state.removed.size > 0;
}

/* ---------------- opening ---------------- */

export async function openForNew(noteId, { at = Date.now() } = {}) {
  reset();
  state.noteId = noteId;
  state.at = at;
  $('#composer-title').textContent = 'add';
  $('#composer-at').value = timeInputValue(at);

  const draft = readDraft();
  $('#composer-editor').innerHTML = draft && draft.noteId === noteId
    ? sanitizeHTML(draft.html) : '';
  if (draft && draft.noteId === noteId && !isBlankHTML(draft.html)) {
    toast('restored your draft');
  }
  show();
}

export async function openForEdit(noteId, entry) {
  reset();
  state.noteId = noteId;
  state.entryId = entry.id;
  state.at = entry.at;
  $('#composer-title').textContent = 'edit';
  $('#composer-at').value = timeInputValue(entry.at);
  $('#composer-editor').innerHTML = sanitizeHTML(entry.html || '');
  state.existing = await getPhotos(entry.photos || []);
  renderTray();
  show();
}

function show() {
  openSheet('sheet-composer');
  renderTray();
  setTimeout(() => {
    const editor = $('#composer-editor');
    editor.focus();
    placeCaretAtEnd(editor);
  }, 120);
}

function reset() {
  state.entryId = null;
  state.pending = [];
  state.existing = [];
  state.removed = new Set();
  state.busy = false;
  $('#composer-editor').innerHTML = '';
  $('#composer-tray').replaceChildren();
  $('#composer-progress').hidden = true;
}

/* ---------------- photos ---------------- */

async function intake(files) {
  if (!files.length) return;
  const bar = $('#composer-progress');
  const fill = bar.querySelector('i');
  bar.hidden = false;
  state.busy = true;

  try {
    for (let i = 0; i < files.length; i += 1) {
      fill.style.width = `${Math.round((i / files.length) * 100)}%`;
      // Yield so the progress bar paints between heavy decodes.
      await new Promise((r) => setTimeout(r, 0));
      try {
        const shot = await processFile(files[i]);
        state.pending.push({ key: `p${Date.now()}-${i}`, ...shot });
        renderTray();
      } catch (err) {
        toast(`couldn't add ${files[i].name || 'a photo'}`);
      }
    }
    fill.style.width = '100%';
  } finally {
    state.busy = false;
    setTimeout(() => { bar.hidden = true; fill.style.width = '0'; }, 300);
  }
}

function renderTray() {
  const tray = $('#composer-tray');
  tray.replaceChildren();

  state.existing
    .filter((p) => !state.removed.has(p.id))
    .forEach((p) => {
      tray.append(el('figure', {}, [
        el('img', { src: blobURL(`t${p.id}`, p.thumb || p.blob), alt: '' }),
        el('button', {
          'aria-label': 'Remove photo', text: '×',
          onclick: () => { state.removed.add(p.id); renderTray(); },
        }),
      ]));
    });

  state.pending.forEach((p) => {
    tray.append(el('figure', {}, [
      el('img', { src: blobURL(p.key, p.thumb), alt: '' }),
      el('button', {
        'aria-label': 'Remove photo', text: '×',
        onclick: () => {
          state.pending = state.pending.filter((x) => x.key !== p.key);
          renderTray();
        },
      }),
    ]));
  });
}

/* ---------------- rich text ---------------- */

function applyCommand(cmd, arg) {
  if (!cmd) return;
  $('#composer-editor').focus();
  if (cmd === 'hiliteColor') {
    // Safari only honours hiliteColor; toggle by checking the current state.
    const on = queryState('hiliteColor');
    document.execCommand('hiliteColor', false, on ? 'transparent' : '#ffd97a');
  } else if (cmd === 'formatBlock') {
    const on = document.queryCommandValue('formatBlock').toLowerCase() === arg;
    document.execCommand('formatBlock', false, on ? 'div' : arg);
  } else {
    document.execCommand(cmd, false, null);
  }
  syncToolbar();
  saveDraft();
}

function queryState(cmd) {
  try {
    const v = document.queryCommandValue(cmd);
    return v && v !== 'transparent' && v !== 'rgba(0, 0, 0, 0)';
  } catch (_) { return false; }
}

function syncToolbar() {
  const editor = $('#composer-editor');
  if (!document.activeElement || !editor.contains(document.activeElement)) return;
  document.querySelectorAll('#composer-toolbar button[data-cmd]').forEach((btn) => {
    const cmd = btn.dataset.cmd;
    let on = false;
    try {
      on = cmd === 'hiliteColor' ? queryState(cmd)
        : cmd === 'formatBlock'
          ? document.queryCommandValue('formatBlock').toLowerCase() === btn.dataset.arg
          : document.queryCommandState(cmd);
    } catch (_) { on = false; }
    btn.classList.toggle('on', !!on);
  });
}

function placeCaretAtEnd(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ---------------- drafts ---------------- */

function saveDraft() {
  if (state.entryId) return; // edits are not drafted; cancel means cancel
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      noteId: state.noteId, html: $('#composer-editor').innerHTML, at: Date.now(),
    }));
  } catch (_) { /* private mode / quota — drafting is a nicety */ }
}

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); }
  catch (_) { return null; }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
}

/* ---------------- saving ---------------- */

async function save() {
  if (state.busy) { toast('still adding photos…'); return; }
  const html = sanitizeHTML($('#composer-editor').innerHTML);
  const hasText = !isBlankHTML(html);
  const keptExisting = state.existing.filter((p) => !state.removed.has(p.id));

  if (!hasText && !state.pending.length && !keptExisting.length) {
    toast('nothing to save yet');
    return;
  }

  const btn = $('#composer-save');
  btn.disabled = true;
  state.busy = true;

  try {
    let entryId = state.entryId;
    if (entryId) {
      await updateEntry(entryId, { at: state.at, html });
      for (const id of state.removed) await removePhoto(id);
    } else {
      const entry = await addEntry(state.noteId, { at: state.at, html });
      entryId = entry.id;
    }

    if (state.pending.length) {
      await attachPhotos(entryId, state.pending);
    }

    clearDraft();
    state.busy = false;
    closeSheet('sheet-composer');
    reset();
    await state.onSaved();
  } catch (err) {
    console.error(err);
    toast(err.message || 'could not save — nothing was lost, try again');
  } finally {
    state.busy = false;
    btn.disabled = false;
  }
}
