// Full-page UI. Reads chrome.storage.local directly (live via onChanged); all writes go through the service worker.
import { CATEGORIES } from './defaults.js';

const $ = (id) => document.getElementById(id);

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

function send(type, payload) {
  return chrome.runtime.sendMessage({ target: 'background', type, ...payload });
}

function plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'}`; }
function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
function safeHref(u) { try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:' ? u : null; } catch { return null; } }
function setMsg(node, text, isErr) { node.textContent = text || ''; node.classList.toggle('err', !!isErr); }
function ext(a) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function link(href, text, cls) { return ext(el('a', { href: safeHref(href), class: cls, text })); }

const state = { watches: [], events: [], lastSeenAt: null, run: null };
const DEFAULT_SETTINGS = { intervalMinutes: 30, notifications: true };

// ---------- tabs ----------
function showTab(name) {
  if (name !== 'sites') name = 'updates';
  for (const t of ['updates', 'sites']) {
    $(`view-${t}`).hidden = t !== name;
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
  }
  try { localStorage.setItem('ns-tab', name); } catch { /* storage unavailable */ }
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
let initialTab = 'updates';
try { initialTab = localStorage.getItem('ns-tab') || 'updates'; } catch { /* storage unavailable */ }
showTab(initialTab);

// ---------- updates ----------
function isNew(ev) { return !state.lastSeenAt || ev.at > state.lastSeenAt; }

function renderGroup(g) {
  const links = g.links.slice(0, 8);
  return el('div', { class: 'site' },
    el('div', { class: 'site-head' }, link(g.url, g.label), el('span', { class: 'when', text: ago(g.at) })),
    g.docs.length || links.length || g.texts.length ? el('ul', null,
      ...g.docs.slice(0, 15).map((d) => el('li', null,
        el('span', { class: 'badge', text: (d.ext || 'file').toUpperCase() }), link(d.href, d.text || d.href, 'lnk'))),
      g.docs.length > 15 ? el('li', { class: 'more', text: `+${g.docs.length - 15} more documents` }) : null,
      ...links.map((l) => el('li', null, link(l.href, l.text || l.href, 'lnk'))),
      g.links.length > 8 ? el('li', { class: 'more', text: `+${g.links.length - 8} more links` }) : null,
      ...g.texts.slice(0, 2).map((t) => el('li', { class: 'excerpt', text: `“${t.length > 200 ? t.slice(0, 197) + '...' : t}”` }))) : null);
}

function groupEvents(evs) {
  const map = new Map();
  for (const ev of evs) { // newest first
    let g = map.get(ev.watchId);
    if (!g) { g = { url: ev.url, label: ev.label || hostOf(ev.url), at: ev.at, docs: [], links: [], texts: [], hrefs: new Set() }; map.set(ev.watchId, g); }
    for (const d of ev.newDocuments || []) if (!g.hrefs.has(d.href)) { g.hrefs.add(d.href); g.docs.push(d); }
    for (const l of ev.newLinks || []) if (!g.hrefs.has(l.href)) { g.hrefs.add(l.href); g.links.push(l); }
    for (const t of ev.addedText || []) if (!g.texts.includes(t)) g.texts.push(t);
  }
  return [...map.values()];
}

function renderUpdates() {
  const fresh = state.events.filter(isNew);
  const old = state.events.filter((e) => !isNew(e));
  $('new-items').replaceChildren(...groupEvents(fresh).map(renderGroup));
  $('mark-seen').hidden = fresh.length === 0;
  const empty = $('new-empty');
  empty.hidden = fresh.length > 0;
  empty.className = 'calm';
  const when = state.lastSeenAt ? new Date(state.lastSeenAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'you started';
  empty.textContent = `Nothing new since ${when}`;

  let n = 0;
  for (const e of fresh) n += Math.max(1, (e.newDocuments || []).length + (e.newLinks || []).length);
  document.title = n > 0 ? `(${n}) News Scanner` : 'News Scanner';

  $('earlier-count').textContent = old.length ? `(${old.length})` : '';
  $('earlier-empty').hidden = old.length > 0;
  $('earlier').replaceChildren(...old.slice(0, 60).map((ev) => el('li', { class: 'event' },
    el('div', null, link(ev.url, ev.label || hostOf(ev.url)), ' ', el('span', { class: 'when', text: ago(ev.at) })),
    el('div', { class: 'what', text: ev.summary }),
    (ev.newDocuments || []).length ? el('ul', { class: 'docs' }, ...ev.newDocuments.map((d) =>
      el('li', null, el('span', { class: 'badge', text: (d.ext || 'file').toUpperCase() }), link(d.href, d.text || d.href)))) : null)));

  const bad = state.watches.filter((w) => w.lastStatus === 'error');
  $('errors-box').hidden = bad.length === 0;
  $('errors-summary').textContent = `Couldn't check (${bad.length})`;
  $('errors').replaceChildren(...bad.map((w) => el('li', null,
    link(w.url, w.label || hostOf(w.url)), el('div', { class: 'err-text', text: w.lastError || 'Check failed' }))));
}

$('mark-seen').addEventListener('click', async () => {
  const r = await send('markSeen');
  if (r && r.lastSeenAt) { state.lastSeenAt = r.lastSeenAt; renderUpdates(); }
});

// ---------- sites ----------
function statusOf(w) {
  if (w.lastStatus === 'error') return { key: 'error', text: "Couldn't check", title: w.lastError || 'Check failed', bad: true };
  if (w.lastStatus === 'ok') return w.lastChanged
    ? { key: 'ok', text: `OK · changed ${ago(w.lastChanged)}` }
    : { key: 'ok', text: 'No changes yet' };
  return { key: '', text: 'Not checked yet' };
}
const catOf = (w) => (CATEGORIES.includes(w.category) ? w.category : 'Other');
const nameOf = (w) => w.label || hostOf(w.url);
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' });

function renderSites() {
  const all = state.watches;
  const ok = all.filter((w) => w.lastStatus === 'ok').length;
  const bad = all.filter((w) => w.lastStatus === 'error').length;
  const wait = all.length - ok - bad;
  $('totals').textContent = `${plural(all.length, 'site')} · ${ok} OK · ${bad} couldn't check${wait ? ` · ${wait} not checked yet` : ''}`;
  const q = $('filter').value.trim().toLowerCase();
  const shown = all.filter((w) => !q || `${w.label} ${w.url} ${catOf(w)}`.toLowerCase().includes(q));
  $('watches-empty').hidden = shown.length > 0;
  const dir = $('directory');
  dir.replaceChildren();
  for (const cat of CATEGORIES) {
    const items = shown.filter((w) => catOf(w) === cat).sort(byName);
    if (!items.length) continue;
    dir.append(el('h3', { class: 'cat' }, cat, el('span', { class: 'count', text: `${items.length}` })));
    dir.append(el('ul', { class: 'rows' }, ...items.map((w) => {
      const st = statusOf(w);
      const rm = el('button', { class: 'link danger', type: 'button', text: 'Remove' });
      rm.addEventListener('click', async () => {
        if (!confirm(`Stop watching "${nameOf(w)}"?`)) return;
        await send('removeWatch', { id: w.id });
      });
      return el('li', null,
        el('span', { class: `dot ${st.key}` }),
        el('span', { class: 'grow' }, link(w.url, nameOf(w), 'name'), el('span', { class: 'domain', text: hostOf(w.url) }),
          w.documentsOnly ? el('span', { class: 'tag', text: 'docs only' }) : null,
          w.selector ? el('span', { class: 'tag', text: 'part of page' }) : null),
        el('span', { class: `st${st.bad ? ' bad' : ''}`, text: st.text, title: st.title || '' }),
        el('span', { class: 'when', text: w.lastChecked ? `checked ${ago(w.lastChecked)}` : '' }),
        link(w.url, 'Open ↗', 'link-a'), rm);
    })));
  }
}
$('filter').addEventListener('input', renderSites);

function sortedAll() {
  const out = [];
  for (const cat of CATEGORIES) state.watches.filter((w) => catOf(w) === cat).sort(byName).forEach((w) => out.push([cat, w]));
  return out;
}

$('copy-list').addEventListener('click', async () => {
  let text = '', last = '';
  for (const [cat, w] of sortedAll()) {
    if (cat !== last) { text += `${text ? '\n' : ''}${cat}\n`; last = cat; }
    text += `${nameOf(w)} — ${w.url}\n`;
  }
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = el('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    t.remove();
  }
  setMsg($('list-msg'), 'List copied to clipboard.');
  setTimeout(() => setMsg($('list-msg'), ''), 3000);
});

$('export-csv').addEventListener('click', () => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['category', 'label', 'url', 'status', 'lastChecked']];
  for (const [cat, w] of sortedAll()) rows.push([cat, nameOf(w), w.url, statusOf(w).text, w.lastChecked || '']);
  const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'news-scanner-sites.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- add form ----------
$('add-category').replaceChildren(...CATEGORIES.map((c) => el('option', { value: c, text: c })));
$('add-category').value = 'Other';

$('add-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('add-btn'); btn.disabled = true; setMsg($('add-msg'), '');
  const r = await send('addWatch', {
    url: $('add-url').value.trim(), label: $('add-label').value.trim(), category: $('add-category').value,
    selector: $('add-selector').value.trim(), documentsOnly: $('add-docs').checked,
  });
  if (r && r.ok) {
    $('add-form').reset(); $('add-category').value = 'Other';
    setMsg($('add-msg'), 'Added. Taking a first snapshot now.');
  } else setMsg($('add-msg'), (r && r.error) || 'Could not add the site', true);
  btn.disabled = false;
});

// ---------- data + progress ----------
function runActive() {
  const r = state.run;
  return !!(r && r.running && r.heartbeat && Date.now() - new Date(r.heartbeat).getTime() < 120000);
}

function renderProgress() {
  const on = runActive();
  $('progress').hidden = !on;
  $('check-all').disabled = on;
  if (on) {
    const { done, total } = state.run;
    $('progress-text').textContent = `Checking ${Math.min(done + 1, total)} of ${total}…`;
    $('bar-fill').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  }
}

async function load() {
  const d = await chrome.storage.local.get({ watches: [], states: {}, events: [], lastSeenAt: null, run: null });
  state.watches = d.watches.map((w) => ({ ...w, ...(d.states[w.id] || {}) }));
  state.events = d.events;
  state.lastSeenAt = d.lastSeenAt;
  state.run = d.run;
  renderUpdates(); renderSites(); renderProgress();
}

let timer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !['watches', 'states', 'events', 'lastSeenAt', 'run'].some((k) => k in changes)) return;
  clearTimeout(timer);
  timer = setTimeout(load, 120);
});

$('check-all').addEventListener('click', async () => {
  $('check-all').disabled = true;
  const r = await send('checkAll');
  if (!r || !r.started) renderProgress();
});

// ---------- settings ----------
async function loadSettings() {
  const { settings } = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  const s = { ...DEFAULT_SETTINGS, ...settings };
  $('interval').value = s.intervalMinutes;
  $('notifications').checked = s.notifications;
}

$('settings-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('save-btn'); btn.disabled = true; setMsg($('settings-msg'), '');
  const r = await send('saveSettings', { intervalMinutes: Number($('interval').value) || 30, notifications: $('notifications').checked });
  if (r && r.ok) { setMsg($('settings-msg'), 'Saved.'); $('interval').value = r.settings.intervalMinutes; }
  else setMsg($('settings-msg'), (r && r.error) || 'Could not save', true);
  btn.disabled = false;
});

$('reset-defaults').addEventListener('click', async () => {
  if (!confirm('Re-add any built-in sites you have removed? Your other sites are not changed.')) return;
  const r = await send('resetDefaults');
  setMsg($('settings-msg'), r && r.ok ? (r.added ? `Added ${plural(r.added, 'site')}.` : 'Nothing was missing.') : 'Could not reset', !(r && r.ok));
});

loadSettings();
load();
setInterval(() => { renderUpdates(); renderSites(); renderProgress(); }, 60000);
