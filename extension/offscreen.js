// Offscreen document: fetches a page and parses it with DOMParser (not available in the service worker).
import { isFeed, parseFeedDoc, feedToContent, FEED_ERROR, extractContent, pageProblem, sha256Hex, hostKey, isBlockedHost, fail, kindForMessage, parseRetryAfter, TIMEOUT_SECS, NETWORK_ERROR } from './lib.js';

const TIMEOUT_MS = TIMEOUT_SECS * 1000;
const TIMED_OUT = `Timed out after ${TIMEOUT_SECS}s`;
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,*/*;q=0.8';
const FEED_ACCEPT = 'application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.8';
const MAX_CHARS = 5 * 1024 * 1024;

// Feeds often use HTML named entities (&nbsp; etc.), which strict XML parsing rejects.
const HTML_ENTITIES = { nbsp: 160, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, hellip: 8230, copy: 169, reg: 174, trade: 8482, euro: 8364, pound: 163, middot: 183, bull: 8226 };
function xmlSafeEntities(xml) {
  return xml.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
    if (/^(amp|lt|gt|quot|apos)$/.test(name)) return m;
    const code = HTML_ENTITIES[name.toLowerCase()];
    return code ? `&#${code};` : ' ';
  });
}

async function scan({ url, selector, feed }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { Accept: feed ? FEED_ACCEPT : PAGE_ACCEPT, 'Accept-Language': 'en-US,en;q=0.9' },
      });
    } catch (e) {
      if (ctrl.signal.aborted) return fail('timeout', TIMED_OUT);
      // Chrome only says "Failed to fetch"; classify by text in case a message is more specific.
      const k = kindForMessage(e && e.message);
      return k === 'other' || /failed to fetch/i.test(String(e && e.message)) ? fail('connection', NETWORK_ERROR) : fail(k, `Request failed: ${e.message}`);
    }
    const finalUrl = res.url || url;
    if (isBlockedHost(hostKey(finalUrl))) {
      return fail('other', 'Redirected to a disallowed address');
    }
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type && !/html|xml|text\/plain/.test(type)) return fail('other', `Not a web page (${type.split(';')[0]})`);
    let html;
    try { html = await res.text(); } catch {
      return ctrl.signal.aborted ? fail('timeout', TIMED_OUT) : fail('connection', 'Read failed (connection closed while reading the page)');
    }
    if (html.length > MAX_CHARS) return fail('other', 'Page too large');

    if (isFeed(type, html)) {
      const early = pageProblem({ status: res.status, title: '', textLength: 1, hasSelector: true });
      if (early) return { ...early, retryAfter: parseRetryAfter(res.headers.get('retry-after')) };
      try {
        const items = parseFeedDoc(new DOMParser().parseFromString(xmlSafeEntities(html), 'application/xml'), finalUrl);
        const c = feedToContent(items);
        return { ok: true, content: { lines: c.lines, links: c.links, hash: await sha256Hex(c.hashSrc) } };
      } catch { return fail('other', FEED_ERROR); }
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.title || '';
    const early = pageProblem({ status: res.status, title, textLength: 1, hasSelector: true });
    if (early) return { ...early, retryAfter: parseRetryAfter(res.headers.get('retry-after')) };

    let content;
    try { content = extractContent(doc, selector, finalUrl); } catch (e) { return fail('other', e.message); }
    const problem = pageProblem({ status: res.status, title, textLength: content.text.length, hasSelector: !!(selector || '').trim() });
    if (problem) return problem;
    return { ok: true, content: { lines: content.lines, links: content.links, hash: await sha256Hex(content.text) } };
  } catch (e) {
    return ctrl.signal.aborted ? fail('timeout', TIMED_OUT) : fail('other', `Check failed: ${e && e.message ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'scan') return false;
  scan(msg).then(sendResponse, (e) => sendResponse(fail('other', String(e && e.message || e))));
  return true;
});
