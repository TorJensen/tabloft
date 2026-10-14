const $ = s => document.querySelector(s);
const DEFAULTS = { server: 'http://127.0.0.1:7878', closeAfterSave: true, loadUnloaded: true, screenshots: true, skipPinned: true, hideConsent: true };
let settings = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
const base = () => settings.server.replace(/\/$/, '');

// Settings
$('#server').value = settings.server;
$('#close').checked = settings.closeAfterSave;
for (const k of ['loadUnloaded', 'screenshots', 'skipPinned', 'hideConsent']) $('#' + k).checked = settings[k];
$('#close').onchange = e => chrome.storage.local.set({ closeAfterSave: e.target.checked });
for (const k of ['loadUnloaded', 'screenshots', 'skipPinned', 'hideConsent']) $('#' + k).onchange = e => chrome.storage.local.set({ [k]: e.target.checked });
$('#server').onchange = async e => { await chrome.storage.local.set({ server: e.target.value.trim() }); location.reload(); };
$('#toggle-settings').onclick = e => { e.preventDefault(); $('#settings').hidden = !$('#settings').hidden; };
$('#open-library').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: base() }); window.close(); };

// Tab counts on buttons
const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
const win = await chrome.tabs.query({ currentWindow: true });
const all = await chrome.tabs.query({ windowType: 'normal' });
const selected = win.filter(t => t.highlighted);
const label = (sel, text, n) => { $(sel).textContent = `${text} (${n})`; $(sel).disabled = n === 0; };
label('#btn-selected', 'Save selected tabs', selected.length);
label('#btn-window', 'Save this window', win.length);
label('#btn-all', 'Save all windows', all.length);
label('#btn-left', 'Tabs to the left', win.filter(t => t.index < current.index).length);
label('#btn-right', 'Tabs to the right', win.filter(t => t.index > current.index).length);
$('#current').textContent = current?.title || '';

// Server connection + "already saved" indicator
try {
  const h = await fetch(base() + '/api/health').then(r => r.json());
  $('#conn').textContent = '● connected';
  $('#conn').className = 'conn ok';
  $('#conn').title = 'Library: ' + h.data;
  const facets = await fetch(base() + '/api/facets').then(r => r.json());
  $('#collections').replaceChildren(...facets.collections.map(c => Object.assign(document.createElement('option'), { value: c.name })));
  if (current?.url) {
    const { items } = await fetch(base() + '/api/items/lookup?url=' + encodeURIComponent(current.url)).then(r => r.json());
    if (items.length) {
      const badge = Object.assign(document.createElement('span'), { className: 'saved', textContent: '✓ Already in TabMind ' });
      $('#current').prepend(badge);
    }
  }
} catch {
  $('#conn').textContent = '● offline';
  $('#conn').className = 'conn bad';
  $('#offline').hidden = false;
  $('#main').hidden = true;
}

// Saving
function showProgress(p) {
  $('#progress').hidden = false;
  $('#bar-fill').style.width = `${p.total ? (p.finished / p.total) * 100 : 100}%`;
  if (!p.done) {
    $('#progress-text').textContent = `Saving ${p.finished} / ${p.total}…`;
    document.querySelectorAll('.grid button').forEach(b => (b.disabled = true));
    return;
  }
  const bits = [`Saved ${p.saved}`, `${p.snapshots} with snapshot`];
  if (p.closed) bits.push(`closed ${p.closed}`);
  if (p.skipped) bits.push(`${p.skipped} skipped (not web pages)`);
  if (p.failed) bits.push(`${p.failed} failed — those tabs were left open`);
  $('#progress-text').textContent = bits.join(' · ');
  if (p.errors?.length) $('#progress-text').title = p.errors.join('\n');
}

chrome.runtime.onMessage.addListener(m => { if (m.type === 'progress') showProgress(m.progress); });
const { running } = await chrome.runtime.sendMessage({ type: 'status' });
if (running) showProgress(running);

document.querySelectorAll('.grid button').forEach(btn => {
  btn.onclick = async () => {
    const scope = btn.dataset.scope;
    const close = $('#close').checked;
    const count = { current: 1, selected: selected.length, window: win.length, all: all.length }[scope];
    if (close && count > 20 && !confirm(`Save and close ${count} tabs?`)) return;
    const opts = {
      close,
      tags: $('#tags').value.split(',').map(s => s.trim()).filter(Boolean),
      collection: $('#collection').value.trim() || null,
      note: $('#note').value.trim(),
    };
    showProgress({ total: count || 1, finished: 0, done: false });
    const result = await chrome.runtime.sendMessage({ type: 'save', scope, opts });
    if (result?.error) $('#progress-text').textContent = result.error;
    else if (result) showProgress(result);
  };
});
