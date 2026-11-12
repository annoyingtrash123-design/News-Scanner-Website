// Pure logic shared by the service worker, the offscreen document and the node tests.
// Ported from app/src/core.rs and app/src/checker.rs. Uses only web-standard APIs.

import { scoreEvent } from './keywords.js';

export const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'rtf', 'zip'];
export const MIN_MEANINGFUL_CHARS = 20;
export const MAX_STORED_LINES = 1000;
export const MAX_LINKS = 1500;
export const MAX_EVENTS = 300;
export const MAX_CONCURRENT = 4;

export const TIMEOUT_SECS = 35;
export const RETRY_DELAY_MS = 3000;
export const MAX_RETRY_AFTER_SECS = 60;

/** Raw messages (stored as lastError). The friendly text shown to the user comes from friendlyError(). */
export const BOT_ERROR = "Blocked by the site's bot protection or paywall. Opening the site once in Chrome sometimes helps.";
export const JS_ERROR = "Page loaded but had no readable text — it probably needs JavaScript, which the scanner doesn't run.";
export const NETWORK_ERROR = 'Network error (Chrome does not say whether it was DNS, TLS or the site refusing)';

export function normalize(s) {
  return String(s).split(/\s+/).filter(Boolean).join(' ');
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const IGNORED = ['script', 'style', 'noscript', 'svg', 'iframe', 'template'];
const BLOCKS = new Set(['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'dd', 'dt',
  'blockquote', 'ul', 'ol', 'table', 'header', 'footer', 'nav', 'main', 'aside', 'br']);

function walk(el) {
  let out = '';
  for (const c of el.childNodes) {
    if (c.nodeType === 3) out += c.data;
    else if (c.nodeType === 1) {
      const name = c.localName;
      if (IGNORED.includes(name)) continue;
      out += walk(c);
      if (BLOCKS.has(name)) out += '\n';
      else if (name === 'td' || name === 'th') out += ' ';
    }
  }
  return out;
}

/**
 * Extract visible text lines + absolute links from a parsed Document, optionally scoped to a CSS selector.
 * Throws Error with a user-readable message for a bad / unmatched selector. The document is modified.
 */
export function extractContent(doc, selector, base) {
  for (const n of doc.querySelectorAll(IGNORED.join(','))) n.remove();
  const sel = (selector || '').trim();
  let scopes;
  if (sel) {
    let found;
    try { found = [...doc.querySelectorAll(sel)]; } catch { throw new Error(`Invalid CSS selector: ${sel}`); }
    if (!found.length) throw new Error(`Selector matched nothing: ${sel}`);
    scopes = found;
  } else {
    scopes = [doc.body || doc.documentElement];
  }
  let raw = '';
  for (const s of scopes) raw += walk(s) + '\n';
  const lines = raw.split('\n').map(normalize).filter(Boolean);
  const text = normalize(lines.join(' '));

  const seen = new Set();
  const links = [];
  for (const s of scopes) {
    const anchors = [...(s.localName === 'a' && s.hasAttribute('href') ? [s] : []), ...s.querySelectorAll('a[href]')];
    for (const a of anchors) {
      const href = (a.getAttribute('href') || '').trim();
      const lower = href.toLowerCase();
      if (!href || lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:') || href.startsWith('#')) continue;
      let abs;
      try { abs = new URL(href, base).href; } catch { continue; }
      if (seen.has(abs)) continue;
      seen.add(abs);
      links.push({ href: abs, text: Array.from(normalize(walk(a))).slice(0, 200).join('') });
    }
  }
  return { text, lines, links };
}

/** Sentence-ish units: split after . ! ? when followed by an uppercase letter, digit or quote. */
export function splitUnits(lines) {
  const out = [];
  for (const line of lines) {
    const chars = Array.from(line);
    let start = 0;
    for (let i = 1; i < chars.length; i++) {
      if (/\s/.test(chars[i]) && '.!?'.includes(chars[i - 1])) {
        let ni = i;
        while (ni < chars.length && /\s/.test(chars[ni])) ni++;
        if (ni < chars.length && /[A-Z0-9"'(]/.test(chars[ni])) {
          const part = normalize(chars.slice(start, i).join(''));
          if (Array.from(part).length >= 3) out.push(part);
          start = ni;
        }
      }
    }
    const part = normalize(chars.slice(start).join(''));
    if (Array.from(part).length >= 3) out.push(part);
  }
  return out;
}

/** Lowercase extension (no dot) if the URL path ends in a document type, else null. */
export function documentExt(href) {
  let path;
  try { path = new URL(href).pathname; } catch { path = String(href).split(/[?#]/)[0]; }
  const seg = path.split('/').pop().toLowerCase();
  const i = seg.lastIndexOf('.');
  if (i < 0) return null;
  const ext = seg.slice(i + 1);
  return DOC_EXTS.includes(ext) ? ext : null;
}

const NOISE_WORDS = new Set(('jan january feb february mar march apr april may jun june jul july aug august sep sept september ' +
  'oct october nov november dec december mon monday tue tues tuesday wed wednesday thu thur thurs thursday fri friday sat ' +
  'saturday sun sunday ago second seconds sec secs minute minutes min mins hour hours hr hrs day days week weeks month months ' +
  'year years yesterday today now just an a at on of the updated posted published last modified released date am pm aest aedt').split(' '));
const DIGIT_REST_OK = new Set(['', 'st', 'nd', 'rd', 'th', 'am', 'pm', 'h', 'm', 's', 'hrs', 'min', 'mins']);

/** True if the text is only dates / times / "x minutes ago"-style words. */
export function isDatetimeLike(s) {
  let any = false;
  for (const tok of s.split(/[\s,;|]+/)) {
    const w = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    if (!w) continue;
    any = true;
    if (/[0-9]/.test(w)) {
      if (!DIGIT_REST_OK.has(w.replace(/[0-9:/.\-]/g, ''))) return false;
    } else if (!NOISE_WORDS.has(w)) return false;
  }
  return any;
}

/** Added text that should not, on its own, count as a change worth reporting. */
export function isNoiseText(s) {
  const t = s.trim();
  return Array.from(t).length < MIN_MEANINGFUL_CHARS || isDatetimeLike(t);
}

export function computeDiff(prevLines, prevLinks, currLines, currLinks, cap = 20) {
  const known = new Set(prevLinks.map((l) => l.href));
  const fresh = currLinks.filter((l) => !known.has(l.href));
  const newDocuments = [];
  for (const l of fresh) {
    const ext = documentExt(l.href);
    if (ext) newDocuments.push({ href: l.href, text: l.text, ext });
    if (newDocuments.length >= 50) break;
  }
  const newLinks = fresh.filter((l) => !documentExt(l.href)).slice(0, cap).map((l) => ({ href: l.href, text: l.text }));
  const prevUnits = new Set(splitUnits(prevLines));
  const seen = new Set();
  const addedText = [];
  for (const u of splitUnits(currLines)) {
    if (prevUnits.has(u) || isNoiseText(u) || seen.has(u)) continue;
    seen.add(u);
    const chars = Array.from(u);
    addedText.push(chars.length > 300 ? chars.slice(0, 297).join('') + '...' : u);
    if (addedText.length >= cap) break;
  }
  return { newDocuments, newLinks, addedText };
}

export function summarizeDiff(d) {
  const bits = [];
  const pl = (n) => (n > 1 ? 's' : '');
  if (d.newDocuments.length) bits.push(`${d.newDocuments.length} new document${pl(d.newDocuments.length)}`);
  if (d.newLinks.length) bits.push(`${d.newLinks.length} new link${pl(d.newLinks.length)}`);
  if (d.addedText.length) bits.push(`${d.addedText.length} added text item${pl(d.addedText.length)}`);
  return bits.length ? bits.join(', ') : 'Content changed';
}

// ---------- URL validation ----------

function blockedV4(o) {
  return o[0] === 0 || o[0] === 10 || o[0] === 127 || o[0] >= 224 || (o[0] === 169 && o[1] === 254) ||
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || (o[0] === 100 && o[1] >= 64 && o[1] <= 127);
}

function parseV6(h) {
  // Expand an IPv6 literal (as normalized by URL) into 8 16-bit groups, or null.
  const [head, tail] = h.split('::');
  const toGroups = (s) => (s ? s.split(':') : []);
  const a = toGroups(head);
  const b = tail === undefined ? [] : toGroups(tail);
  if (tail === undefined && a.length !== 8) return null;
  const fill = 8 - a.length - b.length;
  if (fill < 0) return null;
  const groups = [...a, ...Array(tail === undefined ? 0 : fill).fill('0'), ...b].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

export function isBlockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h.startsWith('[') && h.endsWith(']')) {
    const g = parseV6(h.slice(1, -1));
    if (!g) return true;
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return blockedV4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
    return g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) || (g[0] & 0xff00) === 0xff00 ||
      (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80;
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) return blockedV4(m.slice(1).map(Number));
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal');
}

/** Validate and normalize a watch URL. Returns the normalized string or throws Error. */
export function validateUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('URL must start with http:// or https://');
  if (isBlockedHost(u.hostname)) throw new Error('That address is not allowed');
  u.hash = '';
  return u.href;
}

export function hostKey(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}


// ---------- feeds (RSS 2.0, Atom, RSS 1.0 / RDF) ----------
// Mirrors app/src/feed.rs. Parsing works on a DOM-like Document (DOMParser "application/xml" in the offscreen document).

export const FEED_ERROR = 'Feed could not be read';
export const MAX_FEED_ITEMS = 200;
export const MAX_DESC_CHARS = 300;

/** Local name of the first element, skipping the XML declaration, comments, doctype and a BOM. */
export function sniffRoot(body) {
  let s = String(body).replace(/^﻿/, '').trimStart();
  for (;;) {
    if (!s.startsWith('<')) return null;
    if (s.startsWith('<?')) { const i = s.indexOf('?>'); if (i < 0) return null; s = s.slice(i + 2).trimStart(); }
    else if (s.startsWith('<!--')) { const i = s.indexOf('-->'); if (i < 0) return null; s = s.slice(i + 3).trimStart(); }
    else if (s.startsWith('<!')) {
      const b = s.indexOf('['), g = s.indexOf('>');
      let end;
      if (b >= 0 && (g < 0 || b < g)) { const e = s.indexOf(']>', b); if (e < 0) return null; end = e + 2; }
      else if (g >= 0) end = g + 1;
      else return null;
      s = s.slice(end).trimStart();
    } else {
      const m = /^<([^\s>/]+)/.exec(s);
      return m ? m[1].split(':').pop() : null;
    }
  }
}

const isFeedRoot = (n) => ['rss', 'feed', 'rdf'].includes(String(n).toLowerCase());

/** True if the response is a feed: by content type (rss / atom / generic xml, not xhtml) or by root element. */
export function isFeed(contentType, body) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('rss') || ct.includes('atom')) return true;
  const root = sniffRoot(body);
  if (root && isFeedRoot(root)) return true;
  return ct.includes('xml') && !ct.includes('xhtml') && !(root && root.toLowerCase() === 'html');
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, n) => {
    if (n[0] === '#') {
      const code = n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.hasOwn(NAMED_ENTITIES, n) ? NAMED_ENTITIES[n] : m;
  });
}

const BLOCK_TAGS = new Set(['p', 'br', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'table', 'blockquote']);

/** Remove HTML tags (block-level tags become spaces), decode common entities, collapse whitespace. */
export function stripHtml(s) {
  let out = '';
  let rest = String(s);
  for (;;) {
    const i = rest.indexOf('<');
    if (i < 0) break;
    out += rest.slice(0, i);
    const tail = rest.slice(i);
    const end = tail.indexOf('>');
    if (/^<[A-Za-z/!]/.test(tail) && end >= 0) {
      const name = (/^[A-Za-z0-9]*/.exec(tail.slice(1).replace(/^\/+/, '')) || [''])[0].toLowerCase();
      if (BLOCK_TAGS.has(name)) out += ' ';
      rest = tail.slice(end + 1);
    } else {
      out += '<';
      rest = tail.slice(1);
    }
  }
  return normalize(decodeEntities(out + rest));
}

function truncate(s, max) {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 3).join('').trimEnd() + '...';
}

const kids = (el, name) => [...el.childNodes].filter((c) => c.nodeType === 1 && c.localName === name);

function collectItems(el, out) {
  for (const c of el.childNodes) {
    if (c.nodeType !== 1) continue;
    if (c.localName === 'item' || c.localName === 'entry') out.push(c);
    else collectItems(c, out);
  }
}

function firstText(item, names) {
  for (const n of names) {
    for (const c of kids(item, n)) {
      const t = (c.textContent || '').trim();
      if (t) return t;
    }
  }
  return '';
}

function resolveUrl(base, href) {
  href = String(href || '').trim();
  if (!href) return null;
  try {
    const u = new URL(href, base || undefined);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

function itemLink(item, base) {
  let fallback = null;
  for (const l of kids(item, 'link')) {
    const h = l.getAttribute('href');
    if (h !== null && h !== undefined) {
      const rel = l.getAttribute('rel') || 'alternate';
      if (rel === 'alternate') { const u = resolveUrl(base, h); if (u) return u; }
      else if (!['self', 'edit', 'replies', 'enclosure', 'related'].includes(rel) && !fallback) fallback = resolveUrl(base, h);
    } else if (l.nodeName === 'link') {
      const u = resolveUrl(base, l.textContent); // RSS: <link>text</link>
      if (u) return u;
    }
  }
  if (fallback) return fallback;
  for (const g of kids(item, 'guid')) {
    if (g.getAttribute('isPermaLink') !== 'false') { const u = resolveUrl(base, g.textContent); if (u) return u; }
  }
  return resolveUrl(base, item.getAttribute('rdf:about')); // RSS 1.0
}

function hasParserError(node) {
  if (node.nodeType === 1 && node.localName === 'parsererror') return true;
  return [...node.childNodes].some((c) => c.nodeType === 1 && hasParserError(c));
}

/**
 * Parse an RSS 2.0, Atom or RSS 1.0 Document into [{ id, title, link, published, summary }].
 * Throws Error(FEED_ERROR) for anything unreadable. Relative links are resolved against `base`.
 */
export function parseFeedDoc(doc, base) {
  const root = doc && doc.documentElement;
  if (!root || hasParserError(root) || !isFeedRoot(root.localName)) throw new Error(FEED_ERROR);
  const found = [];
  collectItems(root, found);
  const items = [];
  const seen = new Set();
  for (const it of found) {
    const title = stripHtml(firstText(it, ['title']));
    const link = itemLink(it, base) || '';
    const id = firstText(it, ['guid', 'id']);
    const summary = truncate(stripHtml(firstText(it, ['description', 'summary', 'encoded', 'content'])), MAX_DESC_CHARS);
    if (!title && !link) continue;
    const key = id || link || title;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ id, title, link, published: firstText(it, ['pubDate', 'updated', 'published', 'date']), summary });
    if (items.length >= MAX_FEED_ITEMS) break;
  }
  if (!items.length) throw new Error(FEED_ERROR);
  return items;
}

/**
 * Map feed items into the page content model { text, lines, links, hash source }. The hash covers only the item list
 * (ids/links + titles), so feed metadata such as <lastBuildDate> never counts as a change.
 */
export function feedToContent(items) {
  const lines = [];
  const links = [];
  const seen = new Set();
  let hashSrc = '';
  for (const it of items) {
    if (it.title) lines.push(it.title);
    if (it.summary) lines.push(it.summary);
    if (it.link && !seen.has(it.link)) { seen.add(it.link); links.push({ href: it.link, text: Array.from(it.title).slice(0, 200).join('') }); }
    hashSrc += `${it.id || it.link}\t${it.title}\n`;
  }
  return { text: normalize(lines.join(' ')), lines, links, hashSrc };
}

// ---------- check outcome ----------

const CHALLENGE_TITLE = /just a moment|attention required/i;

/** Error kinds: blocked, server, tls, timeout, dns, connection, no_text, not_found, other. */
export function kindForStatus(status) {
  if ([401, 403, 412, 429].includes(status)) return 'blocked';
  if (status === 404 || status === 410) return 'not_found';
  if (status >= 500 && status <= 599) return 'server';
  return 'other';
}

/** Classify a low-level error message (any case). */
export function kindForMessage(msg) {
  const m = String(msg || '').toLowerCase();
  const has = (...ns) => ns.some((n) => m.includes(n));
  if (has('unknownissuer', 'certificate', 'handshake', 'close_notify', 'tls', 'ssl', 'err_cert', 'invalid peer')) return 'tls';
  if (has('timed out', 'timeout', 'os error 10060', 'err_timed_out')) return 'timeout';
  if (has('dns', 'name resolution', 'no such host', 'os error 11001', 'os error 11002', 'err_name_not_resolved')) return 'dns';
  if (has('connection reset', 'connection refused', 'connection closed', 'connection aborted', 'unexpected eof', 'os error 10054', 'os error 10053', 'os error 10061', 'network error', 'err_connection', 'failed to fetch')) return 'connection';
  return 'other';
}

/** Build a failed scan result: { ok:false, error (raw), errorKind, status?, retryAfter?, attempts }. */
export function fail(errorKind, error, extra = {}) {
  return { ok: false, error, errorKind, attempts: 1, ...extra };
}

export function parseRetryAfter(v) {
  const n = /^\s*\d+\s*$/.test(String(v ?? '')) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether to retry a failed scan once, and after how many ms (null = do not retry).
 * Retried: timeouts, connection reset/closed, temporary DNS failure, TLS unexpected EOF, HTTP 502/503/504/520/522/524,
 * and HTTP 429 only when Retry-After <= 60s. Never 401/403/412, never a bot-challenge page.
 */
export function retryDelayMs(r) {
  if (!r || r.ok || (r.attempts || 1) >= 2) return null;
  const m = String(r.error || '').toLowerCase();
  switch (r.errorKind) {
    case 'blocked':
      return r.status === 429 && r.retryAfter != null && r.retryAfter <= MAX_RETRY_AFTER_SECS ? r.retryAfter * 1000 : null;
    case 'server': return [502, 503, 504, 520, 522, 524].includes(r.status) ? RETRY_DELAY_MS : null;
    case 'timeout': return RETRY_DELAY_MS;
    case 'dns': return /temporary|try again|os error 11002|eai_again/.test(m) ? RETRY_DELAY_MS : null;
    case 'tls': return /close_notify|unexpected eof|unexpected end of file/.test(m) ? RETRY_DELAY_MS : null;
    case 'connection': return /refused|os error 10061/.test(m) ? null : RETRY_DELAY_MS;
    default: return null;
  }
}

/** Plain-English message for a failed scan result. */
export function friendlyError(r) {
  const tried = (r.attempts || 1) >= 2 ? ' (tried twice)' : '';
  const http = r.status ? ` (HTTP ${r.status})` : '';
  switch (r.errorKind) {
    case 'blocked': return BOT_ERROR;
    case 'server': return `The site's own server returned an error${http} — usually temporary or the site is down${tried}.`;
    case 'tls': return `Secure connection failed (certificate/handshake)${tried}.`;
    case 'timeout': return `Timed out after ${TIMEOUT_SECS}s${tried}.`;
    case 'dns': return `Couldn't look up the site's address (DNS) — check your internet connection${tried}.`;
    case 'connection':
      return r.error === NETWORK_ERROR
        ? `Couldn't connect to the site — it may be down, you may be offline, or its certificate may be bad${tried}.`
        : `Connection was cut off by the site${tried}.`;
    case 'no_text': return JS_ERROR;
    case 'not_found': return `Page not found${http} — the address may have changed or been removed.`;
    default: return r.error || 'Check failed';
  }
}

/** Returns a failed scan result ({ok:false,...}) if the fetched page is not scannable, else null. */
export function pageProblem({ status, title, textLength, hasSelector }) {
  if (CHALLENGE_TITLE.test(title || '')) return fail('blocked', 'Bot-challenge page (e.g. "Just a moment...")', { status: status >= 200 && status < 300 ? undefined : status });
  if (status < 200 || status >= 300) return fail(kindForStatus(status), `HTTP ${status}`, { status });
  if (textLength === 0) return fail('no_text', 'No text found on page');
  if (!hasSelector && textLength < 50) return fail('no_text', 'Too little text on page (likely JavaScript-only)');
  return null;
}

/** The address that is actually fetched: the feed if one is set, else the page. */
export function sourceUrlOf(watch) {
  const f = typeof watch.feedUrl === 'string' ? watch.feedUrl.trim() : '';
  return f || watch.url;
}

/**
 * Compare fresh content against the previous state. prev = { meta, snap }, content = { lines, links, hash }.
 * Returns { meta, snap, event, diff } and never mutates its inputs. First check is a baseline (no event).
 */
export function processScan(watch, prev, content, now) {
  const source = sourceUrlOf(watch);
  const lines = content.lines.slice(0, MAX_STORED_LINES);
  const links = content.links.slice(0, MAX_LINKS);
  const prevMeta = prev.meta || {};
  const prevSnap = prev.snap || { lines: [], links: [] };
  const meta = { ...prevMeta, lastChecked: now, lastStatus: 'ok', lastError: null, errorKind: null, errorMessage: null, lastHash: content.hash, sourceUrl: source };
  const snap = { lines, links };
  // State saved before sourceUrl existed always came from the page URL.
  const prevSource = prevMeta.sourceUrl ?? (prevMeta.lastHash ? watch.url : null);
  if (prevSource !== null && prevSource !== source) return { meta, snap, event: null, diff: null }; // fetched source changed: new baseline
  if (!prevMeta.lastHash || prevMeta.lastHash === content.hash) return { meta, snap, event: null, diff: null };
  const diff = computeDiff(prevSnap.lines, prevSnap.links, lines, links, 20);
  if (watch.documentsOnly && !diff.newDocuments.length) return { meta, snap, event: null, diff };
  if (!diff.newDocuments.length && !diff.newLinks.length && !diff.addedText.length) return { meta, snap, event: null, diff };
  meta.lastChanged = now;
  const event = {
    watchId: watch.id, url: watch.url, label: watch.label, at: now, summary: summarizeDiff(diff),
    newDocuments: diff.newDocuments, newLinks: diff.newLinks, addedText: diff.addedText,
  };
  Object.assign(event, scoreEvent(event));
  return { meta, snap, event, diff };
}

/** `failure` is a failed scan result (see fail()) or a plain message string. */
export function errorMeta(prevMeta, now, failure) {
  const r = typeof failure === 'string' ? fail('other', failure) : failure;
  return { ...(prevMeta || {}), lastChecked: now, lastStatus: 'error', lastError: r.error, errorKind: r.errorKind || 'other', errorMessage: friendlyError(r) };
}

// ---------- seeding ----------

/**
 * Add every default whose id has not been seeded before. data = { watches, seededDefaults } (mutated).
 * Ids are recorded even when skipped for a duplicate URL, so removed defaults never come back.
 */
export function seedFrom(list, data, now, feeds = {}) {
  const added = [];
  for (const d of list) {
    const w0 = data.watches.find((w) => w.id === d.id && !w.category);
    if (w0) w0.category = d.category;
    if (data.seededDefaults.includes(d.id)) continue;
    data.seededDefaults.push(d.id);
    let url;
    try { url = validateUrl(d.url); } catch { continue; }
    if (data.watches.some((w) => w.id === d.id || w.url === url)) continue;
    const w = { id: d.id, url, label: d.label, selector: '', documentsOnly: false, category: d.category, createdAt: now };
    const feed = safeUrl(feeds[d.id]);
    if (feed) w.feedUrl = feed;
    data.watches.push(w);
    added.push(d.id);
  }
  return added;
}

function safeUrl(u) {
  if (!u) return null;
  try { return validateUrl(u); } catch { return null; }
}

/**
 * Startup migration for existing watches: set a built-in feed where none is set (a user-set feed is kept),
 * and apply url fixes where the stored url still equals the default's old url. data = { watches } (mutated).
 * Returns the number of watches changed.
 */
export function migrateDefaults(list, data, feeds, fixes) {
  let changed = 0;
  for (const w of data.watches) {
    let touched = false;
    if (!(typeof w.feedUrl === 'string' && w.feedUrl.trim())) {
      const feed = safeUrl(feeds[w.id]);
      if (feed) { w.feedUrl = feed; touched = true; }
    }
    if (Object.hasOwn(fixes, w.id)) {
      const def = list.find((d) => d.id === w.id);
      const oldUrl = def && safeUrl(def.url);
      const newUrl = safeUrl(fixes[w.id]);
      if (oldUrl && newUrl && w.url === oldUrl && !data.watches.some((x) => x.url === newUrl)) { w.url = newUrl; touched = true; }
    }
    if (touched) changed++;
  }
  return changed;
}

// ---------- notifications ----------

export function buildNotification(events) {
  if (!events.length) return null;
  const name = (e) => e.label || hostKey(e.url);
  const names = [...new Set(events.map(name))];
  const docSites = [...new Set(events.filter((e) => e.newDocuments.length).map(name))];
  const list = (a) => (a.length > 3 ? `${a.slice(0, 3).join(', ')}, …` : a.join(', '));
  if (docSites.length === 1) return { title: 'News Scanner', message: `New document: ${docSites[0]}` };
  if (docSites.length > 1) return { title: 'News Scanner', message: `New documents on ${docSites.length} sites — ${list(docSites)}` };
  return { title: 'News Scanner', message: `${names.length} site${names.length > 1 ? 's' : ''} updated — ${list(names)}` };
}

// ---------- bounded concurrency ----------

/** Run fn over items with at most `limit` at once and at most one at a time per key(item). */
export function forEachBounded(items, limit, key, fn) {
  const pending = [...items];
  const busy = new Set();
  let running = 0;
  return new Promise((resolve) => {
    const pump = () => {
      while (running < Math.max(1, limit)) {
        const i = pending.findIndex((it) => !busy.has(key(it)));
        if (i < 0) break;
        const [it] = pending.splice(i, 1);
        const k = key(it);
        busy.add(k);
        running++;
        Promise.resolve().then(() => fn(it)).catch(() => {}).finally(() => { busy.delete(k); running--; pump(); });
      }
      if (!pending.length && running === 0) resolve();
    };
    pump();
  });
}
