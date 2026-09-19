/* Settings: identity, theme, text size, and the backup tools. */

import { $, el, bytes } from '../util.js';
import { setSetting, stats } from '../store.js';
import { storageEstimate, requestPersistence } from '../db.js';
import { exportArchive, importArchive, download, backupFilename } from '../backup.js';
import { openSheet, toast, confirmAction } from '../ui.js';

export const THEMES = [
  { id: 'peach', name: 'peach', dots: ['#fbe8d3', '#aeb3e0', '#2e2b28'] },
  { id: 'blush', name: 'blush', dots: ['#f7ddd4', '#8ecbb0', '#2f3a2f'] },
  { id: 'linen', name: 'linen', dots: ['#f3efe6', '#c2a878', '#26251f'] },
  { id: 'sage', name: 'sage', dots: ['#e6ece1', '#9fb9d8', '#22291f'] },
  { id: 'mist', name: 'mist', dots: ['#e7ecf1', '#d5a8a0', '#1f262d'] },
  { id: 'ink', name: 'ink', dots: ['#f4f4f4', '#17181a', '#8b8f94'] },
];

let ctx = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || `${one}s`}`;
}

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.platform || '') ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ''));
}

export function initSettings(context) {
  ctx = context; // { settings, applyTheme, refresh }
}

export async function openSettings() {
  openSheet('sheet-settings');
  await renderSettings();
}

async function renderSettings() {
  const body = $('#settings-body');
  const s = ctx.settings;
  body.replaceChildren();

  /* --- install hint (iOS only offers Add to Home Screen from Safari) --- */
  if (!isStandalone()) {
    body.append(el('div', { class: 'rows', style: 'margin-bottom:16px' }, [
      el('div', { class: 'row', style: 'display:block;padding:14px' }, [
        el('div', { class: 'lab', style: 'font-weight:600;margin-bottom:4px',
          text: 'install on your phone' }),
        el('div', { class: 'val', style: 'line-height:1.5',
          text: isIOS()
            ? 'in Safari: tap the share button, then "Add to Home Screen". '
              + 'it then opens full screen and works with no signal.'
            : 'use your browser menu and choose "Install app" or '
              + '"Add to Home Screen".' }),
      ]),
    ]));
  }

  /* --- name --- */
  body.append(el('div', { class: 'field' }, [
    el('label', { for: 'set-name', text: 'your name' }),
    el('input', {
      type: 'text', id: 'set-name', value: s.ownerName || '',
      placeholder: 'who is writing?', autocapitalize: 'words',
      oninput: (ev) => {
        s.ownerName = ev.target.value.slice(0, 40);
        setSetting('ownerName', s.ownerName);
        ctx.refresh();
      },
    }),
    el('div', { class: 'hint', text: 'used for the greeting on the home screen' }),
  ]));

  /* --- appearance --- */
  body.append(el('p', { class: 'section-title', text: 'appearance' }));

  const seg = el('div', { class: 'seg' });
  [['auto', 'auto'], ['light', 'light'], ['dark', 'dark']].forEach(([id, label]) => {
    seg.append(el('button', {
      class: s.mode === id ? 'on' : '', text: label,
      onclick: () => {
        s.mode = id;
        setSetting('mode', id);
        ctx.applyTheme();
        renderSettings();
      },
    }));
  });
  body.append(seg);

  const swatches = el('div', { class: 'swatches', style: 'margin-top:12px' });
  THEMES.forEach((t) => {
    swatches.append(el('button', {
      class: `swatch${s.theme === t.id ? ' on' : ''}`,
      style: `background:${t.dots[0]};color:${t.dots[2]}`,
      onclick: () => {
        s.theme = t.id;
        setSetting('theme', t.id);
        ctx.applyTheme();
        renderSettings();
      },
    }, [
      el('div', { class: 'dots' }, t.dots.map((c) =>
        el('i', { style: `background:${c}` }))),
      el('div', { class: 'nm', text: t.name }),
    ]));
  });
  body.append(swatches);

  body.append(el('div', { class: 'field', style: 'margin-top:16px' }, [
    el('label', { for: 'set-size', text: `text size — ${Math.round(s.fontScale * 100)}%` }),
    el('input', {
      type: 'range', id: 'set-size', min: '0.85', max: '1.35', step: '0.05',
      value: String(s.fontScale), style: 'width:100%',
      oninput: (ev) => {
        s.fontScale = Number(ev.target.value);
        ctx.applyTheme();
        $('label[for="set-size"]').textContent =
          `text size — ${Math.round(s.fontScale * 100)}%`;
      },
      onchange: () => setSetting('fontScale', s.fontScale),
    }),
  ]));

  /* --- backup --- */
  body.append(el('p', { class: 'section-title', text: 'your data' }));

  const counts = await stats();
  const est = await storageEstimate();
  const last = s.lastBackupAt
    ? new Date(s.lastBackupAt).toLocaleDateString()
    : 'never';

  const progress = el('div', { class: 'progress', hidden: true }, [el('i')]);

  body.append(el('div', { class: 'rows' }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'lab', text: 'in your diary' }),
      el('span', {
        class: 'val',
        text: [
          plural(counts.notes, 'note'),
          plural(counts.entries, 'entry', 'entries'),
          plural(counts.photos, 'photo'),
        ].join(' · '),
      }),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'lab', text: 'space used' }),
      el('span', { class: 'val', text: est ? bytes(est.usage) : 'unknown' }),
    ]),
    el('button', {
      class: 'row',
      onclick: () => doExport(progress),
    }, [
      el('span', { class: 'lab', text: 'back up to a zip file' }),
      el('span', { class: 'val', text: `last: ${last}` }),
    ]),
    el('button', {
      class: 'row',
      onclick: () => pickRestore(progress),
    }, [
      el('span', { class: 'lab', text: 'restore from a backup' }),
    ]),
  ]));
  body.append(progress);
  body.append(el('div', {
    class: 'hint', style: 'margin-top:8px',
    text: 'the zip holds a readable diary.json plus every photo as a normal jpg. '
      + 'keep a copy somewhere off this phone — iCloud Drive, a computer, anywhere.',
  }));

  /* --- danger --- */
  body.append(el('p', { class: 'section-title', text: 'careful' }));
  body.append(el('div', { class: 'rows' }, [
    el('button', {
      class: 'row danger',
      onclick: async () => {
        if (!confirmAction('Erase every note, entry and photo on this device? '
          + 'This cannot be undone. Back up first.')) return;
        if (!confirmAction('Really erase everything?')) return;
        await ctx.eraseAll();
        toast('diary erased');
        renderSettings();
      },
    }, [el('span', { class: 'lab', text: 'erase everything' })]),
  ]));

  /* --- about --- */
  const persisted = await requestPersistence();
  body.append(el('p', {
    class: 'hint', style: 'margin-top:24px;text-align:center',
    text: `dia-ry · everything stays on this device${
      persisted === true ? ' · storage marked persistent' : ''}`,
  }));
}

async function doExport(progress) {
  const fill = progress.querySelector('i');
  progress.hidden = false;
  toast('building your backup…', 6000);
  try {
    const blob = await exportArchive((done, total) => {
      fill.style.width = `${Math.round((done / total) * 100)}%`;
    });
    download(blob, backupFilename());
    ctx.settings.lastBackupAt = Date.now();
    await setSetting('lastBackupAt', ctx.settings.lastBackupAt);
    toast(`backup ready — ${bytes(blob.size)}`);
    renderSettings();
  } catch (err) {
    console.error(err);
    toast(err.message || 'backup failed');
  } finally {
    progress.hidden = true;
    fill.style.width = '0';
  }
}

function pickRestore(progress) {
  const input = el('input', { type: 'file', accept: '.zip,application/zip' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const replace = confirmAction(
      'OK = replace everything with this backup.\n'
      + 'Cancel = merge it in, keeping what is already here.'
    );
    const fill = progress.querySelector('i');
    progress.hidden = false;
    toast('restoring…', 8000);
    try {
      const out = await importArchive(file, replace ? 'replace' : 'merge',
        (done, total) => {
          fill.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
        });
      toast(`restored ${out.notes} notes, ${out.entries} entries, ${out.photos} photos`);
      await ctx.reloadSettings();
      ctx.refresh();
      renderSettings();
    } catch (err) {
      console.error(err);
      toast(err.message || 'could not read that file');
    } finally {
      progress.hidden = true;
      fill.style.width = '0';
    }
  });
  input.click();
}
