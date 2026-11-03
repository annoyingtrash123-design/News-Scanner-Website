// Pure UI logic: Sydney time, day buckets, grouping/sorting by relevance, honest coverage counts.
// No DOM access. app/web/ui-logic.js is a byte-for-byte copy (tests/ui-logic.test.js checks it).

export const SYDNEY_TZ = 'Australia/Sydney';
export const MAX_CHIPS = 4;

// ---------- Sydney time ----------

const fmtCache = {};
function dtf(key, opts) {
  return fmtCache[key] || (fmtCache[key] = new Intl.DateTimeFormat('en-AU', { timeZone: SYDNEY_TZ, ...opts }));
}

function partsOf(fmt, date) {
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  return o;
}

/** Calendar and clock fields of an instant as seen in Sydney. */
export function sydneyParts(when) {
  const date = when instanceof Date ? when : new Date(when);
  const p = partsOf(dtf('parts', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  }), date);
  const off = /([+-])(\d{1,2})(?::?(\d{2}))?/.exec(p.timeZoneName || '');
  const hours = off ? Number(off[2]) * (off[1] === '-' ? -1 : 1) : null;
  const abbr = hours === 11 ? 'AEDT' : hours === 10 ? 'AEST' : (p.timeZoneName || 'Sydney');
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day), weekday: p.weekday,
    hour: p.hour === '24' ? '00' : p.hour, minute: p.minute, abbr,
  };
}

/** "2026-11-03": the Sydney calendar date of an instant. */
export function sydneyDateKey(when) {
  const p = sydneyParts(when);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The calendar date before a "YYYY-MM-DD" key (pure date arithmetic, so DST changes cannot affect it). */
export function previousDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** 'today' | 'yesterday' | 'older', by Sydney calendar date. Future timestamps count as today. */
export function dayBucket(when, now = Date.now()) {
  const day = sydneyDateKey(when);
  const today = sydneyDateKey(now);
  if (day >= today) return 'today';
  if (day === previousDateKey(today)) return 'yesterday';
  return 'older';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Sydney time for display, e.g. "Tue 3 Nov, 16:12 AEDT". opts.date=false gives just "16:12 AEDT".
 * The year is added when it is not the current Sydney year.
 */
export function formatSydney(when, opts = {}, now = Date.now()) {
  if (!when) return 'never';
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return String(when);
  const p = sydneyParts(date);
  const time = `${p.hour}:${p.minute} ${p.abbr}`;
  if (opts.date === false) return time;
  const yr = p.year === sydneyParts(now).year ? '' : ` ${p.year}`;
  return `${p.weekday} ${p.day} ${MONTHS[p.month - 1]}${yr}, ${time}`;
}

// ---------- relevance ----------

const RANK = { high: 3, medium: 2, '': 1, undefined: 1, low: 0 };
export const relevanceRank = (r) => (r in RANK ? RANK[r] : 1);
/** 'high' | 'medium' | 'low' | 'unscored' */
export const relevanceLabel = (r) => (r === 'high' || r === 'medium' || r === 'low' ? r : 'unscored');

export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

const spansFor = (ev, kind, index) => {
  const m = (ev.itemMatches || []).find((x) => x.kind === kind && x.index === index);
  return m ? m.spans : null;
};

/**
 * Group events by site and Sydney day bucket. `events` are newest first. Each group carries its best
 * relevance, matched names, and the documents/links/text items (matched ones first) with highlight spans.
 */
export function groupEvents(events, now = Date.now()) {
  const map = new Map();
  for (const ev of events) {
    const bucket = dayBucket(ev.at, now);
    const key = `${ev.watchId}|${bucket}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key, watchId: ev.watchId, bucket, url: ev.url, label: ev.label || hostOf(ev.url), at: ev.at, rank: -1, relevance: 'unscored',
        topics: [], companies: [], focus: [], docs: [], links: [], texts: [], seen: new Set(),
      };
      map.set(key, g);
    }
    const r = relevanceRank(ev.relevance);
    if (r > g.rank) { g.rank = r; g.relevance = relevanceLabel(ev.relevance); }
    for (const [from, to] of [[ev.matchedTopics, g.topics], [ev.matchedCompanies, g.companies], [ev.matchedFocus, g.focus]]) {
      for (const n of from || []) if (!to.includes(n)) to.push(n);
    }
    (ev.newDocuments || []).forEach((d, i) => {
      if (g.seen.has(d.href)) return;
      g.seen.add(d.href); g.docs.push({ ...d, spans: spansFor(ev, 'doc', i) });
    });
    (ev.newLinks || []).forEach((l, i) => {
      if (g.seen.has(l.href)) return;
      g.seen.add(l.href); g.links.push({ ...l, spans: spansFor(ev, 'link', i) });
    });
    (ev.addedText || []).forEach((t, i) => {
      if (!g.texts.some((x) => x.text === t)) g.texts.push({ text: t, spans: spansFor(ev, 'text', i) });
    });
  }
  const matchedFirst = (a, b) => (b.spans ? 1 : 0) - (a.spans ? 1 : 0);
  for (const g of map.values()) {
    g.docs.sort(matchedFirst); g.links.sort(matchedFirst); g.texts.sort(matchedFirst);
    delete g.seen;
  }
  return [...map.values()];
}

/** Split groups into today/yesterday/older, each sorted High -> Medium -> unscored -> Low, then newest first. */
export function bucketGroups(groups) {
  const out = { today: [], yesterday: [], older: [] };
  for (const g of groups) out[g.bucket].push(g);
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.rank - a.rank || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out;
}

/** Up to `max` matched-keyword chips: special-focus first, then companies, then topic groups. */
export function chipsFor(g, max = MAX_CHIPS) {
  const all = [];
  const seen = new Set();
  for (const [kind, names] of [['focus', g.focus], ['company', g.companies], ['topic', g.topics]]) {
    for (const name of names) {
      const k = name.toLowerCase().replace(/-/g, ' ');
      if (!seen.has(k)) { seen.add(k); all.push({ kind, name }); }
    }
  }
  return { chips: all.slice(0, max), extra: Math.max(0, all.length - max) };
}

/** Split text into plain and highlighted pieces. Spans are UTF-16 [start, end) pairs; they are clipped to `limit`. */
export function highlightSegments(text, spans, limit = text.length) {
  const s = text.length > limit ? text.slice(0, limit) : text;
  const out = [];
  let pos = 0;
  for (const [a, b] of spans || []) {
    const start = Math.max(a, pos), end = Math.min(b, s.length);
    if (start >= end) continue;
    if (start > pos) out.push({ text: s.slice(pos, start), mark: false });
    out.push({ text: s.slice(start, end), mark: true });
    pos = end;
  }
  if (pos < s.length) out.push({ text: s.slice(pos), mark: false });
  return out.length ? out : [{ text: s, mark: false }];
}

// ---------- coverage (honest counts) ----------

/**
 * A site counts as checked only if its most recent check succeeded. When the latest full scan is known,
 * that check must also have happened during or after it, so a stale success from an earlier scan does not count.
 */
export function isChecked(w, run) {
  if (w.lastStatus !== 'ok' || !w.lastChecked) return false;
  if (run && run.startedAt) return Date.parse(w.lastChecked) >= Date.parse(run.startedAt);
  return true;
}

/** Failed in the latest scan: the most recent check ended in an error. */
export const isFailed = (w, run) => w.lastStatus === 'error' && !!w.lastChecked && (!run || !run.startedAt || Date.parse(w.lastChecked) >= Date.parse(run.startedAt));

/**
 * Coverage of the latest full scan. `run` = { running, done, total, startedAt, finishedAt } or null.
 * Errors, sites not reached and sites never checked all count as not checked.
 */
export function coverage(watches, run, running = !!(run && run.running)) {
  const total = watches.length;
  const checked = watches.filter((w) => isChecked(w, run)).length;
  const failed = watches.filter((w) => isFailed(w, run)).length;
  const state = running ? 'running' : run && run.startedAt ? 'done' : 'none';
  return {
    state, total, checked, failed, notChecked: total - checked, notReached: total - checked - failed,
    done: run ? run.done || 0 : 0, runTotal: run ? run.total || 0 : 0,
    endedEarly: state === 'done' && !!run && (run.done || 0) < (run.total || 0),
  };
}

/** The line at the top of the Updates tab. The "(view)" link is added by the page when notChecked > 0. */
export function coverageText(cov, run, now = Date.now()) {
  if (cov.state === 'running') return `Scan in progress — ${cov.done} of ${cov.runTotal} done`;
  if (cov.state === 'none') return 'No full scan has finished yet, so no coverage figure is available.';
  const when = formatSydney(run.finishedAt || run.startedAt, {}, now);
  let t = `Last scan ${when}: ${cov.checked} of ${cov.total} sites checked`;
  if (cov.notChecked > 0) t += ` · ${cov.notChecked} couldn't be checked`;
  if (cov.endedEarly) t += ` · scan stopped early (${cov.done} of ${cov.runTotal} attempted)`;
  return t;
}

/** "n/m checked" for one Sites-tab category. */
export function categoryCoverage(watches, run) {
  return { checked: watches.filter((w) => isChecked(w, run)).length, total: watches.length };
}

// ---------- failure reasons ----------

/** Failure categories (see errorKind) in display order, with the heading used when grouping failed sites. */
export const ERROR_GROUPS = [
  ['blocked', 'Blocked by bot protection or paywall'],
  ['server', "The site's server returned an error"],
  ['tls', 'Secure connection failed'],
  ['timeout', 'Timed out'],
  ['dns', "Couldn't look up the site's address (DNS)"],
  ['connection', 'Connection cut off'],
  ['no_text', 'No readable text (probably needs JavaScript)'],
  ['not_found', 'Page not found'],
  ['other', 'Other problems'],
];

/** Category of a failed site; sites saved before categories existed fall under "other". */
export const errorKindOf = (w) => (ERROR_GROUPS.some(([k]) => k === w.errorKind) ? w.errorKind : 'other');

/** Friendly message for a failed site (falls back to the raw error for older saved results). */
export const errorText = (w) => w.errorMessage || w.lastError || 'Check failed';

/** Group failed sites by reason: [{ kind, label, items }] in display order, empty groups left out. */
export function groupByErrorKind(sites) {
  return ERROR_GROUPS
    .map(([kind, label]) => ({ kind, label, items: sites.filter((w) => errorKindOf(w) === kind) }))
    .filter((g) => g.items.length);
}
