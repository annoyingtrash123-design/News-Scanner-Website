(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const API = 'https://api.github.com';
  const CFG_KEY = 'newsScanner.config';
  const WATCHLIST = 'data/watchlist.json';
  const STATE = 'data/state.json';
  const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'rtf', 'zip'];

  let cfg = null;        // { repo, branch, token }
  let watchlist = { notifyEmail: '', watches: [] };
  let state = { events: [] };
  let timer = null;

  // ---------- helpers ----------
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  function setMsg(node, text, isErr) { node.textContent = text || ''; node.classList.toggle('err', !!isErr); }
  function safeHref(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }
  function hostOf(u) { try { return new URL(u).hostname; } catch { return u; } }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function ago(iso) {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }
  function newId() {
    const a = new Uint8Array(6); crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function docExt(href) {
    try { const m = new URL(href).pathname.toLowerCase().match(/\.([a-z0-9]+)$/); return m && DOC_EXTS.includes(m[1]) ? m[1] : ''; } catch { return ''; }
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  // ---------- config ----------
  function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)); } catch { return null; } }
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch { /* ignore */ } }
  function guessRepo() {
    const h = location.hostname;
    if (h.endsWith('.github.io')) {
      const owner = h.slice(0, -'.github.io'.length);
      const repo = location.pathname.split('/').filter(Boolean)[0];
      if (owner && repo) return `${owner}/${repo}`;
    }
    return '';
  }

  // ---------- GitHub API ----------
  async function gh(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || `GitHub error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const repoPath = () => `/repos/${cfg.repo}`;

  async function getFile(path) {
    const data = await gh('GET', `${repoPath()}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}&_=${Date.now()}`);
    return { json: JSON.parse(b64decode(data.content)), sha: data.sha };
  }
  async function readFileOrDefault(path, fallback) {
    try { return await getFile(path); } catch (e) { if (e.status === 404) return { json: fallback, sha: null }; throw e; }
  }

  let watchlistSha = null;
  /** Apply `mutate` to the freshest watchlist and save it; retries once on conflict. */
  async function updateWatchlist(mutate, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = attempt === 0 && watchlistSha ? { json: watchlist, sha: watchlistSha } : await readFileOrDefault(WATCHLIST, { notifyEmail: '', watches: [] });
      const next = JSON.parse(JSON.stringify(cur.json));
      if (!Array.isArray(next.watches)) next.watches = [];
      mutate(next);
      try {
        const put = await gh('PUT', `${repoPath()}/contents/${WATCHLIST}`, {
          message, branch: cfg.branch, content: b64encode(JSON.stringify(next, null, 2) + '\n'), ...(cur.sha ? { sha: cur.sha } : {}),
        });
        watchlist = next; watchlistSha = put.content.sha;
        return;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt === 0) { watchlistSha = null; continue; }
        throw e;
      }
    }
  }

  async function dispatch(watchId) {
    await gh('POST', `${repoPath()}/actions/workflows/check.yml/dispatches`, {
      ref: cfg.branch, inputs: watchId ? { watch_id: watchId } : {},
    });
  }

  // ---------- views ----------
  function show(connected) {
    $('setup').hidden = connected;
    $('app').hidden = !connected;
  }

  async function reload(quiet) {
    if (!cfg) return;
    setMsg($('refresh-msg'), quiet ? '' : 'Loading…');
    try {
      const [w, s] = await Promise.all([readFileOrDefault(WATCHLIST, { notifyEmail: '', watches: [] }), readFileOrDefault(STATE, { events: [] })]);
      watchlist = w.json; watchlistSha = w.sha;
      state = s.json;
      if (!Array.isArray(watchlist.watches)) watchlist.watches = [];
      if (!Array.isArray(state.events)) state.events = [];
      render();
      setMsg($('refresh-msg'), '');
    } catch (e) {
      setMsg($('refresh-msg'), e.status === 401 ? 'Token rejected - disconnect and reconnect.' : e.message, true);
    }
  }

  function render() {
    $('repo-info').textContent = `${cfg.repo} @ ${cfg.branch}`;
    $('runs-link').href = `https://github.com/${cfg.repo}/actions/workflows/check.yml`;
    if (document.activeElement !== $('notify-email')) $('notify-email').value = watchlist.notifyEmail || '';
    renderWatches();
    renderEvents();
  }

  function renderWatches() {
    const ul = $('watches'); clear(ul);
    $('watches-empty').hidden = watchlist.watches.length > 0;
    for (const w of watchlist.watches) {
      const st = state[w.id];
      const status = !st ? 'pending' : st.lastStatus === 'error' ? 'error' : 'ok';
      const href = safeHref(w.url);
      const li = el('li', {},
        el('div', { class: 'item-head' },
          el('span', { class: `dot ${status}`, title: status === 'pending' ? 'Not checked yet' : status }),
          el('span', { class: 'title' }, w.label || hostOf(w.url)),
          w.documentsOnly ? el('span', { class: 'tag' }, 'docs only') : null),
        href ? el('a', { class: 'url', href, target: '_blank', rel: 'noopener noreferrer' }, trunc(w.url, 80)) : el('span', { class: 'url' }, trunc(w.url, 80)),
        el('div', { class: 'meta' },
          el('span', {}, `Checked ${st ? ago(st.lastChecked) : 'never'}`),
          el('span', {}, `Changed ${st ? ago(st.lastChanged) : 'never'}`),
          el('span', { class: 'spacer' }),
          el('button', { class: 'link', type: 'button', onclick: (ev) => checkNow(w, ev.currentTarget) }, 'Check now'),
          el('button', { class: 'link danger', type: 'button', onclick: (ev) => removeWatch(w, ev.currentTarget) }, 'Remove')),
        st && st.lastError ? el('div', { class: 'err-text' }, st.lastError) : null);
      ul.append(li);
    }
  }

  function renderEvents() {
    const ul = $('events'); clear(ul);
    const evs = state.events.slice(0, 30);
    $('events-empty').hidden = evs.length > 0;
    for (const ev of evs) {
      const href = safeHref(ev.url);
      const name = ev.label || hostOf(ev.url);
      const docs = Array.isArray(ev.newDocuments) ? ev.newDocuments : [];
      ul.append(el('li', { class: 'event' },
        el('div', {}, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, name) : name, ' ', el('span', { class: 'when' }, ago(ev.at))),
        el('div', { class: 'what' }, ev.summary || 'Content changed'),
        docs.length ? el('ul', { class: 'docs' }, ...docs.map((d) => {
          const dh = safeHref(d.href);
          const ext = (d.ext || docExt(d.href) || 'file').toUpperCase();
          return el('li', {}, el('span', { class: 'badge' }, ext), dh ? el('a', { href: dh, target: '_blank', rel: 'noopener noreferrer' }, d.text || d.href) : (d.text || d.href));
        })) : null));
    }
  }

  // ---------- actions ----------
  async function checkNow(w, btn) {
    btn.disabled = true;
    try { await dispatch(w.id); setMsg($('refresh-msg'), 'Check started. Results appear in a few minutes.'); }
    catch (e) { setMsg($('refresh-msg'), e.message, true); }
    finally { btn.disabled = false; }
  }

  async function removeWatch(w, btn) {
    if (!confirm(`Stop watching ${w.label || w.url}?`)) return;
    btn.disabled = true;
    try {
      await updateWatchlist((d) => { d.watches = d.watches.filter((x) => x.id !== w.id); }, `Remove watch ${hostOf(w.url)}`);
      render();
    } catch (e) { setMsg($('refresh-msg'), e.message, true); }
    finally { btn.disabled = false; }
  }

  $('add-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('add-msg'); const btn = $('add-btn');
    let u;
    try { u = new URL($('add-url').value.trim()); } catch { return setMsg(msg, 'Enter a valid URL.', true); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return setMsg(msg, 'URL must start with http:// or https://', true);
    u.hash = '';
    const watch = {
      id: newId(), url: u.href, label: $('add-label').value.trim(), selector: $('add-selector').value.trim(),
      documentsOnly: $('add-docs').checked, createdAt: new Date().toISOString(),
    };
    btn.disabled = true; setMsg(msg, 'Saving…');
    try {
      await updateWatchlist((d) => { d.watches.push(watch); }, `Add watch ${u.hostname}`);
      let note = 'Added. First check (baseline) will run in a few minutes.';
      try { await dispatch(watch.id); } catch (e) { note = `Added, but could not start a check: ${e.message}`; }
      setMsg(msg, note);
      $('add-form').reset();
      render();
    } catch (e) { setMsg(msg, e.message, true); }
    finally { btn.disabled = false; }
  });

  $('settings-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('notify-email').value.trim();
    setMsg($('settings-msg'), 'Saving…');
    try {
      await updateWatchlist((d) => { d.notifyEmail = email; }, 'Update notification email');
      setMsg($('settings-msg'), 'Saved.');
    } catch (e) { setMsg($('settings-msg'), e.message, true); }
  });

  $('check-all').addEventListener('click', async () => {
    try { await dispatch(''); setMsg($('settings-msg'), 'Check started. Results appear in a few minutes.'); }
    catch (e) { setMsg($('settings-msg'), e.message, true); }
  });

  $('refresh').addEventListener('click', () => reload(false));

  $('disconnect').addEventListener('click', () => {
    try { localStorage.removeItem(CFG_KEY); } catch { /* ignore */ }
    cfg = null; clearInterval(timer); show(false); initSetup();
  });

  function initSetup() {
    $('s-repo').value = guessRepo();
    $('s-branch').value = ''; $('s-token').value = ''; setMsg($('s-msg'), '');
  }

  $('setup-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const repo = $('s-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return setMsg($('s-msg'), 'Repository must look like owner/name.', true);
    const btn = $('s-btn'); btn.disabled = true; setMsg($('s-msg'), 'Connecting…');
    const trial = { repo, branch: $('s-branch').value.trim(), token: $('s-token').value.trim() };
    cfg = trial;
    try {
      if (!trial.branch) trial.branch = (await gh('GET', `/repos/${repo}`)).default_branch;
      else await gh('GET', `/repos/${repo}/branches/${encodeURIComponent(trial.branch)}`);
      saveCfg(trial);
      show(true); start();
    } catch (e) {
      cfg = null;
      setMsg($('s-msg'), e.status === 401 ? 'Token rejected.' : e.status === 404 ? 'Repository or branch not found (check the token has access to it).' : e.message, true);
    } finally { btn.disabled = false; }
  });

  function start() {
    reload(false);
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) reload(true); }, 120000);
  }

  cfg = loadCfg();
  if (cfg && cfg.repo && cfg.token && cfg.branch) { show(true); start(); }
  else { cfg = null; show(false); initSetup(); }
})();
