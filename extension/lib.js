// Pure logic shared by the service worker, the offscreen document and the node tests.
// Ported from app/src/core.rs and app/src/checker.rs. Uses only web-standard APIs.

import { scoreEvent } from './keywords.js';

export const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'rtf', 'zip'];
export const MIN_MEANINGFUL_CHARS = 20;
export const MAX_STORED_LINES = 1000;
export const MAX_LINKS = 1500;
export const MAX_EVENTS = 300;
export const MAX_CONCURRENT = 4;

export const BOT_ERROR = 'Site blocks automated checks — open it once in Chrome, then Check all again';
export const JS_ERROR = "Page loads its content with JavaScript; can't be scanned";

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

// ---------- check outcome ----------

const CHALLENGE_TITLE = /just a moment|attention required/i;

/** Returns an error message if the fetched page is not scannable, else null. */
export function pageProblem({ status, title, textLength, hasSelector }) {
  if (CHALLENGE_TITLE.test(title || '') || status === 403 || status === 429 || status === 503) return BOT_ERROR;
  if (status < 200 || status >= 300) return `HTTP ${status}`;
  if (textLength === 0) return 'No text found on page';
  if (!hasSelector && textLength < 50) return JS_ERROR;
  return null;
}

/**
 * Compare fresh content against the previous state. prev = { meta, snap }, content = { lines, links, hash }.
 * Returns { meta, snap, event, diff } and never mutates its inputs. First check is a baseline (no event).
 */
export function processScan(watch, prev, content, now) {
  const lines = content.lines.slice(0, MAX_STORED_LINES);
  const links = content.links.slice(0, MAX_LINKS);
  const prevMeta = prev.meta || {};
  const prevSnap = prev.snap || { lines: [], links: [] };
  const meta = { ...prevMeta, lastChecked: now, lastStatus: 'ok', lastError: null, lastHash: content.hash };
  const snap = { lines, links };
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

export function errorMeta(prevMeta, now, message) {
  return { ...(prevMeta || {}), lastChecked: now, lastStatus: 'error', lastError: message };
}

// ---------- seeding ----------

/**
 * Add every default whose id has not been seeded before. data = { watches, seededDefaults } (mutated).
 * Ids are recorded even when skipped for a duplicate URL, so removed defaults never come back.
 */
export function seedFrom(list, data, now) {
  const added = [];
  for (const d of list) {
    const w0 = data.watches.find((w) => w.id === d.id && !w.category);
    if (w0) w0.category = d.category;
    if (data.seededDefaults.includes(d.id)) continue;
    data.seededDefaults.push(d.id);
    let url;
    try { url = validateUrl(d.url); } catch { continue; }
    if (data.watches.some((w) => w.id === d.id || w.url === url)) continue;
    data.watches.push({ id: d.id, url, label: d.label, selector: '', documentsOnly: false, category: d.category, createdAt: now });
    added.push(d.id);
  }
  return added;
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
