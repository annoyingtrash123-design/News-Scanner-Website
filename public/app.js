(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  async function api(method, url, body) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Login required'); }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) n.append(kid);
    return n;
  }

  function ago(iso) {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    const units = [['d', 86400], ['h', 3600], ['m', 60]];
    for (const [u, sec] of units) if (s >= sec) return `${Math.floor(s / sec)}${u} ago`;
    return 'just now';
  }
  const host = (u) => { try { return new URL(u).hostname; } catch { return u; } };
  const setMsg = (node, text, isErr) => { node.textContent = text || ''; node.classList.toggle('err', Boolean(isErr)); };

  let timer = null;
  function showLogin() {
    $('app').hidden = true; $('login').hidden = false;
    clearInterval(timer); timer = null;
  }
  function showApp(authRequired) {
    $('login').hidden = true; $('app').hidden = false;
    $('logout').hidden = !authRequired;
    refresh(); loadSettings();
    if (!timer) timer = setInterval(refresh, 60000);
  }

  function renderWatches(list) {
    const ul = $('watches'); ul.replaceChildren();
    $('watches-empty').hidden = list.length > 0;
    for (const w of list) {
      const status = w.lastStatus || 'pending';
      const checkBtn = el('button', { class: 'link', type: 'button', text: 'Check now' });
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true; checkBtn.textContent = 'Checking...';
        try { await api('POST', `/api/watches/${w.id}/check`); } catch (e) { alert(e.message); }
        refresh();
      });
      const rm = el('button', { class: 'link danger', type: 'button', text: 'Remove' });
      rm.addEventListener('click', async () => {
        if (!confirm('Stop watching this page?')) return;
        try { await api('DELETE', `/api/watches/${w.id}`); } catch (e) { alert(e.message); }
        refresh();
      });
      const li = el('li', {},
        el('div', { class: 'item-head' },
          el('span', { class: `dot ${status}`, title: status }),
          el('span', { class: 'title', text: w.label || host(w.url) })),
        el('a', { class: 'url', href: w.url, target: '_blank', rel: 'noopener noreferrer', text: w.url + (w.selector ? `  [${w.selector}]` : '') }),
        w.lastStatus === 'error' ? el('div', { class: 'err-text', text: w.lastError || 'Error' }) : null,
        el('div', { class: 'meta' },
          el('span', { text: `Checked ${ago(w.lastChecked)}` }),
          el('span', { text: `Changed ${ago(w.lastChanged)}` }),
          el('span', { class: 'spacer' }), checkBtn, rm));
      ul.append(li);
    }
  }

  function renderEvents(list) {
    const ul = $('events'); ul.replaceChildren();
    $('events-empty').hidden = list.length > 0;
    for (const ev of list.slice(0, 30)) {
      ul.append(el('li', { class: 'event' },
        el('a', { href: ev.url, target: '_blank', rel: 'noopener noreferrer', text: ev.label || host(ev.url) }),
        el('div', { text: ev.summary }),
        el('div', { class: 'when', text: ago(ev.at) })));
    }
  }

  async function refresh() {
    try {
      const [w, e] = await Promise.all([api('GET', '/api/watches'), api('GET', '/api/events')]);
      renderWatches(w); renderEvents(e);
    } catch (err) { /* login handled in api() */ }
  }

  async function loadSettings() {
    try { $('notify-email').value = (await api('GET', '/api/settings')).notifyEmail || ''; } catch { /* ignore */ }
  }

  $('add-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('add-btn'); btn.disabled = true; setMsg($('add-msg'), 'Adding and taking a baseline snapshot...');
    try {
      const w = await api('POST', '/api/watches', { url: $('add-url').value, label: $('add-label').value, selector: $('add-selector').value });
      $('add-form').reset();
      if (w.lastStatus === 'error') setMsg($('add-msg'), `Added, but the first check failed: ${w.lastError}`, true);
      else setMsg($('add-msg'), 'Added. Baseline saved; you will be emailed on changes.');
      refresh();
    } catch (e) { setMsg($('add-msg'), e.message, true); }
    btn.disabled = false;
  });

  $('settings-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('PUT', '/api/settings', { notifyEmail: $('notify-email').value }); setMsg($('settings-msg'), 'Saved.'); }
    catch (e) { setMsg($('settings-msg'), e.message, true); }
  });
  $('test-email').addEventListener('click', async () => {
    setMsg($('settings-msg'), 'Sending...');
    try {
      const r = await api('POST', '/api/test-email');
      setMsg($('settings-msg'), r.logged ? 'SMTP not configured: email was logged to the server console.' : `Test email sent to ${r.to}.`);
    } catch (e) { setMsg($('settings-msg'), e.message, true); }
  });

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('POST', '/api/login', { password: $('login-pw').value }); $('login-pw').value = ''; setMsg($('login-msg'), ''); showApp(true); }
    catch (e) { setMsg($('login-msg'), e.message, true); }
  });
  $('logout').addEventListener('click', async () => { await api('POST', '/api/logout').catch(() => {}); showLogin(); });

  (async () => {
    try {
      const s = await (await fetch('/api/session', { credentials: 'same-origin' })).json();
      if (s.authRequired && !s.authenticated) showLogin(); else showApp(s.authRequired);
    } catch { showApp(false); }
  })();
})();
