'use strict';
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

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return plural(Math.round(s / 60), 'minute');
  if (s < 86400) return plural(Math.round(s / 3600), 'hour');
  return plural(Math.round(s / 86400), 'day');
}
function plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'} ago`; }
function hostOf(u) { try { return new URL(u).hostname; } catch { return u; } }
function safeHref(u) { try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:' ? u : null; } catch { return null; } }
function setMsg(node, text, isErr) { node.textContent = text || ''; node.classList.toggle('err', !!isErr); }

function renderWatches(list) {
  const ul = $('watches');
  ul.replaceChildren();
  $('watches-empty').hidden = list.length > 0;
  for (const w of list) {
    const status = w.lastStatus === 'ok' ? 'ok' : w.lastStatus === 'error' ? 'error' : '';
    const checkBtn = el('button', { class: 'link', type: 'button', text: 'Check now' });
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true; checkBtn.textContent = 'Checking...';
      try { await api('POST', `/api/watches/${w.id}/check`); } catch (e) { alert(e.message); }
      refresh();
    });
    const rmBtn = el('button', { class: 'link danger', type: 'button', text: 'Remove' });
    rmBtn.addEventListener('click', async () => {
      if (!confirm('Stop watching this page?')) return;
      try { await api('DELETE', `/api/watches/${w.id}`); } catch (e) { alert(e.message); }
      refresh();
    });
    const href = safeHref(w.url);
    const li = el('li', null,
      el('div', { class: 'item-head' },
        el('span', { class: `dot ${status}`, title: status || 'not checked yet' }),
        el('span', { class: 'title title-row', text: w.label || hostOf(w.url) }),
        w.documentsOnly ? el('span', { class: 'tag', text: 'docs only' }) : null,
        w.selector ? el('span', { class: 'tag', text: 'part of page' }) : null),
      el('a', { class: 'url', href, target: '_blank', rel: 'noopener noreferrer', text: w.url }),
      el('div', { class: 'meta' },
        el('span', { text: `Checked ${ago(w.lastChecked)}` }),
        el('span', { text: `Changed ${ago(w.lastChanged)}` }),
        el('span', { class: 'spacer' }), checkBtn, rmBtn),
      w.lastStatus === 'error' ? el('div', { class: 'err-text', text: w.lastError || 'Check failed' }) : null);
    ul.append(li);
  }
}

function renderEvents(list) {
  const ul = $('events');
  ul.replaceChildren();
  $('events-empty').hidden = list.length > 0;
  for (const ev of list.slice(0, 30)) {
    const docs = ev.newDocuments || [];
    const href = safeHref(ev.url);
    ul.append(el('li', { class: 'event' },
      el('div', null, el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: ev.label || hostOf(ev.url) }),
        ' ', el('span', { class: 'when', text: ago(ev.at) })),
      el('div', { class: 'what', text: ev.summary }),
      docs.length ? el('ul', { class: 'docs' }, ...docs.map((d) =>
        el('li', null, el('span', { class: 'badge', text: (d.ext || 'file').toUpperCase() }),
          el('a', { href: safeHref(d.href), target: '_blank', rel: 'noopener noreferrer', text: d.text || d.href })))) : null));
  }
}

async function refresh() {
  try {
    const [w, e] = await Promise.all([api('GET', '/api/watches'), api('GET', '/api/events')]);
    renderWatches(w); renderEvents(e);
    setMsg($('refresh-msg'), '');
  } catch (err) { setMsg($('refresh-msg'), err.message, true); }
}

$('add-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('add-btn'); btn.disabled = true; setMsg($('add-msg'), '');
  try {
    await api('POST', '/api/watches', {
      url: $('add-url').value.trim(), label: $('add-label').value.trim(),
      selector: $('add-selector').value.trim(), documentsOnly: $('add-docs').checked,
    });
    $('add-form').reset();
    setMsg($('add-msg'), 'Added. Taking a first snapshot now.');
    setTimeout(refresh, 1500); setTimeout(refresh, 6000);
  } catch (e) { setMsg($('add-msg'), e.message, true); }
  btn.disabled = false; refresh();
});

$('check-all').addEventListener('click', async () => {
  try { await api('POST', '/api/check-all'); setMsg($('refresh-msg'), 'Checking...'); setTimeout(refresh, 3000); setTimeout(refresh, 10000); }
  catch (e) { setMsg($('refresh-msg'), e.message, true); }
});

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

// Suggest sensible port when security changes (only if the port still holds a default).
$('smtp-security').addEventListener('change', () => {
  const p = $('smtp-port'), v = $('smtp-security').value;
  if (['', '465', '587', '25'].includes(p.value)) p.value = v === 'tls' ? '465' : v === 'starttls' ? '587' : '25';
});

loadSettings();
refresh();
setInterval(refresh, 30000);
