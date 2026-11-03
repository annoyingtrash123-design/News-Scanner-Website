// Offscreen document: fetches a page and parses it with DOMParser (not available in the service worker).
import { extractContent, pageProblem, sha256Hex, hostKey, isBlockedHost } from './lib.js';

const TIMEOUT_MS = 20000;
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
      if (ctrl.signal.aborted) return { ok: false, error: 'Timed out after 20s' };
      return { ok: false, error: "Couldn't connect (offline, DNS failure or blocked)" };
    }
    const finalUrl = res.url || url;
    if (isBlockedHost(hostKey(finalUrl))) {
      return { ok: false, error: 'Redirected to a disallowed address' };
    }
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type && !/html|xml|text\/plain/.test(type)) return { ok: false, error: `Not a web page (${type.split(';')[0]})` };
    let html;
    try { html = await res.text(); } catch {
      return { ok: false, error: ctrl.signal.aborted ? 'Timed out after 20s' : 'Read failed' };
    }
    if (html.length > MAX_CHARS) return { ok: false, error: 'Page too large' };

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.title || '';
    const early = pageProblem({ status: res.status, title, textLength: 1, hasSelector: true });
    if (early) return { ok: false, error: early };

    let content;
    try { content = extractContent(doc, selector, finalUrl); } catch (e) { return { ok: false, error: e.message }; }
    const problem = pageProblem({ status: res.status, title, textLength: content.text.length, hasSelector: !!(selector || '').trim() });
    if (problem) return { ok: false, error: problem };
    return { ok: true, content: { lines: content.lines, links: content.links, hash: await sha256Hex(content.text) } };
  } catch (e) {
    return { ok: false, error: ctrl.signal.aborted ? 'Timed out after 20s' : `Check failed: ${e && e.message ? e.message : e}` };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'scan') return false;
  scan(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});
