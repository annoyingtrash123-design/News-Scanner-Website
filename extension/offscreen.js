// Offscreen document: fetches a page and parses it with DOMParser (not available in the service worker).
import { extractContent, pageProblem, sha256Hex, hostKey, isBlockedHost, fail, kindForMessage, parseRetryAfter, TIMEOUT_SECS, NETWORK_ERROR } from './lib.js';

const TIMEOUT_MS = TIMEOUT_SECS * 1000;
const TIMED_OUT = `Timed out after ${TIMEOUT_SECS}s`;
const MAX_CHARS = 5 * 1024 * 1024;

async function scan({ url, selector }) {
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
        headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
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
