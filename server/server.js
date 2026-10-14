import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as sea from 'node:sea';
import { openDb, ftsQuery } from './db.js';
import { loadMhtml, renderPart } from './mhtml.js';
import { CONSENT_CSS } from './consent.js';

// Packaged as a single executable (tabmind-server.exe) the UI is embedded as SEA
// assets and the app folder is wherever the .exe lives.
const IS_SEA = sea.isSea();
const ROOT = IS_SEA ? path.dirname(process.execPath) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TABMIND_PORT || 7878);
// Library data lives outside the app folder so updates/reinstalls never touch it.
// (A data/ folder next to the app is still honoured for early installs.)
function defaultDataDir() {
  const legacy = path.join(ROOT, 'data');
  if (fs.existsSync(path.join(legacy, 'tabmind.db'))) return legacy;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'TabMind');
  return path.join(os.homedir(), '.tabmind');
}
const DATA = path.resolve(process.env.TABMIND_DATA || defaultDataDir());
const SNAPS = path.join(DATA, 'snapshots');
const SCREENS = path.join(DATA, 'screens');
const UI = path.join(ROOT, 'ui');
for (const d of [DATA, SNAPS, SCREENS]) fs.mkdirSync(d, { recursive: true });

const db = openDb(DATA);
const VERSION = '0.3.1';

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.mhtml': 'multipart/related',
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJson = async req => JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString('utf8') || '{}');

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function tagsOf(id) {
  return db.prepare('SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = ? ORDER BY t.name')
    .all(id).map(r => r.name);
}

function setTags(id, names, { replace = false } = {}) {
  if (replace) db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id);
  for (const raw of names || []) {
    const name = String(raw).trim().replace(/^#/, '').slice(0, 60);
    if (!name) continue;
    db.prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)').run(name);
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES (?, ?)').run(id, tag.id);
  }
  db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)');
}

function syncFts(id, body) {
  const item = db.prepare('SELECT title, url, description, note FROM items WHERE id = ?').get(id);
  if (body === undefined) body = db.prepare('SELECT body FROM items_fts WHERE rowid = ?').get(id)?.body || '';
  db.prepare('DELETE FROM items_fts WHERE rowid = ?').run(id);
  if (!item) return;
  db.prepare('INSERT INTO items_fts(rowid, title, url, description, note, tags, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, item.title, item.url, item.description || '', item.note, tagsOf(id).join(' '), body);
}

function collectionId(nameOrId) {
  if (nameOrId === null || nameOrId === '' || nameOrId === undefined) return null;
  if (typeof nameOrId === 'number') return nameOrId;
  const name = String(nameOrId).trim();
  db.prepare('INSERT OR IGNORE INTO collections(name) VALUES (?)').run(name);
  return db.prepare('SELECT id FROM collections WHERE name = ?').get(name).id;
}

function getItem(id) {
  const item = db.prepare(`SELECT i.*, c.name AS collection FROM items i
    LEFT JOIN collections c ON c.id = i.collection_id WHERE i.id = ?`).get(id);
  if (item) item.tags = tagsOf(id);
  return item;
}

// Version of the extension files shipped next to the app. The browser extension compares it
// with its own version and reloads itself after an update.
function installedExtensionVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')).version; } catch { return null; }
}

function removeFiles(item) {
  for (const [dir, f] of [[SNAPS, item.snapshot], [SCREENS, item.screenshot]]) {
    if (f) fs.rmSync(path.join(dir, f), { force: true });
  }
}

function deleteItem(id) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!item) return;
  removeFiles(item);
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  db.prepare('DELETE FROM items_fts WHERE rowid = ?').run(id);
  db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)');
}

// ---------- API ----------
async function saveItem(req, res) {
  const b = await readJson(req);
  if (!b.url || !/^(https?|file|ftp):/i.test(b.url)) return send(res, 400, { error: 'A web URL is required' });
  const existing = db.prepare('SELECT id, status FROM items WHERE url = ?').get(b.url);
  let id;
  if (existing) {
    id = existing.id;
    db.prepare(`UPDATE items SET title = COALESCE(NULLIF(?, ''), title), favicon_url = COALESCE(?, favicon_url),
      og_image = COALESCE(?, og_image), description = COALESCE(?, description), browser = COALESCE(?, browser),
      status = CASE WHEN status = 'archived' THEN 'inbox' ELSE status END,
      save_count = save_count + 1, updated_at = ? WHERE id = ?`)
      .run(b.title || '', b.favIconUrl || null, b.ogImage || null, b.description || null, b.browser || null, now(), id);
  } else {
    const r = db.prepare(`INSERT INTO items(url, title, domain, favicon_url, og_image, description, browser, note, saved_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(b.url, b.title || b.url, domainOf(b.url), b.favIconUrl || null, b.ogImage || null,
        b.description || null, b.browser || null, b.note || '', now(), now());
    id = Number(r.lastInsertRowid);
  }
  if (b.collection) db.prepare('UPDATE items SET collection_id = ? WHERE id = ?').run(collectionId(b.collection), id);
  if (b.tags?.length) setTags(id, b.tags);
  if (b.screenshot && /^data:image\/(jpeg|png);base64,/.test(b.screenshot)) {
    const ext = b.screenshot.startsWith('data:image/png') ? 'png' : 'jpg';
    const file = `${id}.${ext}`;
    fs.writeFileSync(path.join(SCREENS, file), Buffer.from(b.screenshot.split(',')[1], 'base64'));
    db.prepare('UPDATE items SET screenshot = ? WHERE id = ?').run(file, id);
  }
  const text = typeof b.text === 'string' ? b.text.slice(0, 2_000_000) : undefined;
  if (text !== undefined) db.prepare('UPDATE items SET text_len = ? WHERE id = ?').run(text.length, id);
  syncFts(id, text);
  send(res, 200, { id, existed: !!existing });
}

async function saveSnapshot(req, res, id) {
  if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(id)) return send(res, 404, { error: 'Not found' });
  const buf = await readBody(req, 300 * 1024 * 1024);
  if (!buf.length) return send(res, 400, { error: 'Empty snapshot' });
  const file = `${id}.mhtml`;
  fs.writeFileSync(path.join(SNAPS, file), buf);
  db.prepare('UPDATE items SET snapshot = ?, updated_at = ? WHERE id = ?').run(file, now(), id);
  send(res, 200, { ok: true, bytes: buf.length });
}

function listItems(res, q) {
  const where = [];
  const args = [];
  let from = 'items i';
  let order = 'i.saved_at DESC, i.id DESC';
  const status = q.get('status');
  if (status && status !== 'all') { where.push('i.status = ?'); args.push(status); }
  if (q.get('starred') === '1') where.push('i.starred = 1');
  if (q.get('collection') === 'none') where.push('i.collection_id IS NULL');
  else if (q.get('collection')) { where.push('i.collection_id = ?'); args.push(Number(q.get('collection'))); }
  if (q.get('tag')) {
    where.push('i.id IN (SELECT it.item_id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ?)');
    args.push(q.get('tag'));
  }
  if (q.get('untagged') === '1') where.push('i.id NOT IN (SELECT item_id FROM item_tags)');
  if (q.get('domain')) { where.push('i.domain = ?'); args.push(q.get('domain')); }
  if (q.get('browser')) { where.push('i.browser = ?'); args.push(q.get('browser')); }
  const text = ftsQuery(q.get('q') || '');
  if (text) {
    from = 'items i JOIN items_fts f ON f.rowid = i.id';
    where.push('items_fts MATCH ?');
    args.push(text);
  }
  const sort = q.get('sort');
  if (sort === 'oldest') order = 'i.saved_at ASC, i.id ASC';
  else if (sort === 'title') order = 'i.title COLLATE NOCASE ASC';
  else if (sort === 'domain') order = 'i.domain ASC, i.saved_at DESC';
  else if (sort === 'relevance' && text) order = 'bm25(items_fts, 10, 5, 3, 3, 4, 1)';
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Number(q.get('limit') || 100), 500);
  const offset = Number(q.get('offset') || 0);
  const snippet = text ? `, snippet(items_fts, 5, '[[', ']]', ' … ', 18) AS snippet` : '';
  const items = db.prepare(`SELECT i.id, i.url, i.title, i.domain, i.favicon_url, i.og_image, i.description, i.browser,
      i.status, i.collection_id, i.note, i.starred, i.snapshot, i.screenshot, i.text_len, i.save_count,
      i.saved_at, i.updated_at, i.opened_at ${snippet}
    FROM ${from} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  for (const it of items) it.tags = tagsOf(it.id);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${from} ${w}`).get(...args).n;
  send(res, 200, { items, total });
}

function facets(res) {
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM items GROUP BY status').all().map(r => [r.status, r.n]));
  send(res, 200, {
    counts: {
      inbox: counts.inbox || 0, kept: counts.kept || 0, archived: counts.archived || 0,
      all: Object.values(counts).reduce((a, b) => a + b, 0),
      starred: db.prepare('SELECT COUNT(*) n FROM items WHERE starred = 1').get().n,
    },
    collections: db.prepare(`SELECT c.id, c.name, COUNT(i.id) n FROM collections c
      LEFT JOIN items i ON i.collection_id = c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all(),
    tags: db.prepare(`SELECT t.name, COUNT(*) n FROM tags t JOIN item_tags it ON it.tag_id = t.id
      GROUP BY t.id ORDER BY n DESC, t.name COLLATE NOCASE`).all(),
    domains: db.prepare('SELECT domain, COUNT(*) n FROM items GROUP BY domain ORDER BY n DESC LIMIT 40').all(),
    browsers: db.prepare('SELECT browser, COUNT(*) n FROM items WHERE browser IS NOT NULL GROUP BY browser ORDER BY n DESC').all(),
  });
}

function applyPatch(id, b) {
  const sets = [];
  const args = [];
  for (const k of ['title', 'note', 'status']) {
    if (typeof b[k] === 'string') { sets.push(`${k} = ?`); args.push(b[k]); }
  }
  if ('starred' in b) { sets.push('starred = ?'); args.push(b.starred ? 1 : 0); }
  if ('collection_id' in b) { sets.push('collection_id = ?'); args.push(b.collection_id ? Number(b.collection_id) : null); }
  if ('collection' in b) { sets.push('collection_id = ?'); args.push(collectionId(b.collection)); }
  if (b.opened) { sets.push('opened_at = ?'); args.push(now()); }
  if (sets.length) db.prepare(`UPDATE items SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, now(), id);
  if (Array.isArray(b.tags)) setTags(id, b.tags, { replace: true });
  if (Array.isArray(b.addTags)) setTags(id, b.addTags);
  if (b.removeTag) {
    db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)').run(id, b.removeTag);
    db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)');
  }
  syncFts(id);
}

async function api(req, res, url) {
  const p = url.pathname;
  const m = p.match(/^\/api\/items\/(\d+)(\/[a-z]+)?$/);
  const id = m ? Number(m[1]) : null;
  const sub = m?.[2];

  if (p === '/api/health') return send(res, 200, { ok: true, app: 'TabMind', version: VERSION, data: DATA, extVersion: installedExtensionVersion() });
  if (p === '/api/facets' && req.method === 'GET') return facets(res);
  if (p === '/api/items' && req.method === 'GET') return listItems(res, url.searchParams);
  if (p === '/api/items' && req.method === 'POST') return saveItem(req, res);
  if (p === '/api/items/lookup' && req.method === 'GET') {
    const urls = url.searchParams.getAll('url');
    const rows = urls.map(u => db.prepare('SELECT id, url, snapshot FROM items WHERE url = ?').get(u)).filter(Boolean);
    return send(res, 200, { items: rows });
  }
  if (p === '/api/items/bulk' && req.method === 'POST') {
    const b = await readJson(req);
    const ids = (b.ids || []).map(Number).filter(Boolean);
    db.exec('BEGIN');
    try {
      for (const i of ids) b.delete ? deleteItem(i) : applyPatch(i, b.patch || {});
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return send(res, 200, { ok: true, count: ids.length });
  }
  if (id && !sub && req.method === 'GET') {
    const item = getItem(id);
    return item ? send(res, 200, item) : send(res, 404, { error: 'Not found' });
  }
  if (id && !sub && req.method === 'PATCH') {
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(id)) return send(res, 404, { error: 'Not found' });
    applyPatch(id, await readJson(req));
    return send(res, 200, getItem(id));
  }
  if (id && !sub && req.method === 'DELETE') { deleteItem(id); return send(res, 200, { ok: true }); }
  if (id && sub === '/snapshot' && (req.method === 'PUT' || req.method === 'POST')) return saveSnapshot(req, res, id);
  if (id && sub === '/text' && req.method === 'GET') {
    const r = db.prepare('SELECT body FROM items_fts WHERE rowid = ?').get(id);
    return send(res, 200, { text: r?.body || '' });
  }

  if (p === '/api/collections' && req.method === 'POST') {
    const b = await readJson(req);
    if (!b.name?.trim()) return send(res, 400, { error: 'Name required' });
    return send(res, 200, { id: collectionId(b.name) });
  }
  const cm = p.match(/^\/api\/collections\/(\d+)$/);
  if (cm && req.method === 'PATCH') {
    const b = await readJson(req);
    db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(String(b.name).trim(), Number(cm[1]));
    return send(res, 200, { ok: true });
  }
  if (cm && req.method === 'DELETE') {
    db.prepare('DELETE FROM collections WHERE id = ?').run(Number(cm[1]));
    return send(res, 200, { ok: true });
  }
  const tm = p.match(/^\/api\/tags\/(.+)$/);
  if (tm && req.method === 'PATCH') {
    const b = await readJson(req);
    const from = decodeURIComponent(tm[1]);
    const ids = db.prepare('SELECT it.item_id id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ?').all(from).map(r => r.id);
    for (const i of ids) applyPatch(i, { removeTag: from, addTags: [b.name] });
    return send(res, 200, { ok: true });
  }
  if (tm && req.method === 'DELETE') {
    const name = decodeURIComponent(tm[1]);
    const ids = db.prepare('SELECT it.item_id id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ?').all(name).map(r => r.id);
    for (const i of ids) applyPatch(i, { removeTag: name });
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: 'Unknown endpoint' });
}

// Snapshot viewer: serves the MHTML as a sandboxed, offline-only page.
// Images not captured in the snapshot (e.g. lazy-loaded) may still load from the live web; nothing else does.
const SNAP_CSP = "default-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
  "media-src 'self' data:; frame-src 'self'; sandbox allow-popups allow-popups-to-escape-sandbox";

function snapshot(res, url) {
  const m = url.pathname.match(/^\/snap\/(\d+)\/(?:p\/(\d+))?$/);
  if (!m) return send(res, 404, 'Not found');
  const item = db.prepare('SELECT snapshot FROM items WHERE id = ?').get(Number(m[1]));
  if (!item?.snapshot) return send(res, 404, 'No snapshot for this item');
  let doc;
  try { doc = loadMhtml(path.join(SNAPS, item.snapshot)); } catch (e) { return send(res, 500, 'Could not read snapshot: ' + e.message); }
  // Cookie banners are hidden when viewing; ?raw=1 shows the page exactly as captured.
  const extraCss = url.searchParams.get('raw') === '1' ? '' : CONSENT_CSS;
  const out = renderPart(doc, m[2] === undefined ? undefined : Number(m[2]), `/snap/${m[1]}/p/`, { extraCss });
  if (!out) return send(res, 404, 'Part not found');
  // The document is re-rendered each time (viewing rules can change); its parts never change.
  const cache = m[2] === undefined ? 'no-cache' : 'private, max-age=3600';
  res.writeHead(200, { 'Content-Type': out.type, 'Content-Security-Policy': SNAP_CSP, 'Cache-Control': cache });
  res.end(out.body);
}

function serveFile(res, file, root, extra = {}) {
  const full = path.resolve(root, '.' + path.sep + file);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', ...extra });
  fs.createReadStream(full).pipe(res);
}

function serveUi(res, file) {
  if (!IS_SEA) return serveFile(res, file, UI);
  let buf;
  try { buf = Buffer.from(sea.getAsset('ui/' + file.replace(/\\/g, '/'))); } catch { return send(res, 404, 'Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(buf);
}

// ---------- server ----------
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = http.createServer(async (req, res) => {
  try {
    // Block DNS-rebinding and cross-site writes: only our own pages and browser extensions may talk to us.
    if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, 'Forbidden host');
    const origin = req.headers.origin;
    const trustedOrigin = !origin || ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, '')) || /^(chrome|moz)-extension:\/\//.test(origin);
    if (req.method !== 'GET' && req.method !== 'HEAD' && !trustedOrigin) return send(res, 403, 'Forbidden origin');

    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      if (!trustedOrigin) return send(res, 403, 'Forbidden origin');
      return await api(req, res, url);
    }
    if (p.startsWith('/snap/')) return snapshot(res, url);
    if (p.startsWith('/files/screens/')) return serveFile(res, decodeURIComponent(p.slice(15)), SCREENS, { 'Cache-Control': 'private, max-age=60' });
    if (p.startsWith('/files/snapshots/')) {
      return serveFile(res, decodeURIComponent(p.slice(17)), SNAPS, { 'Content-Disposition': 'attachment' });
    }
    return serveUi(res, p === '/' ? 'index.html' : decodeURIComponent(p.slice(1)));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    else res.end();
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use - is TabMind already running?`);
    process.exit(2);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TabMind ${VERSION} running at http://127.0.0.1:${PORT}`);
  console.log(`Library data: ${DATA}`);
});
