'use strict';
const crypto = require('crypto');
const cheerio = require('cheerio');

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Extract visible text + links from HTML, optionally limited to a CSS selector. */
function extractContent(html, { selector, baseUrl } = {}) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, template').remove();
  let scope = $('body');
  if (selector) {
    let found;
    try { found = $(selector); } catch (e) { throw new Error(`Invalid CSS selector: ${selector}`); }
    if (!found.length) throw new Error(`Selector matched nothing: ${selector}`);
    scope = found;
  }
  if (!scope.length) scope = $.root();

  // Keep block boundaries as line breaks so sentence/line diffing works.
  scope.find('br').replaceWith('\n');
  scope.find('p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, dd, dt, blockquote')
    .each((_, el) => { $(el).append('\n'); });
  const raw = scope.text();
  const lines = raw.split('\n').map(normalizeText).filter(Boolean);
  const text = normalizeText(lines.join(' '));

  const links = [];
  const seen = new Set();
  scope.find('a[href]').addBack('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;
    let abs;
    try { abs = new URL(href, baseUrl).href; } catch { return; }
    if (seen.has(abs)) return;
    seen.add(abs);
    links.push({ href: abs, text: normalizeText($(el).text()).slice(0, 200) });
  });

  return { text, lines, links, hash: sha256(text) };
}

/** Split text into sentence-ish units. */
function splitUnits(lines) {
  const out = [];
  for (const line of lines) {
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
    for (const p of parts) {
      const t = normalizeText(p);
      if (t.length >= 3) out.push(t);
    }
  }
  return out;
}

function computeDiff(prev, curr, cap = 20) {
  const prevLinks = new Set((prev.links || []).map((l) => l.href));
  const newLinks = (curr.links || []).filter((l) => !prevLinks.has(l.href)).slice(0, cap);
  const prevUnits = new Set(splitUnits(prev.lines || []));
  const seen = new Set();
  const addedText = [];
  for (const u of splitUnits(curr.lines || [])) {
    if (prevUnits.has(u) || seen.has(u)) continue;
    seen.add(u);
    addedText.push(u.length > 300 ? u.slice(0, 297) + '...' : u);
    if (addedText.length >= cap) break;
  }
  return { newLinks, addedText };
}

function summarizeDiff(d) {
  const bits = [];
  if (d.newLinks.length) bits.push(`${d.newLinks.length} new link${d.newLinks.length > 1 ? 's' : ''}`);
  if (d.addedText.length) bits.push(`${d.addedText.length} added text item${d.addedText.length > 1 ? 's' : ''}`);
  return bits.length ? bits.join(', ') : 'Content changed';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** True if hostname is obviously local/private. */
function isBlockedHost(hostname) {
  let h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedHost(mapped[1]);
    return /^(fc|fd|fe[89ab])/.test(h);
  }
  return false;
}

/** Validate and normalize a watch URL. Returns {ok, url?, error?}. */
function validateUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return { ok: false, error: 'Invalid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'URL must start with http:// or https://' };
  if (isBlockedHost(u.hostname)) return { ok: false, error: 'That address is not allowed' };
  u.hash = '';
  return { ok: true, url: u.href };
}

module.exports = { normalizeText, sha256, extractContent, splitUnits, computeDiff, summarizeDiff, escapeHtml, isBlockedHost, validateUrl };
