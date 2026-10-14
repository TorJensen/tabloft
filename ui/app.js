const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('tm.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tm.' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  filter: { status: 'inbox' },
  q: '',
  sort: 'newest',
  view: store.get('view', 'grid'),
  items: [],
  total: 0,
  selected: new Set(),
  openId: null,
  facets: null,
  tab: store.get('tab', 'snapshot'),
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

function ago(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const sec = (Date.now() - d) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- URL state ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.filter = {};
  for (const k of ['status', 'collection', 'tag', 'domain', 'browser', 'starred', 'untagged']) if (p.get(k)) state.filter[k] = p.get(k);
  if (!Object.keys(state.filter).length) state.filter.status = 'inbox';
  state.q = p.get('q') || '';
  state.sort = p.get('sort') || 'newest';
}
function writeHash() {
  const p = new URLSearchParams({ ...state.filter });
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'newest') p.set('sort', state.sort);
  history.replaceState(null, '', '#' + p.toString());
}

// ---------- sidebar ----------
const MAIN_NAV = [
  { key: 'inbox', label: 'Inbox', hint: 'Saved, not yet sorted', f: { status: 'inbox' } },
  { key: 'kept', label: 'Library', hint: 'Sorted and kept', f: { status: 'kept' } },
  { key: 'starred', label: 'Starred', f: { starred: '1' } },
  { key: 'all', label: 'Everything', f: { status: 'all' } },
  { key: 'archived', label: 'Archive', hint: 'Read / done', f: { status: 'archived' } },
];

const sameFilter = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function navLink(label, count, f, extra = '') {
  const active = sameFilter(state.filter, f) ? ' active' : '';
  return `<a href="#" class="nav-item${active}" data-filter="${esc(JSON.stringify(f))}">${extra}<span class="nav-label">${esc(label)}</span><span class="nav-count">${count ?? ''}</span></a>`;
}

async function loadFacets() {
  const f = (state.facets = await api('/api/facets'));
  $('#nav-main').innerHTML = MAIN_NAV.map(n => navLink(n.label, f.counts[n.key], n.f)).join('');
  $('#nav-collections').innerHTML = f.collections.length
    ? f.collections.map(c => navLink(c.name, c.n, { collection: String(c.id) })).join('')
    : '<p class="nav-empty">Group related finds — e.g. one per research project.</p>';
  $('#nav-tags').innerHTML = (f.tags.length ? f.tags.slice(0, 60).map(t => navLink('#' + t.name, t.n, { tag: t.name })).join('') : '')
    + navLink('Untagged', '', { untagged: '1' });
  $('#nav-domains').innerHTML = f.domains.slice(0, 15).map(d => navLink(d.domain || '(none)', d.n, { domain: d.domain })).join('');
  $('#nav-browsers').innerHTML = f.browsers.map(b => navLink(b.browser, b.n, { browser: b.browser })).join('');
}

function filterTitle() {
  const f = state.filter;
  const main = MAIN_NAV.find(n => sameFilter(n.f, f));
  if (main) return main.label;
  if (f.collection) return state.facets?.collections.find(c => String(c.id) === f.collection)?.name || 'Collection';
  if (f.tag) return '#' + f.tag;
  if (f.untagged) return 'Untagged';
  if (f.domain) return f.domain;
  if (f.browser) return 'Saved from ' + f.browser;
  return 'Items';
}

// ---------- item list ----------
async function loadItems({ append = false } = {}) {
  const p = new URLSearchParams({ ...state.filter, sort: state.sort, limit: 120, offset: append ? state.items.length : 0 });
  if (state.q) p.set('q', state.q);
  if (!state.filter.status && !state.filter.starred) p.set('status', 'all');
  const { items, total } = await api('/api/items?' + p);
  state.items = append ? state.items.concat(items) : items;
  state.total = total;
  if (!append) state.selected.clear();
  renderItems();
}

function thumb(it) {
  if (it.screenshot) return `<img loading="lazy" src="/files/screens/${esc(it.screenshot)}" alt="">`;
  if (it.og_image) return `<img loading="lazy" src="${esc(it.og_image)}" alt="" referrerpolicy="no-referrer" data-letter="${esc((it.domain || '?')[0].toUpperCase())}">`;
  return `<div class="ph">${esc((it.domain || '?')[0].toUpperCase())}</div>`;
}

function favicon(it) {
  return it.favicon_url ? `<img class="fav" src="${esc(it.favicon_url)}" alt="" referrerpolicy="no-referrer">` : '';
}

function snippet(s) {
  return esc(s).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>');
}

function card(it) {
  const sel = state.selected.has(it.id) ? ' selected' : '';
  const open = state.openId === it.id ? ' open' : '';
  const badges = [
    it.snapshot ? '<span class="badge" title="Full snapshot saved">snapshot</span>' : '<span class="badge dim" title="Link only — the page was asleep or not capturable">link only</span>',
    it.starred ? '<span class="star">★</span>' : '',
  ].join('');
  return `<article class="card${sel}${open}" data-id="${it.id}">
    <label class="pick" title="Select"><input type="checkbox" ${sel ? 'checked' : ''}></label>
    <div class="thumb">${thumb(it)}</div>
    <div class="body">
      <h3 title="${esc(it.title)}">${esc(it.title)}</h3>
      <div class="meta">${favicon(it)}<span>${esc(it.domain)}</span><span>· ${ago(it.saved_at)}</span>${it.browser ? `<span>· ${esc(it.browser)}</span>` : ''}</div>
      ${it.snippet ? `<p class="snippet">${snippet(it.snippet)}</p>` : it.note ? `<p class="note">${esc(it.note)}</p>` : it.description ? `<p class="desc">${esc(it.description)}</p>` : ''}
      <div class="chips">${badges}${it.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>
    </div>
  </article>`;
}

function renderItems() {
  $('#title').textContent = state.q ? `“${state.q}” in ${filterTitle()}` : filterTitle();
  $('#count').textContent = `${state.total} item${state.total === 1 ? '' : 's'}`;
  $('#items').className = state.view;
  $$('#view button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  $('#items').innerHTML = state.items.map(card).join('');
  $('#more').hidden = state.items.length >= state.total;
  const empty = !state.items.length;
  $('#empty').hidden = !empty;
  if (empty) {
    $('#empty').innerHTML = state.q
      ? `<h3>Nothing matches “${esc(state.q)}”.</h3><p>Search covers titles, URLs, notes, tags and the full text of saved pages.</p>`
      : state.filter.status === 'inbox'
        ? `<h3>Inbox zero.</h3><p>Use the TabMind button in your browser to send tabs here. Everything you save lands in the Inbox until you sort it.</p>`
        : `<h3>Nothing here yet.</h3>`;
  }
  renderBulk();
}

function renderBulk() {
  const n = state.selected.size;
  $('#bulk').hidden = n === 0;
  $('#bulk-count').textContent = `${n} selected`;
  $('#select-all').textContent = n && n === state.items.length ? 'Select none' : 'Select all';
  $$('.card').forEach(c => {
    const on = state.selected.has(Number(c.dataset.id));
    c.classList.toggle('selected', on);
    c.querySelector('input').checked = on;
  });
}

// ---------- prompt dialog ----------
function ask(label, options = [], initial = '') {
  return new Promise(resolve => {
    const d = $('#prompt');
    $('#prompt-label').textContent = label;
    $('#prompt-input').value = initial;
    $('#prompt-list').replaceChildren(...options.map(o => Object.assign(document.createElement('option'), { value: o })));
    d.onclose = () => resolve(d.returnValue === 'ok' ? $('#prompt-input').value.trim() : null);
    d.showModal();
    $('#prompt-input').focus();
  });
}

// ---------- drawer ----------
async function openItem(id) {
  state.openId = id;
  $$('.card').forEach(c => c.classList.toggle('open', Number(c.dataset.id) === id));
  const it = await api('/api/items/' + id);
  const d = $('#drawer');
  d.hidden = false;
  document.body.classList.add('drawer-open');
  d.dataset.id = id;
  $('#d-title').value = it.title;
  $('#d-open').href = it.url;
  $('#d-star').textContent = it.starred ? '★' : '☆';
  $('#d-star').classList.toggle('on', !!it.starred);
  $('#d-keep').textContent = it.status === 'kept' ? 'Back to inbox' : 'Keep';
  $('#d-archive').textContent = it.status === 'archived' ? 'Unarchive' : 'Archive (e)';
  const statusLabel = { inbox: 'Inbox', kept: 'Library', archived: 'Archive' }[it.status];
  $('#d-meta').innerHTML = `${favicon(it)}<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a>
    <span>Saved ${ago(it.saved_at)}${it.save_count > 1 ? ` (${it.save_count}×)` : ''}${it.browser ? ' from ' + esc(it.browser) : ''} · ${statusLabel}</span>`;
  $('#d-note').value = it.note;
  const cols = state.facets.collections;
  $('#d-collection').innerHTML = `<option value="">— none —</option>` +
    cols.map(c => `<option value="${c.id}" ${c.id === it.collection_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') +
    `<option value="__new">+ New collection…</option>`;
  renderTags(it.tags);
  d.item = it;
  showTab(state.tab);
}

function renderTags(tags) {
  $('#d-tags').innerHTML = tags.map(t => `<span class="chip">#${esc(t)} <button data-remove="${esc(t)}" title="Remove">×</button></span>`).join('')
    + `<input id="d-tag-input" list="all-tags" placeholder="add tag…"><datalist id="all-tags">${state.facets.tags.map(t => `<option value="${esc(t.name)}">`).join('')}</datalist>`;
}

function showTab(tab) {
  state.tab = tab;
  store.set('tab', tab);
  const it = $('#drawer').item;
  $$('#d-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const body = $('#d-body');
  if (tab === 'snapshot') {
    body.innerHTML = it.snapshot
      ? `<div class="snap-bar">Offline snapshot · <a href="/files/snapshots/${esc(it.snapshot)}" download>Download .mhtml</a></div>
         <iframe src="/snap/${it.id}/" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Snapshot"></iframe>`
      : `<div class="no-snap"><p>No snapshot for this page — it was saved as a link only (the tab was asleep or not a regular web page).</p>
         <p>Open it live and save it again to capture a snapshot.</p>${it.screenshot ? `<img src="/files/screens/${esc(it.screenshot)}" alt="">` : ''}</div>`;
  } else if (tab === 'screenshot') {
    body.innerHTML = it.screenshot
      ? `<div class="shot"><img src="/files/screens/${esc(it.screenshot)}" alt="Screenshot"></div>`
      : `<div class="no-snap"><p>No screenshot. Screenshots are taken only of the tab that was visible when saving.</p></div>`;
  } else {
    body.innerHTML = '<div class="reader">Loading…</div>';
    api(`/api/items/${it.id}/text`).then(({ text }) => {
      if (state.openId !== it.id || state.tab !== 'text') return;
      body.innerHTML = `<div class="reader">${text ? esc(text) : '<em>No text was captured for this page.</em>'}</div>`;
    });
  }
}

function closeDrawer() {
  $('#drawer').hidden = true;
  document.body.classList.remove('drawer-open');
  $('#d-body').innerHTML = '';
  state.openId = null;
  $$('.card.open').forEach(c => c.classList.remove('open'));
}

async function patchOpen(patch, { refresh = false } = {}) {
  const id = state.openId;
  const it = await api('/api/items/' + id, { method: 'PATCH', body: patch });
  const i = state.items.findIndex(x => x.id === id);
  if (i >= 0) state.items[i] = { ...state.items[i], ...it };
  if (refresh) await loadFacets();
  return it;
}

function step(delta) {
  const i = state.items.findIndex(x => x.id === state.openId);
  const next = state.items[i + delta] || state.items[i - delta];
  return next?.id;
}

// Moving an item out of the current view (e.g. archiving from Inbox) advances to the next one: fast triage.
async function moveOpen(status) {
  const id = state.openId;
  const nextId = step(1);
  await api('/api/items/' + id, { method: 'PATCH', body: { status } });
  const leaves = state.filter.status && state.filter.status !== 'all' && state.filter.status !== status;
  if (leaves) {
    state.items = state.items.filter(x => x.id !== id);
    state.total--;
    renderItems();
    nextId && nextId !== id ? openItem(nextId) : closeDrawer();
  } else {
    await loadItems();
    openItem(id);
  }
  loadFacets();
  toast({ kept: 'Kept in Library', archived: 'Archived', inbox: 'Moved to Inbox' }[status]);
}

// ---------- events ----------
document.addEventListener('click', async e => {
  const nav = e.target.closest('.nav-item');
  if (nav) {
    e.preventDefault();
    state.filter = JSON.parse(nav.dataset.filter);
    document.body.classList.remove('menu-open');
    writeHash();
    await loadFacets();
    await loadItems();
    return;
  }
  const c = e.target.closest('.card');
  if (c) {
    const id = Number(c.dataset.id);
    if (e.target.closest('.pick') || e.ctrlKey || e.metaKey || e.shiftKey) {
      if (e.target.tagName !== 'INPUT') e.preventDefault();
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      renderBulk();
      return;
    }
    openItem(id);
  }
});

$('#search').addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.q = $('#search').value.trim();
    if (state.q && state.sort === 'newest') { state.sort = 'relevance'; $('#sort').value = 'relevance'; }
    writeHash();
    loadItems();
  }, 200);
});
$('#sort').onchange = e => { state.sort = e.target.value; writeHash(); loadItems(); };
$$('#view button').forEach(b => (b.onclick = () => { state.view = b.dataset.view; store.set('view', state.view); renderItems(); }));
$('#more').onclick = () => loadItems({ append: true });
$('#menu').onclick = () => document.body.classList.toggle('menu-open');
$('#select-all').onclick = () => {
  if (state.selected.size === state.items.length) state.selected.clear();
  else state.items.forEach(i => state.selected.add(i.id));
  renderBulk();
};

$('#new-collection').onclick = async () => {
  const name = await ask('New collection name');
  if (!name) return;
  const { id } = await api('/api/collections', { method: 'POST', body: { name } });
  await loadFacets();
  state.filter = { collection: String(id) };
  writeHash();
  loadFacets();
  loadItems();
};

$('#bulk').addEventListener('click', async e => {
  const action = e.target.dataset.bulk;
  if (!action) return;
  const ids = [...state.selected];
  if (action === 'clear') { state.selected.clear(); renderBulk(); return; }
  if (action === 'open') {
    if (ids.length > 15 && !confirm(`Open ${ids.length} tabs?`)) return;
    state.items.filter(i => state.selected.has(i.id)).forEach(i => window.open(i.url, '_blank', 'noopener'));
    return;
  }
  let body;
  if (['kept', 'archived', 'inbox'].includes(action)) body = { ids, patch: { status: action } };
  if (action === 'tag') {
    const t = await ask(`Add tag to ${ids.length} items`, state.facets.tags.map(t => t.name));
    if (!t) return;
    body = { ids, patch: { addTags: t.split(',').map(s => s.trim()).filter(Boolean) } };
  }
  if (action === 'collection') {
    const name = await ask(`Move ${ids.length} items to collection (new or existing)`, state.facets.collections.map(c => c.name));
    if (name === null) return;
    body = { ids, patch: { collection: name || null } };
  }
  if (action === 'delete') {
    if (!confirm(`Permanently delete ${ids.length} items and their snapshots?`)) return;
    body = { ids, delete: true };
  }
  await api('/api/items/bulk', { method: 'POST', body });
  toast(`Updated ${ids.length} items`);
  if (state.openId && ids.includes(state.openId)) closeDrawer();
  await loadFacets();
  await loadItems();
});

// drawer controls
$('#d-close').onclick = closeDrawer;
$('#d-next').onclick = () => { const i = state.items.findIndex(x => x.id === state.openId); state.items[i + 1] && openItem(state.items[i + 1].id); };
$('#d-prev').onclick = () => { const i = state.items.findIndex(x => x.id === state.openId); state.items[i - 1] && openItem(state.items[i - 1].id); };
$('#d-keep').onclick = () => moveOpen($('#drawer').item.status === 'kept' ? 'inbox' : 'kept');
$('#d-archive').onclick = () => moveOpen($('#drawer').item.status === 'archived' ? 'inbox' : 'archived');
$('#d-star').onclick = async () => {
  const it = await patchOpen({ starred: !$('#drawer').item.starred }, { refresh: true });
  $('#drawer').item = it;
  $('#d-star').textContent = it.starred ? '★' : '☆';
  $('#d-star').classList.toggle('on', !!it.starred);
  renderItems();
};
$('#d-open').onclick = () => api('/api/items/' + state.openId, { method: 'PATCH', body: { opened: true } });
$('#d-delete').onclick = async () => {
  if (!confirm('Delete this item and its snapshot permanently?')) return;
  const id = state.openId;
  const nextId = step(1);
  await api('/api/items/' + id, { method: 'DELETE' });
  state.items = state.items.filter(x => x.id !== id);
  state.total--;
  renderItems();
  nextId ? openItem(nextId) : closeDrawer();
  loadFacets();
};
$('#d-title').onchange = async e => { await patchOpen({ title: e.target.value }); renderItems(); };
$('#d-note').onchange = async e => { await patchOpen({ note: e.target.value }); renderItems(); };
$('#d-collection').onchange = async e => {
  let v = e.target.value;
  if (v === '__new') {
    const name = await ask('New collection name');
    if (!name) { e.target.value = $('#drawer').item.collection_id || ''; return; }
    await patchOpen({ collection: name }, { refresh: true });
  } else {
    await patchOpen({ collection_id: v ? Number(v) : null }, { refresh: true });
  }
  openItem(state.openId);
};
$('#d-tags').addEventListener('click', async e => {
  const t = e.target.dataset.remove;
  if (!t) return;
  const it = await patchOpen({ removeTag: t }, { refresh: true });
  renderTags(it.tags);
  renderItems();
});
$('#d-tags').addEventListener('keydown', async e => {
  if (e.target.id !== 'd-tag-input' || (e.key !== 'Enter' && e.key !== ',')) return;
  e.preventDefault();
  const v = e.target.value.trim();
  if (!v) return;
  const it = await patchOpen({ addTags: v.split(',').map(s => s.trim()).filter(Boolean) }, { refresh: true });
  renderTags(it.tags);
  renderItems();
  $('#d-tag-input').focus();
});
$$('#d-tabs button').forEach(b => (b.onclick = () => showTab(b.dataset.tab)));

document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (typing) document.activeElement.blur();
    else if (state.openId) closeDrawer();
    else if (state.selected.size) { state.selected.clear(); renderBulk(); }
    return;
  }
  if (typing || $('#prompt').open) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
  const idx = state.items.findIndex(x => x.id === state.openId);
  if (e.key === 'j') state.items[idx + 1] && openItem(state.items[idx + 1].id);
  if (e.key === 'k') state.items[Math.max(0, idx - 1)] && openItem(state.items[Math.max(0, idx - 1)].id);
  if (!state.openId) return;
  if (e.key === 'e') $('#d-archive').click();
  if (e.key === 's') $('#d-star').click();
  if (e.key === 'o') window.open($('#drawer').item.url, '_blank', 'noopener');
});

window.addEventListener('hashchange', async () => {
  readHash();
  $('#search').value = state.q;
  $('#sort').value = state.sort;
  await loadFacets();
  loadItems();
});

window.addEventListener('focus', () => { loadFacets(); if (!state.openId && !state.selected.size) loadItems(); });

// Broken remote images (expired og:image, favicons) fall back gracefully.
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  if (img.classList.contains('fav')) img.remove();
  else if (img.dataset.letter) img.replaceWith(Object.assign(document.createElement('div'), { className: 'ph', textContent: img.dataset.letter }));
}, true);

// ---------- boot ----------
readHash();
$('#search').value = state.q;
$('#sort').value = state.sort;
await loadFacets();
await loadItems();
