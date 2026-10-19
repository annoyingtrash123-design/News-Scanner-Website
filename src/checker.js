'use strict';
const dns = require('dns').promises;
const crypto = require('crypto');
const db = require('./db');
const { extractContent, computeDiff, summarizeDiff, validateUrl, isBlockedHost } = require('./lib');
const { sendMail, buildChangeEmail } = require('./mailer');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LINES = 3000;
const MAX_LINKS = 1500;

async function assertPublic(urlStr) {
  const v = validateUrl(urlStr);
  if (!v.ok) throw new Error(v.error);
  const host = new URL(v.url).hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return; // literal IP already validated
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.some((a) => isBlockedHost(a.address))) throw new Error('Host resolves to a disallowed address');
}

/** fetch with timeout and manually-followed redirects (each hop is SSRF-checked). */
async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      await assertPublic(current);
      const res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).href;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('Page too large');
      return { html: buf.toString('utf8'), finalUrl: current };
    }
    throw new Error('Too many redirects');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timed out after 20s');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function getNotifyEmail() {
  return db.get().settings.notifyEmail || process.env.NOTIFY_EMAIL || '';
}

const inFlight = new Set();

async function checkWatch(watch) {
  if (inFlight.has(watch.id)) return watch;
  inFlight.add(watch.id);
  const now = new Date().toISOString();
  try {
    const { html, finalUrl } = await fetchPage(watch.url);
    const content = extractContent(html, { selector: watch.selector, baseUrl: finalUrl });
    if (!content.text) throw new Error('No text found on page');
    const snapshot = { lines: content.lines.slice(0, MAX_LINES), links: content.links.slice(0, MAX_LINKS) };
    watch.lastChecked = now;
    watch.lastStatus = 'ok';
    watch.lastError = null;

    if (!watch.lastHash) {
      watch.lastHash = content.hash; // baseline, no email
      watch.snapshot = snapshot;
      watch.lastSnippet = content.text.slice(0, 200);
    } else if (watch.lastHash !== content.hash) {
      const diff = computeDiff(watch.snapshot || {}, snapshot);
      const summary = summarizeDiff(diff);
      watch.lastHash = content.hash;
      watch.snapshot = snapshot;
      watch.lastChanged = now;
      watch.lastSnippet = (diff.addedText[0] || content.text).slice(0, 200);
      const state = db.get();
      state.events.unshift({ watchId: watch.id, url: watch.url, label: watch.label || '', at: now, summary });
      state.events.length = Math.min(state.events.length, 100);
      try {
        await sendMail({ to: getNotifyEmail(), ...buildChangeEmail({ watch, diff, at: now }) });
      } catch (e) {
        console.error(`Email failed for ${watch.url}:`, e.message);
        state.events[0].summary += ' (email failed)';
      }
    }
  } catch (e) {
    watch.lastChecked = now;
    watch.lastStatus = 'error';
    watch.lastError = e.message || String(e);
  } finally {
    inFlight.delete(watch.id);
    await db.save();
  }
  return watch;
}

let running = false;
async function checkAll() {
  if (running) return;
  running = true;
  try {
    for (const w of [...db.get().watches]) {
      if (!db.get().watches.includes(w)) continue;
      await checkWatch(w);
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally { running = false; }
}

function startScheduler() {
  const mins = Math.max(1, Number(process.env.CHECK_INTERVAL_MINUTES) || 30);
  console.log(`Checking watches every ${mins} minute(s)`);
  const t = setInterval(() => { checkAll().catch((e) => console.error(e)); }, mins * 60 * 1000);
  t.unref?.();
  return t;
}

const newId = () => crypto.randomBytes(6).toString('hex');

module.exports = { checkWatch, checkAll, startScheduler, getNotifyEmail, newId };
