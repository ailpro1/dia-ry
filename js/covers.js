/* Notebook covers, drawn as SVG rather than shipped as images: they stay
   crisp at any size, weigh nothing, and a new colourway costs one line. */

export const COLORS = {
  sand: { base: '#d9c3a5', ink: '#6a5438', edge: '#c4ab8a' },
  ink: { base: '#22242a', ink: '#e8e4dc', edge: '#15171b' },
  navy: { base: '#37476b', ink: '#e7dcc4', edge: '#2a3754' },
  moss: { base: '#6d7f5c', ink: '#eef0e4', edge: '#59684b' },
  clay: { base: '#b5705c', ink: '#f6e6de', edge: '#9a5b49' },
  plum: { base: '#6b5570', ink: '#efe2ef', edge: '#57445b' },
};

export const DESIGNS = ['kraft', 'composition', 'birds', 'linen', 'grid', 'stripes'];

const W = 300;
const H = 420;

/** @returns {string} a standalone SVG document for one cover. */
export function coverSVG(design = 'kraft', color = 'sand', label = '') {
  const c = COLORS[color] || COLORS.sand;
  const d = DESIGNS.includes(design) ? design : 'kraft';
  const uid = `${d}-${color}`.replace(/[^a-z0-9-]/gi, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    ${pattern(d, uid, c)}
    <linearGradient id="sheen-${uid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity=".16"/>
      <stop offset=".07" stop-color="#000" stop-opacity="0"/>
      <stop offset=".85" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#fff" stop-opacity=".1"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="10" fill="${c.base}"/>
  ${d === 'kraft' ? '' : `<rect width="${W}" height="${H}" rx="10" fill="url(#p-${uid})"/>`}
  ${face(d, uid, c, label)}
  <rect x="0" y="0" width="22" height="${H}" fill="${c.edge}" opacity=".55"/>
  <rect width="${W}" height="${H}" rx="10" fill="url(#sheen-${uid})"/>
</svg>`;
}

function pattern(design, uid, c) {
  switch (design) {
    case 'composition':
      return `<pattern id="p-${uid}" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="${c.edge}"/>
        ${speckles(c.ink)}
        ${speckles(c.base, 31)}
      </pattern>`;
    case 'birds':
      return `<pattern id="p-${uid}" width="58" height="58" patternUnits="userSpaceOnUse">
        <g fill="${c.ink}" opacity=".9">
          <path d="M4 20c7-10 14-10 21 0-7-4-14-4-21 0z"/>
          <path d="M31 44c7-10 14-10 21 0-7-4-14-4-21 0z"/>
        </g>
        <g fill="${c.ink}" opacity=".6">
          <path d="M34 10c5-7 10-7 15 0-5-3-10-3-15 0z"/>
          <path d="M6 48c5-7 10-7 15 0-5-3-10-3-15 0z"/>
        </g>
      </pattern>`;
    case 'linen':
      return `<pattern id="p-${uid}" width="6" height="6" patternUnits="userSpaceOnUse">
        <path d="M0 0h6M0 3h6" stroke="${c.ink}" stroke-width=".5" opacity=".13"/>
        <path d="M0 0v6M3 0v6" stroke="${c.edge}" stroke-width=".5" opacity=".18"/>
      </pattern>`;
    case 'grid':
      return `<pattern id="p-${uid}" width="22" height="22" patternUnits="userSpaceOnUse">
        <path d="M0 0h22M0 0v22" stroke="${c.ink}" stroke-width="1" opacity=".22"/>
      </pattern>`;
    case 'stripes':
      return `<pattern id="p-${uid}" width="18" height="18" patternUnits="userSpaceOnUse"
        patternTransform="rotate(90)">
        <rect width="7" height="18" fill="${c.ink}" opacity=".16"/>
      </pattern>`;
    default:
      return `<pattern id="p-${uid}" width="1" height="1"><rect width="1" height="1" fill="${c.base}"/></pattern>`;
  }
}

/** Deterministic flecks, so the same cover looks the same every render. */
function speckles(ink, start = 7) {
  let out = '';
  let seed = start;
  for (let i = 0; i < 18; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const x = (seed / 2147483648) * 16;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const y = (seed / 2147483648) * 16;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const r = 0.4 + (seed / 2147483648) * 0.9;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${ink}" opacity=".75"/>`;
  }
  return out;
}

/** The detail on the front: a label, a band, an embossed line. */
function face(design, uid, c, label) {
  const text = esc((label || '').slice(0, 18).toLowerCase());
  switch (design) {
    case 'composition':
      return `<rect x="62" y="150" width="176" height="96" rx="4" fill="#efe6d2"/>
        <rect x="70" y="158" width="160" height="80" rx="2" fill="none" stroke="#2b2b2b" stroke-width="1.5"/>
        <text x="150" y="196" text-anchor="middle" font-family="Georgia, serif"
          font-size="19" letter-spacing="2" fill="#2b2b2b">NOTES</text>
        <path d="M84 214h132" stroke="#2b2b2b" stroke-width="1" opacity=".5"/>
        ${text ? `<text x="150" y="228" text-anchor="middle" font-family="Courier, monospace"
          font-size="12" fill="#2b2b2b" opacity=".75">${text}</text>` : ''}`;
    case 'kraft':
      return `<rect x="52" y="150" width="196" height="120" rx="3" fill="${c.ink}" opacity=".07"/>
        <path d="M52 150h196" stroke="${c.ink}" stroke-width="1" opacity=".3"/>
        <path d="M52 270h196" stroke="${c.ink}" stroke-width="1" opacity=".3"/>
        ${text ? `<text x="150" y="216" text-anchor="middle" font-family="Courier, monospace"
          font-size="15" letter-spacing="3" fill="${c.ink}" opacity=".8">${text}</text>` : ''}`;
    case 'birds':
      return `<rect x="60" y="176" width="180" height="62" rx="3" fill="${c.ink}" opacity=".92"/>
        ${text ? `<text x="150" y="214" text-anchor="middle" font-family="Georgia, serif"
          font-size="17" fill="${c.base}">${text}</text>` : ''}`;
    default:
      return `<rect x="56" y="168" width="188" height="78" rx="3" fill="none"
          stroke="${c.ink}" stroke-width="1.5" opacity=".45"/>
        ${text ? `<text x="150" y="214" text-anchor="middle" font-family="Courier, monospace"
          font-size="14" letter-spacing="2" fill="${c.ink}" opacity=".8">${text}</text>` : ''}`;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/** An <img>-ready data URL. */
export function coverURL(design, color, label) {
  return `data:image/svg+xml;charset=utf-8,${
    encodeURIComponent(coverSVG(design, color, label))}`;
}
