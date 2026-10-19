'use strict';
const dns = require('dns').promises;
const { extractContent, computeDiff, summarizeDiff, validateUrl, isBlockedHost } = require('./lib');

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

const MAX_STORED_LINES = 1000;

/**
 * Check one watch. `prev` is the stored state entry for it (or undefined).
 * Returns { entry, event, diff } where entry is the new state entry and event
 * is a change event to record (or null). Never throws.
 */
async function checkWatch(watch, prev, { now = new Date().toISOString(), fetcher = fetchPage } = {}) {
  prev = prev || {};
  try {
    const { html, finalUrl } = await fetcher(watch.url);
    const content = extractContent(html, { selector: watch.selector, baseUrl: finalUrl });
    if (!content.text) throw new Error('No text found on page');
    const curr = { lines: content.lines.slice(0, MAX_STORED_LINES), links: content.links.slice(0, MAX_LINKS) };
    const entry = {
      ...prev,
      lastChecked: now, lastStatus: 'ok', lastError: null,
      lastHash: content.hash, links: curr.links, lines: curr.lines,
    };
    if (!prev.lastHash) { // baseline, no alert
      entry.lastSnippet = content.text.slice(0, 200);
      return { entry, event: null, diff: null };
    }
    if (prev.lastHash === content.hash) return { entry, event: null, diff: null };

    const diff = computeDiff({ lines: prev.lines || [], links: prev.links || [] }, curr);
    if (watch.documentsOnly && !diff.newDocuments.length) return { entry, event: null, diff }; // stored, but no alert
    entry.lastChanged = now;
    entry.lastSnippet = (diff.addedText[0] || content.text).slice(0, 200);
    const event = {
      watchId: watch.id, url: watch.url, label: watch.label || '', at: now,
      summary: summarizeDiff(diff),
      newDocuments: diff.newDocuments.map((d) => ({ href: d.href, text: d.text, ext: d.ext })),
    };
    return { entry, event, diff };
  } catch (e) {
    return { entry: { ...prev, lastChecked: now, lastStatus: 'error', lastError: e.message || String(e) }, event: null, diff: null };
  }
}

module.exports = { checkWatch, fetchPage, MAX_STORED_LINES };
