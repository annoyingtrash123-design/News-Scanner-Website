// Service worker: scheduling, checking, storage. It is the only writer of extension data.
import { DEFAULTS, CATEGORIES } from './defaults.js';
import * as lib from './lib.js';

const ACCENT = '#2563eb';
const UI_URL = chrome.runtime.getURL('ui.html');
const DEFAULT_SETTINGS = { intervalMinutes: 30, notifications: true };
const MIN_INTERVAL = 15;
const MAX_INTERVAL = 1440;

// ---------- storage helpers ----------

let chain = Promise.resolve();
/** Serialise read-modify-write sections so concurrent checks never lose each other's updates. */
function locked(fn) {
  const p = chain.then(() => fn());
  chain = p.catch(() => {});
  return p;
}

const nowIso = () => new Date().toISOString();

async function getSettings() {
  const { settings } = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function seedDefaults(reset) {
  return locked(async () => {
    const d = await chrome.storage.local.get({ watches: [], seededDefaults: [] });
    const data = { watches: d.watches, seededDefaults: reset ? [] : d.seededDefaults };
    const added = lib.seedFrom(DEFAULTS, data, nowIso());
    await chrome.storage.local.set({ watches: data.watches, seededDefaults: data.seededDefaults });
    return added;
  });
}

async function addWatch(b) {
  return locked(async () => {
    let url;
    try { url = lib.validateUrl(b.url); } catch (e) { return { ok: false, error: e.message }; }
    const d = await chrome.storage.local.get({ watches: [] });
    if (d.watches.some((w) => w.url === url)) return { ok: false, error: 'You are already watching that page' };
    const w = {
      id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      label: String(b.label || '').trim().slice(0, 100),
      selector: String(b.selector || '').trim(),
      documentsOnly: !!b.documentsOnly,
      category: CATEGORIES.includes(b.category) ? b.category : 'Other',
      createdAt: nowIso(),
    };
    d.watches.push(w);
    await chrome.storage.local.set({ watches: d.watches });
    return { ok: true, id: w.id };
  });
}

async function removeWatch(id) {
  return locked(async () => {
    const d = await chrome.storage.local.get({ watches: [], states: {} });
    delete d.states[id];
    await chrome.storage.local.set({ watches: d.watches.filter((w) => w.id !== id), states: d.states });
    await chrome.storage.local.remove(`snap:${id}`);
    return { ok: true };
  });
}

async function markSeen() {
  const at = nowIso();
  await locked(() => chrome.storage.local.set({ lastSeenAt: at }));
  await updateBadge();
  return { ok: true, lastSeenAt: at };
}

async function saveSettings(b) {
  const cur = await getSettings();
  let n = Math.round(Number(b.intervalMinutes));
  if (!Number.isFinite(n)) n = cur.intervalMinutes;
  const settings = {
    intervalMinutes: Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, n)),
    notifications: b.notifications === undefined ? cur.notifications : !!b.notifications,
  };
  await locked(() => chrome.storage.local.set({ settings }));
  await ensureAlarm(true);
  return { ok: true, settings };
}

// ---------- badge / notifications / UI tab ----------

async function updateBadge() {
  const { events, lastSeenAt } = await chrome.storage.local.get({ events: [], lastSeenAt: null });
  const n = events.filter((e) => !lastSeenAt || e.at > lastSeenAt).length;
  await chrome.action.setBadgeBackgroundColor({ color: ACCENT });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: n ? (n > 99 ? '99+' : String(n)) : '' });
}

async function openUi() {
  try {
    const tabs = await chrome.tabs.query({ url: UI_URL });
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
  } catch { /* fall through to opening a new tab */ }
  await chrome.tabs.create({ url: UI_URL });
}

async function notifyRun(events) {
  const settings = await getSettings();
  if (!settings.notifications) return;
  const n = lib.buildNotification(events);
  if (!n) return;
  chrome.notifications.create(`ns-${Date.now()}`, {
    type: 'basic', iconUrl: 'icons/icon128.png', title: n.title, message: n.message, priority: 1,
  });
}

// ---------- offscreen document ----------

let creating = null;
async function ensureOffscreen() {
  if (creating) return creating;
  creating = (async () => {
    try {
      const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (ctx.length) return;
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'Parse fetched web pages to find what changed',
      });
    } catch (e) {
      if (!/single offscreen|already exists/i.test(String(e && e.message))) throw e;
    } finally {
      creating = null;
    }
  })();
  return creating;
}

async function closeOffscreen() {
  try { await chrome.offscreen.closeDocument(); } catch { /* none open */ }
}

async function scanPage(w) {
  const msg = { target: 'offscreen', type: 'scan', url: w.url, selector: w.selector || '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureOffscreen();
      const r = await Promise.race([
        chrome.runtime.sendMessage(msg),
        new Promise((res) => setTimeout(() => res({ ok: false, error: 'Timed out after 20s' }), 45000)),
      ]);
      if (r) return r;
    } catch { /* offscreen not ready or was closed: retry once */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { ok: false, error: 'Internal error: page parser unavailable' };
}

// ---------- checking ----------

let active = null;
const queued = new Set();

async function checkOne(w) {
  const scan = await scanPage(w);
  const now = nowIso();
  return locked(async () => {
    const d = await chrome.storage.local.get({ watches: [], states: {}, events: [] });
    if (!d.watches.some((x) => x.id === w.id)) return null; // removed while checking
    const snapKey = `snap:${w.id}`;
    const prevMeta = d.states[w.id] || {};
    const toSet = {};
    let event = null;
    if (scan.ok) {
      const prevSnap = (await chrome.storage.local.get(snapKey))[snapKey] || { lines: [], links: [] };
      const out = lib.processScan(w, { meta: prevMeta, snap: prevSnap }, scan.content, now);
      d.states[w.id] = out.meta;
      toSet[snapKey] = out.snap;
      event = out.event;
    } else {
      d.states[w.id] = lib.errorMeta(prevMeta, now, scan.error);
    }
    toSet.states = d.states;
    if (event) toSet.events = [event, ...d.events].slice(0, lib.MAX_EVENTS);
    try {
      await chrome.storage.local.set(toSet);
    } catch (e) {
      d.states[w.id] = lib.errorMeta(prevMeta, now, `Could not save result: ${e.message}`);
      await chrome.storage.local.set({ states: d.states });
      return null;
    }
    return event;
  });
}

/** Start a check run (all watches, or only the given ids). Returns false if one is already running. */
function runChecks(onlyIds) {
  if (active) {
    if (onlyIds) onlyIds.forEach((id) => queued.add(id));
    return false;
  }
  active = doRun(onlyIds).catch((e) => console.error('run failed', e)).finally(() => {
    active = null;
    if (queued.size) { const ids = [...queued]; queued.clear(); runChecks(ids); }
  });
  return true;
}

async function doRun(onlyIds) {
  const { watches } = await chrome.storage.local.get({ watches: [] });
  const list = onlyIds ? watches.filter((w) => onlyIds.includes(w.id)) : watches;
  if (!list.length) return;
  const run = { running: true, done: 0, total: list.length, startedAt: nowIso(), heartbeat: nowIso(), finishedAt: null };
  await chrome.storage.local.set({ run });
  const events = [];
  try {
    await ensureOffscreen();
    await lib.forEachBounded(list, lib.MAX_CONCURRENT, (w) => lib.hostKey(w.url), async (w) => {
      try {
        const ev = await checkOne(w);
        if (ev) events.push(ev);
      } finally {
        run.done++;
        run.heartbeat = nowIso();
        await chrome.storage.local.set({ run });
      }
    });
  } finally {
    run.running = false;
    run.finishedAt = nowIso();
    await chrome.storage.local.set({ run });
    await closeOffscreen();
    await updateBadge();
  }
  if (events.length) await notifyRun(events);
}

// ---------- scheduling ----------

async function ensureAlarm(force) {
  const { intervalMinutes } = await getSettings();
  const a = await chrome.alarms.get('check');
  if (!a || force || a.periodInMinutes !== intervalMinutes) {
    await chrome.alarms.create('check', { periodInMinutes: intervalMinutes, delayInMinutes: intervalMinutes });
  }
}

/** Runs each time the worker starts. A fresh worker means any earlier run died, so clear its flag. */
async function init() {
  try {
    const { run } = await chrome.storage.local.get({ run: null });
    if (run && run.running) await chrome.storage.local.set({ run: { ...run, running: false, finishedAt: nowIso() } });
    await ensureAlarm(false);
    await updateBadge();
  } catch (e) { console.error('init failed', e); }
}
const ready = init();

chrome.runtime.onInstalled.addListener(async () => {
  await ready;
  await seedDefaults(false);
  await ensureAlarm(true);
  runChecks();
});

chrome.runtime.onStartup.addListener(async () => {
  await ready;
  await seedDefaults(false);
  runChecks();
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'check') return;
  await ready;
  runChecks();
});

chrome.action.onClicked.addListener(() => { openUi(); });
chrome.notifications.onClicked.addListener((id) => { chrome.notifications.clear(id); openUi(); });

// ---------- messages from ui.js ----------

const handlers = {
  async checkAll() { return { ok: true, started: runChecks() }; },
  async addWatch(m) {
    const r = await addWatch(m);
    if (r.ok) runChecks([r.id]);
    return r;
  },
  removeWatch: (m) => removeWatch(m.id),
  async resetDefaults() {
    const added = await seedDefaults(true);
    if (added.length) runChecks(added);
    return { ok: true, added: added.length };
  },
  markSeen,
  saveSettings,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'background' || !handlers[msg.type]) return false;
  ready.then(() => handlers[msg.type](msg)).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});
