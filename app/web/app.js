'use strict';
const $ = (id) => document.getElementById(id);
const CATEGORIES = [
  'Federal Government',
  'State & Territory – Resources Departments',
  'State Premiers & Ministerial Releases',
  'Planning & Industry Bodies',
  'Companies',
  'Other',
];

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

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('Login required'); }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
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
function ext(a) { return a.target = '_blank', a.rel = 'noopener noreferrer', a; }
function link(href, text, cls) { return ext(el('a', { href: safeHref(href), class: cls, text })); }

const state = { watches: [], events: [], lastSeenAt: null, running: false };

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
  const box = $('new-items');
  box.replaceChildren(...groupEvents(fresh).map(renderGroup));
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
  try { const r = await api('POST', '/api/seen'); state.lastSeenAt = r.lastSeenAt; renderUpdates(); }
  catch (e) { alert(e.message); }
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
    const items = shown.filter((w) => catOf(w) === cat)
      .sort((a, b) => (a.label || hostOf(a.url)).localeCompare(b.label || hostOf(b.url), undefined, { sensitivity: 'base' }));
    if (!items.length) continue;
    dir.append(el('h3', { class: 'cat' }, cat, el('span', { class: 'count', text: `${items.length}` })));
    dir.append(el('ul', { class: 'rows' }, ...items.map((w) => {
      const st = statusOf(w);
      const rm = el('button', { class: 'link danger', type: 'button', text: 'Remove' });
      rm.addEventListener('click', async () => {
        if (!confirm(`Stop watching "${w.label || hostOf(w.url)}"?`)) return;
        try { await api('DELETE', `/api/watches/${w.id}`); } catch (e) { alert(e.message); }
        refresh();
      });
      return el('li', null,
        el('span', { class: `dot ${st.key}` }),
        el('span', { class: 'grow' }, link(w.url, w.label || hostOf(w.url), 'name'), el('span', { class: 'domain', text: hostOf(w.url) }),
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
  for (const cat of CATEGORIES) {
    state.watches.filter((w) => catOf(w) === cat)
      .sort((a, b) => (a.label || hostOf(a.url)).localeCompare(b.label || hostOf(b.url), undefined, { sensitivity: 'base' }))
      .forEach((w) => out.push([cat, w]));
  }
  return out;
}

$('copy-list').addEventListener('click', async () => {
  let text = '', last = '';
  for (const [cat, w] of sortedAll()) {
    if (cat !== last) { text += `${text ? '\n' : ''}${cat}\n`; last = cat; }
    text += `${w.label || hostOf(w.url)} — ${w.url}\n`;
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
  for (const [cat, w] of sortedAll()) rows.push([cat, w.label || hostOf(w.url), w.url, statusOf(w).text, w.lastChecked || '']);
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
  try {
    await api('POST', '/api/watches', {
      url: $('add-url').value.trim(), label: $('add-label').value.trim(), category: $('add-category').value,
      selector: $('add-selector').value.trim(), documentsOnly: $('add-docs').checked,
    });
    $('add-form').reset(); $('add-category').value = 'Other';
    setMsg($('add-msg'), 'Added. Taking a first snapshot now.');
    setTimeout(refresh, 1500); setTimeout(refresh, 6000);
  } catch (e) { setMsg($('add-msg'), e.message, true); }
  btn.disabled = false; refresh();
});

// ---------- data + progress ----------
async function refresh() {
  try {
    const [w, e, s] = await Promise.all([api('GET', '/api/watches'), api('GET', '/api/events'), api('GET', '/api/seen')]);
    state.watches = w; state.events = e; state.lastSeenAt = s.lastSeenAt;
    renderUpdates(); renderSites();
  } catch (err) { setMsg($('list-msg'), err.message, true); }
}

async function pollStatus() {
  try {
    const s = await api('GET', '/api/status');
    $('progress').hidden = !s.running;
    $('check-all').disabled = s.running;
    if (s.running) {
      $('progress-text').textContent = `Checking ${Math.min(s.done + 1, s.total)} of ${s.total}…`;
      $('bar-fill').style.width = `${s.total ? Math.round((s.done / s.total) * 100) : 0}%`;
    }
    if (state.running && !s.running) refresh();
    else if (s.running && s.done % 3 === 0 && s.done !== state.lastDone) refresh();
    state.running = s.running; state.lastDone = s.done;
  } catch { /* transient */ }
}

$('check-all').addEventListener('click', async () => {
  $('check-all').disabled = true;
  try { await api('POST', '/api/check-all'); setTimeout(pollStatus, 300); }
  catch (e) { alert(e.message); }
});

// ---------- settings ----------
async function loadSettings() {
  try {
    const s = await api('GET', '/api/settings');
    $('notify-email').value = s.notifyEmail || '';
    $('interval').value = s.intervalMinutes;
    $('smtp-host').value = s.smtp.host || '';
    $('smtp-port').value = s.smtp.port || '';
    $('smtp-security').value = s.smtp.security || 'tls';
    $('smtp-user').value = s.smtp.username || '';
    $('smtp-from').value = s.smtp.from || '';
    $('smtp-pass').value = '';
    $('smtp-pass').placeholder = s.smtp.passwordSet ? 'Saved (leave empty to keep)' : '';
  } catch (e) { setMsg($('settings-msg'), e.message, true); }
}

$('settings-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('save-btn'); btn.disabled = true; setMsg($('settings-msg'), '');
  try {
    await api('PUT', '/api/settings', {
      notifyEmail: $('notify-email').value.trim(),
      intervalMinutes: Number($('interval').value) || 30,
      smtp: {
        host: $('smtp-host').value.trim(), port: Number($('smtp-port').value) || 465,
        security: $('smtp-security').value, username: $('smtp-user').value.trim(),
        password: $('smtp-pass').value, from: $('smtp-from').value.trim(),
      },
    });
    setMsg($('settings-msg'), 'Saved.');
    loadSettings();
  } catch (e) { setMsg($('settings-msg'), e.message, true); }
  btn.disabled = false;
});

$('test-email').addEventListener('click', async () => {
  setMsg($('settings-msg'), 'Sending...');
  try { await api('POST', '/api/test-email'); setMsg($('settings-msg'), 'Test email sent. Check your inbox.'); }
  catch (e) { setMsg($('settings-msg'), e.message, true); }
});

$('reset-defaults').addEventListener('click', async () => {
  if (!confirm('Re-add any built-in sites you have removed? Your other sites are not changed.')) return;
  try {
    const r = await api('POST', '/api/reset-defaults');
    setMsg($('settings-msg'), r.added ? `Added ${plural(r.added, 'site')}.` : 'Nothing was missing.');
    refresh();
  } catch (e) { setMsg($('settings-msg'), e.message, true); }
});

$('smtp-security').addEventListener('change', () => {
  const p = $('smtp-port'), v = $('smtp-security').value;
  if (['', '465', '587', '25'].includes(p.value)) p.value = v === 'tls' ? '465' : v === 'starttls' ? '587' : '25';
});

loadSettings();
refresh();
pollStatus();
setInterval(pollStatus, 1500);
setInterval(refresh, 60000);
