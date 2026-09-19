/* Small helpers: ids, dates, escaping, DOM. */

export function uid() {
  // Time-ordered, collision-resistant enough for a single-user diary.
  const t = Date.now().toString(36).padStart(9, '0');
  const r = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const b of r) s += b.toString(36).padStart(2, '0');
  return t + s;
}

export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Local YYYY-MM-DD (never UTC — a diary entry belongs to the local day). */
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function shortDate(iso) {
  const d = parseISODate(iso);
  const now = new Date();
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear()
    ? base
    : `${base} ${String(d.getFullYear()).slice(2)}`;
}

export function monthLabel(iso) {
  const d = parseISODate(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function clockTime(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}

export function timeInputValue(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function relativeDay(iso) {
  const today = isoDate();
  if (iso === today) return 'today';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === isoDate(y)) return 'yesterday';
  return shortDate(iso);
}

export function bytes(n) {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/* ---- rich text -----------------------------------------------------------
   Entry bodies are stored as HTML produced by a contenteditable field, so
   everything is run through a strict allow-list on the way in and on the way
   out (imported backups are untrusted too). */

const ALLOWED = {
  P: [], DIV: [], BR: [], B: [], STRONG: [], I: [], EM: [], U: [], S: [],
  UL: [], OL: [], LI: [], MARK: [], CODE: [], BLOCKQUOTE: [], SPAN: [],
  A: ['href'],
};

export function sanitizeHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html == null ? '' : html);
  clean(tpl.content);
  return tpl.innerHTML;
}

function clean(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const kill = [];
  const unwrap = [];
  while (walk.nextNode()) {
    const el = walk.currentNode;
    const tag = el.tagName;
    if (!Object.prototype.hasOwnProperty.call(ALLOWED, tag)) {
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' ||
          tag === 'OBJECT' || tag === 'EMBED' || tag === 'LINK') kill.push(el);
      else unwrap.push(el);
      continue;
    }
    for (const attr of [...el.attributes]) {
      if (!ALLOWED[tag].includes(attr.name.toLowerCase())) {
        el.removeAttribute(attr.name);
      }
    }
    if (tag === 'A') {
      const href = el.getAttribute('href') || '';
      if (!/^(https?:|mailto:|tel:)/i.test(href)) el.removeAttribute('href');
      else { el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank'); }
    }
  }
  kill.forEach((el) => el.remove());
  unwrap.forEach((el) => {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
}

export function htmlToText(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '').replace(/<\/(p|div|li|blockquote)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ');
  return (tpl.content.textContent || '').replace(/\s+/g, ' ').trim();
}

export function isBlankHTML(html) {
  return htmlToText(html).length === 0;
}

/* ---- DOM ---- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (v !== null && v !== undefined && v !== false) {
      node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
