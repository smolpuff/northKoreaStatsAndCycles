// SVGs are generated from the app's real sidebarArtwork renderer, not redrawn.
const sidebar = require('./sidebar-artwork.json');
const glyphs = { stats: sidebar.stats, cycles: sidebar.cycles, twitch: sidebar.twitch };
const palettes = {
  running: { state: 'running', top: '#319d68', bottom: '#20734d', border: '#00ff4c', label: 'ON' },
  stopped: { state: 'stopped', top: '#b64d60', bottom: '#863a4d', border: '#ff182e', label: 'OFF' },
  disconnected: { state: 'disconnected', top: '#555867', bottom: '#3b3d4b', border: '#737686', label: 'OFFLINE' },
  attention: { state: 'attention', top: '#9d8131', bottom: '#735b20', border: '#ffcb4c', label: 'ERROR' },
  busy: { state: 'busy', top: '#9d8131', bottom: '#735b20', border: '#ffcb4c', label: 'WAIT' },
};
function placed(svg, x, y, size) {
  const [left, top, width, height] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const scale = Math.min(size / width, size / height);
  const body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/style="fill:([^"]+)"/g, 'fill="$1"');
  const transform = `translate(${x + (size - width * scale) / 2 - left * scale} ${y + (size - height * scale) / 2 - top * scale}) scale(${scale})`;
  // Offset vector silhouettes work in Stream Deck without unsupported SVG filters.
  const shadow = body.replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/fill="[^"]*"/g, 'fill="#09111b"');
  return `<g transform="translate(0 2)" opacity="0.4"><g transform="${transform}">${shadow}</g></g><g transform="${transform}">${body}</g>`;
}
function keySvg(glyph, { top, bottom, border, label }) {
  const tags = { Watching: 'running', Processing: 'running', ON: 'running', Stopped: 'stopped', OFF: 'stopped', Disconnected: 'offline', OFFLINE: 'offline', 'File missing': 'no file', Error: 'error', ERROR: 'error', Failed: 'failed', 'Working...': 'waiting', Waiting: 'waiting', WAIT: 'waiting', LIVE: 'live', UNKNOWN: 'unknown' };
  const name = glyph === glyphs.stats ? 'Stats' : glyph === glyphs.cycles ? 'Cycles' : 'Drop';
  const tag = glyph === glyphs.twitch ? 'channel drop' : `${name} ${tags[label] || label.toLowerCase()}`;
  const gradient = `key-background-${border.slice(1)}`;
  const statusLight = glyph === glyphs.twitch
    ? `<circle cx="120" cy="24" r="7" fill="${border}" stroke="#202328" stroke-width="2"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><defs><linearGradient id="${gradient}" gradientUnits="userSpaceOnUse" x1="72" y1="3" x2="72" y2="141"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect x="3" y="3" width="138" height="138" rx="20" fill="url(#${gradient})" stroke="${border}" stroke-width="6"/>${placed(glyph, 40, 40, 64)}${statusLight}<text x="72" y="128" fill="#f1f1f1" font-family="Segoe UI, sans-serif" font-size="16" font-weight="600" text-anchor="middle">${tag}</text></svg>`;
}
function staticSvg(glyph, size = 144) {
  return keySvg(glyph, palettes.disconnected).replace('width="144" height="144"', `width="${size}" height="${size}"`);
}
module.exports = { glyphs, palettes, keySvg, staticSvg };
