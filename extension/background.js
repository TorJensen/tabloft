// TabMind background worker: captures tabs (link + text + MHTML snapshot + screenshot)
// and ships them to the local TabMind server.
import { CONSENT_SELECTORS, hideConsentInPage, restoreConsentInPage } from './consent.js';

const DEFAULTS = {
  server: 'http://127.0.0.1:7878',
  closeAfterSave: true,
  loadUnloaded: true,     // reload sleeping/discarded tabs so they can be snapshotted
  screenshots: true,      // screenshot tabs that are currently visible
  skipPinned: true,       // bulk saves never close pinned tabs
  hideConsent: true,      // hide cookie banners while capturing (restored right after)
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

function detectBrowser() {
  if (navigator.brave) return 'Brave';
  const brands = (navigator.userAgentData?.brands || []).map(b => b.brand);
  if (brands.some(b => /Edge/i.test(b)) || /Edg\//.test(navigator.userAgent)) return 'Edge';
  if (brands.some(b => /Opera/i.test(b)) || /OPR\//.test(navigator.userAgent)) return 'Opera';
  if (brands.some(b => /Vivaldi/i.test(b))) return 'Vivaldi';
  return 'Chrome';
}

const capturable = url => /^https?:\/\//i.test(url || '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForLoad(tabId, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return null;
    if (t.status === 'complete' && !t.discarded) { await sleep(600); return t; }
    await sleep(400);
  }
  return chrome.tabs.get(tabId).catch(() => null);
}

async function pageInfo(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const meta = n => document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content || null;
        return {
          title: document.title,
          description: meta('og:description') || meta('description'),
          ogImage: meta('og:image') || meta('twitter:image'),
          text: (document.body?.innerText || '').slice(0, 1_000_000),
        };
      },
    });
    return result || {};
  } catch {
    return {};
  }
}

async function screenshot(tab) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    // Downscale to keep the library light.
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, 1280 / bmp.width);
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return 'data:image/jpeg;base64,' + btoa(bin);
  } catch {
    return null;
  }
}

async function api(path, opts = {}) {
  const { server } = await getSettings();
  const res = await fetch(server.replace(/\/$/, '') + path, opts);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// Capture one tab. Returns { ok, id, snapshot, error }.
async function captureTab(tab, opts, settings) {
  if (!capturable(tab.url)) return { ok: false, skipped: true, error: 'Not a web page' };
  let t = tab;
  const sleeping = t.discarded || t.status === 'unloaded';
  if (sleeping && settings.loadUnloaded) {
    await chrome.tabs.reload(t.id).catch(() => {});
    t = (await waitForLoad(t.id)) || t;
  } else if (t.status === 'loading') {
    t = (await waitForLoad(t.id, 10000)) || t;
  }
  const live = !t.discarded && t.status !== 'unloaded';
  let hid = 0;
  if (live && settings.hideConsent) {
    try {
      [{ result: hid }] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: hideConsentInPage, args: [CONSENT_SELECTORS] });
      if (hid) await sleep(150); // let the page repaint before the screenshot
    } catch {}
  }
  try {
    return await capturePage(t, live, opts, settings);
  } finally {
    if (hid) chrome.scripting.executeScript({ target: { tabId: t.id }, func: restoreConsentInPage }).catch(() => {});
  }
}

async function capturePage(t, live, opts, settings) {
  const info = live ? await pageInfo(t.id) : {};
  const shot = live && t.active && settings.screenshots ? await screenshot(t) : null;

  const saved = await api('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: t.url,
      title: info.title || t.title,
      favIconUrl: t.favIconUrl && !t.favIconUrl.startsWith('chrome') ? t.favIconUrl : null,
      description: info.description,
      ogImage: info.ogImage,
      text: info.text,
      screenshot: shot,
      browser: detectBrowser(),
      tags: opts.tags || [],
      collection: opts.collection || null,
      note: opts.note || '',
    }),
  });

  let snapshot = false;
  if (live) {
    try {
      const blob = await chrome.pageCapture.saveAsMHTML({ tabId: t.id });
      if (blob?.size) {
        await api(`/api/items/${saved.id}/snapshot`, { method: 'PUT', headers: { 'Content-Type': 'multipart/related' }, body: blob });
        snapshot = true;
      }
    } catch (e) {
      console.warn('Snapshot failed for', t.url, e);
    }
  }
  return { ok: true, id: saved.id, snapshot, existed: saved.existed };
}

let running = null;

function broadcast(progress) {
  chrome.storage.session.set({ progress }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'progress', progress }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  chrome.action.setBadgeText({ text: progress.done ? '' : `${progress.finished}/${progress.total}` });
}

// Save a list of tabs; optionally close the ones that saved successfully.
export async function saveTabs(tabs, opts = {}) {
  if (running) return { error: 'A save is already in progress' };
  const settings = await getSettings();
  const close = opts.close ?? settings.closeAfterSave;
  const progress = { total: tabs.length, finished: 0, saved: 0, snapshots: 0, failed: 0, skipped: 0, done: false, errors: [] };
  const toClose = [];
  running = progress;
  broadcast(progress);

  const queue = [...tabs];
  const worker = async () => {
    while (queue.length) {
      const tab = queue.shift();
      try {
        const r = await captureTab(tab, opts, settings);
        if (r.ok) {
          progress.saved++;
          if (r.snapshot) progress.snapshots++;
          if (close && !(tab.pinned && settings.skipPinned && tabs.length > 1)) toClose.push(tab);
        } else if (r.skipped) progress.skipped++;
      } catch (e) {
        progress.failed++;
        progress.errors.push(`${tab.title || tab.url}: ${e.message}`);
      }
      progress.finished++;
      broadcast(progress);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(4, tabs.length) }, worker));
    if (toClose.length) await closeSafely(toClose);
  } finally {
    progress.done = true;
    progress.closed = toClose.length;
    running = null;
    broadcast(progress);
  }
  return progress;
}

// Close tabs, but never let the browser quit: if a window would be emptied, leave the library open in it.
async function closeSafely(tabs) {
  const ids = new Set(tabs.map(t => t.id));
  const byWindow = new Map();
  for (const t of tabs) byWindow.set(t.windowId, (byWindow.get(t.windowId) || 0) + 1);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const emptied = windows.filter(w => w.tabs.every(t => ids.has(t.id)));
  if (emptied.length && emptied.length === windows.length) {
    const { server } = await getSettings();
    await chrome.tabs.create({ windowId: emptied[0].id, url: server, active: true });
  }
  await chrome.tabs.remove([...ids]).catch(async () => {
    for (const id of ids) await chrome.tabs.remove(id).catch(() => {});
  });
}

export async function tabsFor(scope) {
  const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  switch (scope) {
    case 'current': return current ? [current] : [];
    case 'selected': return chrome.tabs.query({ highlighted: true, lastFocusedWindow: true });
    case 'window': return chrome.tabs.query({ lastFocusedWindow: true });
    case 'right': return (await chrome.tabs.query({ lastFocusedWindow: true })).filter(t => t.index > current.index);
    case 'left': return (await chrome.tabs.query({ lastFocusedWindow: true })).filter(t => t.index < current.index);
    case 'all': return chrome.tabs.query({ windowType: 'normal' });
    default: return [];
  }
}

async function ownTab(tab) {
  const { server } = await getSettings();
  return tab.url?.startsWith(server.replace(/\/$/, ''));
}

async function saveScope(scope, opts) {
  const tabs = [];
  for (const t of await tabsFor(scope)) if (!(await ownTab(t))) tabs.push(t);
  return saveTabs(tabs, opts);
}

// ---------- wiring ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'save') {
    saveScope(msg.scope, msg.opts || {}).then(reply);
    return true;
  }
  if (msg.type === 'status') { reply({ running }); return false; }
});

chrome.commands.onCommand.addListener(cmd => {
  if (cmd === 'save-tab') saveScope('current', { close: false });
  if (cmd === 'save-close-tab') saveScope('current', { close: true });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save', title: 'Save tab to TabMind', contexts: ['page', 'action'] });
    chrome.contextMenus.create({ id: 'save-close', title: 'Save tab to TabMind and close', contexts: ['page', 'action'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'Save link to TabMind', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'library', title: 'Open TabMind library', contexts: ['action'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save') saveTabs([tab], { close: false });
  if (info.menuItemId === 'save-close') saveTabs([tab], { close: true });
  if (info.menuItemId === 'library') chrome.tabs.create({ url: (await getSettings()).server });
  if (info.menuItemId === 'save-link') {
    await api('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: info.linkUrl, title: info.selectionText || info.linkUrl, browser: detectBrowser(), note: `Linked from ${tab?.url || ''}` }),
    }).catch(e => console.warn(e));
  }
});

// ---------- self-update ----------
// The installer replaces this extension's files on disk, but browsers only pick up an
// unpacked extension's new files when it reloads. The server reports the version it
// shipped; if that is newer than what's running, reload once (never mid-save).
const newer = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

async function checkExtensionUpdate() {
  if (running) return;
  try {
    const h = await api('/api/health');
    const mine = chrome.runtime.getManifest().version;
    if (!h.extVersion || !newer(h.extVersion, mine)) return;
    // Guard against a reload loop if this copy was loaded from a different folder than the installed one.
    const { reloadedFor } = await chrome.storage.local.get('reloadedFor');
    if (reloadedFor === h.extVersion) return;
    await chrome.storage.local.set({ reloadedFor: h.extVersion });
    chrome.runtime.reload();
  } catch { /* server not running */ }
}

chrome.alarms.create('tabmind-update', { periodInMinutes: 15 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tabmind-update') checkExtensionUpdate(); });
chrome.runtime.onStartup.addListener(checkExtensionUpdate);
checkExtensionUpdate();
