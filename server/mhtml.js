// Minimal MHTML (multipart/related) parser + rewriter so snapshots saved by
// chrome.pageCapture can be viewed offline inside the TabLoft library.
import fs from 'node:fs';

function decodeQP(str) {
  const bytes = [];
  const s = str.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 61 /* = */ && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
      bytes.push(parseInt(s.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(c & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function parseHeaders(block) {
  const headers = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

export function parseMhtml(buf) {
  const raw = buf.toString('latin1');
  const headEnd = raw.search(/\r?\n\r?\n/);
  const top = parseHeaders(raw.slice(0, headEnd));
  const m = /boundary="?([^";]+)"?/i.exec(top['content-type'] || '');
  if (!m) throw new Error('Not a multipart MHTML file');
  const boundary = '--' + m[1];
  const chunks = raw.split(boundary).slice(1);
  const parts = [];
  for (let chunk of chunks) {
    if (chunk.startsWith('--')) break;
    chunk = chunk.replace(/^\r?\n/, '');
    const sep = chunk.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const headers = parseHeaders(chunk.slice(0, sep));
    let body = chunk.slice(sep).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '');
    const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
    let data;
    if (enc === 'base64') data = Buffer.from(body.replace(/\s+/g, ''), 'base64');
    else if (enc === 'quoted-printable') data = decodeQP(body);
    else data = Buffer.from(body, 'latin1');
    const ct = headers['content-type'] || 'application/octet-stream';
    parts.push({
      type: ct.split(';')[0].trim().toLowerCase(),
      charset: (/charset="?([^";]+)"?/i.exec(ct) || [])[1] || 'utf-8',
      location: headers['content-location'] || '',
      cid: (headers['content-id'] || '').replace(/^<|>$/g, ''),
      data,
    });
  }
  const byUrl = new Map();
  const byCid = new Map();
  parts.forEach((p, i) => {
    if (p.location) {
      if (!byUrl.has(p.location)) byUrl.set(p.location, i);
      if (p.location.startsWith('cid:')) byCid.set(p.location.slice(4), i);
    }
    if (p.cid) byCid.set(p.cid, i);
  });
  const main = Math.max(0, parts.findIndex(p => p.type === 'text/html'));
  return { parts, byUrl, byCid, main };
}

const decodeAttr = s => s.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"');

function makeResolver(doc, base, prefix) {
  return (val) => {
    const v = decodeAttr(val.trim());
    if (!v || v.startsWith('data:') || v.startsWith('#') || v.startsWith('javascript:')) return null;
    if (v.startsWith('cid:')) {
      const i = doc.byCid.get(v.slice(4));
      return i === undefined ? null : `${prefix}${i}`;
    }
    let abs;
    try { abs = new URL(v, base).href; } catch { return null; }
    let i = doc.byUrl.get(abs);
    if (i === undefined) i = doc.byUrl.get(abs.split('#')[0]);
    if (i === undefined) i = doc.byUrl.get(v);
    return i === undefined ? { live: abs } : `${prefix}${i}`;
  };
}

// Fonts and CSS images are fetched in CORS mode, which fails from the sandboxed (opaque-origin)
// snapshot frame, so they are inlined as data: URIs instead of linked.
const INLINE_MAX = 3 * 1024 * 1024;
function rewriteCss(css, resolve, doc) {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (all, q, u) => {
    const r = resolve(u);
    if (r && r.live) return `url("${r.live}")`;
    if (typeof r !== 'string') return all;
    const p = doc.parts[Number(r.slice(r.lastIndexOf('/') + 1))];
    if (p && p.type !== 'text/css' && p.type !== 'text/html' && p.data.length <= INLINE_MAX) {
      return `url("data:${p.type};base64,${p.data.toString('base64')}")`;
    }
    return `url("${r}")`;
  });
}

function rewriteHtml(html, resolve, doc, extraCss) {
  html = html.replace(/(\s(?:src|href|poster|background|data-src)\s*=\s*)(["'])(.*?)\2/gis, (all, pre, q, val) => {
    const r = resolve(val);
    if (typeof r === 'string') return `${pre}${q}${r}${q}`;
    if (r && r.live) return `${pre}${q}${r.live.replace(/"/g, '&quot;')}${q}`;
    return all;
  });
  html = html.replace(/(\ssrcset\s*=\s*)(["'])(.*?)\2/gis, (all, pre, q, val) => {
    const out = val.split(',').map(entry => {
      const [u, ...rest] = entry.trim().split(/\s+/);
      const r = resolve(u);
      return [typeof r === 'string' ? r : r?.live || u, ...rest].join(' ');
    }).join(', ');
    return `${pre}${q}${out}${q}`;
  });
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (all, a, css, b) => a + rewriteCss(css, resolve, doc) + b);
  html = html.replace(/(\sstyle\s*=\s*)(["'])(.*?)\2/gis, (all, pre, q, css) => pre + q + rewriteCss(css, resolve, doc) + q);
  // Snapshot parts are same-server but the sandboxed frame has an opaque origin, so CORS-mode loads would fail.
  html = html.replace(/\scrossorigin(?:\s*=\s*(["'])[^"']*\1)?/gi, '');
  // Links in the snapshot open the live page in a new tab - never inside the snapshot frame.
  html = html.replace(/(<a\b[^>]*?\s)target\s*=\s*(["']?)_(?:self|top|parent)\2/gi, '$1target="_blank"');
  const baseTag = '<base target="_blank">';
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, m => m + baseTag);
  else html = baseTag + html;
  // Extra CSS (e.g. hiding cookie banners) goes last so it wins over the page's own styles.
  if (extraCss) {
    const tag = '<style id="tabloft-view">' + extraCss + '</style>';
    const end = html.search(/<\/body>(?![\s\S]*<\/body>)/i);
    html = end >= 0 ? html.slice(0, end) + tag + html.slice(end) : html + tag;
  }
  return html;
}

// Returns { type, body } for part `n` (or the main document) with references
// rewritten to point at `${prefix}<partIndex>`; `extraCss` is appended to HTML documents.
export function renderPart(doc, n, prefix, { extraCss } = {}) {
  const idx = n === undefined ? doc.main : n;
  const p = doc.parts[idx];
  if (!p) return null;
  if (p.type === 'text/html' || p.type === 'text/css') {
    let text;
    try { text = new TextDecoder(p.charset).decode(p.data); } catch { text = p.data.toString('utf8'); }
    const base = p.location && !p.location.startsWith('cid:') ? p.location : (doc.parts[doc.main].location || 'about:blank');
    const resolve = makeResolver(doc, base, prefix);
    const body = p.type === 'text/html' ? rewriteHtml(text, resolve, doc, extraCss) : rewriteCss(text, resolve, doc);
    return { type: `${p.type}; charset=utf-8`, body: Buffer.from(body, 'utf8') };
  }
  return { type: p.type, body: p.data };
}

// Tiny LRU so browsing a snapshot doesn't re-parse the file for every image.
const cache = new Map();
export function loadMhtml(file) {
  const stat = fs.statSync(file);
  const key = file + ':' + stat.mtimeMs;
  if (cache.has(key)) {
    const v = cache.get(key);
    cache.delete(key); cache.set(key, v);
    return v;
  }
  const doc = parseMhtml(fs.readFileSync(file));
  cache.set(key, doc);
  while (cache.size > 6) cache.delete(cache.keys().next().value);
  return doc;
}
