/* Shared UI bits: sheets, toast, lightbox, confirm. */

import { $, $$, el } from './util.js';
import { blobURL } from './images.js';

let openSheets = [];

export function openSheet(id, onClose) {
  const sheet = document.getElementById(id);
  if (!sheet) return null;
  sheet.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  openSheets.push({ sheet, onClose });
  return sheet;
}

export function closeSheet(id) {
  const sheet = id ? document.getElementById(id) : openSheets.at(-1)?.sheet;
  if (!sheet) return;
  const idx = openSheets.findIndex((s) => s.sheet === sheet);
  const rec = idx >= 0 ? openSheets.splice(idx, 1)[0] : null;
  sheet.classList.remove('is-open');
  if (!openSheets.length) document.body.style.overflow = '';
  if (rec && rec.onClose) rec.onClose();
}

export function isSheetOpen(id) {
  return document.getElementById(id)?.classList.contains('is-open') || false;
}

export function wireSheets() {
  $$('.sheet').forEach((sheet) => {
    sheet.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close]')) closeSheet(sheet.id);
    });
  });
}

let toastTimer;

export function toast(message, ms = 2200) {
  showToast(message, null, null, ms);
}

/** A toast with one tappable action, used for undo. */
export function toastAction(message, label, onAction, ms = 8000) {
  showToast(message, label, onAction, ms);
}

function showToast(message, label, onAction, ms) {
  const node = $('#toast');
  node.replaceChildren(el('span', { text: message }));
  node.classList.toggle('has-action', !!label);
  if (label) {
    node.append(el('button', {
      class: 'act', text: label,
      onclick: () => {
        node.classList.remove('show');
        clearTimeout(toastTimer);
        onAction();
      },
    }));
  }
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

/** Native confirm is fine here: it is modal, accessible and never drifts. */
export function confirmAction(message) {
  return window.confirm(message);
}

/* ---------------- lightbox ---------------- */

export function openLightbox(photos, startIndex = 0) {
  const box = $('#lightbox');
  const frame = $('#lightbox-frame');
  frame.replaceChildren(
    ...photos.map((p) =>
      el('div', {}, [el('img', {
        src: blobURL(p.id, p.blob),
        alt: '',
        loading: 'eager',
      })])
    )
  );
  const setCount = () => {
    const i = Math.round(frame.scrollLeft / Math.max(1, frame.clientWidth));
    $('#lightbox-count').textContent = photos.length > 1
      ? `${Math.min(i + 1, photos.length)} / ${photos.length}` : '';
  };
  frame.onscroll = setCount;
  box.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    frame.scrollLeft = startIndex * frame.clientWidth;
    setCount();
  });
}

export function closeLightbox() {
  const box = $('#lightbox');
  if (!box.classList.contains('is-open')) return false;
  box.classList.remove('is-open');
  $('#lightbox-frame').replaceChildren();
  if (!openSheets.length) document.body.style.overflow = '';
  return true;
}

export function anyOverlayOpen() {
  return openSheets.length > 0 || $('#lightbox').classList.contains('is-open');
}

export function topOverlayId() {
  if ($('#lightbox').classList.contains('is-open')) return 'lightbox';
  return openSheets.at(-1)?.sheet.id || null;
}
