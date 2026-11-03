import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as ui from '../ui-logic.js';

const here = dirname(fileURLToPath(import.meta.url));

test('app/web/ui-logic.js is an identical copy', () => {
  assert.equal(readFileSync(join(here, '../../app/web/ui-logic.js'), 'utf8'), readFileSync(join(here, '../ui-logic.js'), 'utf8'));
});

test('Sydney labels follow DST (AEDT in summer, AEST in winter)', () => {
  assert.equal(ui.sydneyParts('2026-01-15T00:00:00Z').abbr, 'AEDT');
  assert.equal(ui.sydneyParts('2026-07-15T00:00:00Z').abbr, 'AEST');
  assert.equal(ui.formatSydney('2026-11-03T05:12:00Z', {}, Date.parse('2026-11-03T06:00:00Z')), 'Tue 3 Nov, 16:12 AEDT');
  assert.equal(ui.formatSydney('2026-07-15T00:30:00Z', { date: false }), '10:30 AEST');
  // the year is shown only when it is not the current Sydney year (31 Dec 13:30Z is already 1 Jan in Sydney)
  assert.equal(ui.formatSydney('2025-12-31T13:30:00Z', {}, Date.parse('2026-01-02T00:00:00Z')), 'Thu 1 Jan, 00:30 AEDT');
  assert.equal(ui.formatSydney('2025-12-31T12:30:00Z', {}, Date.parse('2026-01-02T00:00:00Z')), 'Wed 31 Dec 2025, 23:30 AEDT');
});

test('Sydney calendar dates around the DST changes', () => {
  // DST starts Sun 4 Oct 2026 (02:00 AEST -> 03:00 AEDT); ends Sun 5 Apr 2026 (03:00 AEDT -> 02:00 AEST)
  assert.equal(ui.sydneyDateKey('2026-10-03T13:59:00Z'), '2026-10-03'); // 23:59 AEST
  assert.equal(ui.sydneyDateKey('2026-10-03T14:00:00Z'), '2026-10-04'); // 00:00 AEST
  assert.equal(ui.sydneyDateKey('2026-10-04T12:59:00Z'), '2026-10-04'); // 23:59 AEDT
  assert.equal(ui.sydneyDateKey('2026-10-04T13:00:00Z'), '2026-10-05'); // 00:00 AEDT
  assert.equal(ui.sydneyDateKey('2026-04-04T12:59:00Z'), '2026-04-04'); // 23:59 AEDT
  assert.equal(ui.sydneyDateKey('2026-04-04T13:00:00Z'), '2026-04-05'); // 00:00 AEDT
  assert.equal(ui.sydneyDateKey('2026-04-05T13:59:00Z'), '2026-04-05'); // 23:59 AEST
  assert.equal(ui.sydneyDateKey('2026-04-05T14:00:00Z'), '2026-04-06'); // 00:00 AEST
});

test('Today / Yesterday / Older buckets by Sydney date, across DST', () => {
  // now = Mon 5 Oct 2026 09:00 AEDT, the first morning after clocks went forward
  const now = Date.parse('2026-10-04T22:00:00Z');
  assert.equal(ui.sydneyDateKey(now), '2026-10-05');
  assert.equal(ui.dayBucket('2026-10-04T13:00:00Z', now), 'today'); // 00:00 AEDT Mon
  assert.equal(ui.dayBucket('2026-10-04T12:59:00Z', now), 'yesterday'); // 23:59 AEDT Sun
  assert.equal(ui.dayBucket('2026-10-03T14:00:00Z', now), 'yesterday'); // 00:00 AEST Sun
  assert.equal(ui.dayBucket('2026-10-03T13:59:00Z', now), 'older'); // 23:59 Sat
  // a UTC-date comparison would get this wrong: 2026-10-04T20:00Z is already Monday in Sydney
  assert.equal(ui.dayBucket('2026-10-04T20:00:00Z', now), 'today');
  // clocks going back: now = Mon 6 Apr 2026 08:00 AEST
  const now2 = Date.parse('2026-04-05T22:00:00Z');
  assert.equal(ui.dayBucket('2026-04-05T13:30:00Z', now2), 'yesterday'); // 23:30 AEST Sun
  assert.equal(ui.dayBucket('2026-04-04T14:00:00Z', now2), 'yesterday'); // 01:00 AEDT Sun 5 Apr (the repeated hour day)
  assert.equal(ui.dayBucket('2026-04-04T12:59:00Z', now2), 'older'); // 23:59 AEDT Sat 4 Apr
  assert.equal(ui.dayBucket('2026-04-05T14:00:00Z', now2), 'today'); // 00:00 AEST Mon 6 Apr
  assert.equal(ui.previousDateKey('2026-03-01'), '2026-02-28');
  assert.equal(ui.previousDateKey('2026-01-01'), '2025-12-31');
});

const ev = (watchId, at, relevance, extra = {}) => ({ watchId, url: `https://${watchId}.org/`, label: watchId, at, relevance, newLinks: [], newDocuments: [], addedText: [], ...extra });

test('groups per site and day, sorted by relevance then time', () => {
  const now = Date.parse('2026-11-03T06:00:00Z');
  const groups = ui.groupEvents([
    ev('low1', '2026-11-03T05:00:00Z', 'low'),
    ev('med1', '2026-11-03T04:00:00Z', 'medium'),
    ev('hi1', '2026-11-03T01:00:00Z', 'high', { matchedFocus: ['Gallium'], matchedTopics: ['Critical minerals'] }),
    ev('hi2', '2026-11-03T03:00:00Z', 'high'),
    ev('hi1', '2026-11-02T01:00:00Z', 'medium'), // yesterday in Sydney (12:00 AEDT 2 Nov)
    ev('old', '2026-10-01T01:00:00Z', 'high'),
  ], now);
  const b = ui.bucketGroups(groups);
  assert.deepEqual(b.today.map((g) => g.label), ['hi2', 'hi1', 'med1', 'low1']);
  assert.deepEqual(b.yesterday.map((g) => g.label), ['hi1']);
  assert.equal(b.yesterday[0].relevance, 'medium');
  assert.deepEqual(b.older.map((g) => g.label), ['old']);
});

test('items keep their highlight spans and matched ones come first', () => {
  const e = ev('s', '2026-11-03T01:00:00Z', 'high', {
    newLinks: [{ href: 'https://s.org/1', text: 'Nothing' }, { href: 'https://s.org/2', text: 'Gallium curbs' }],
    itemMatches: [{ kind: 'link', index: 1, spans: [[0, 7]] }],
  });
  const [g] = ui.groupEvents([e], Date.parse('2026-11-03T06:00:00Z'));
  assert.deepEqual(g.links.map((l) => l.text), ['Gallium curbs', 'Nothing']);
  assert.deepEqual(g.links[0].spans, [[0, 7]]);
  assert.equal(g.links[1].spans, null);
});

test('chips: focus, then companies, then topics, max 4, de-duplicated', () => {
  const g = { focus: ['Gallium', 'JS Link'], companies: ['JS Link', 'Lynas'], topics: ['Critical minerals', 'Magnets'] };
  const r = ui.chipsFor(g);
  assert.deepEqual(r.chips.map((c) => c.name), ['Gallium', 'JS Link', 'Lynas', 'Critical minerals']);
  assert.equal(r.extra, 1);
  assert.equal(ui.chipsFor({ focus: [], companies: [], topics: [] }).chips.length, 0);
});

test('highlight segments never produce HTML and clip to the shown text', () => {
  assert.deepEqual(ui.highlightSegments('a <b>x</b> y', [[2, 5]]), [{ text: 'a ', mark: false }, { text: '<b>', mark: true }, { text: 'x</b> y', mark: false }]);
  assert.deepEqual(ui.highlightSegments('abcdef', [[1, 3], [4, 6]], 5), [{ text: 'a', mark: false }, { text: 'bc', mark: true }, { text: 'd', mark: false }, { text: 'e', mark: true }]);
  assert.deepEqual(ui.highlightSegments('plain', null), [{ text: 'plain', mark: false }]);
});

const W = (id, lastStatus, lastChecked) => ({ id, lastStatus, lastChecked });
const RUN = { running: false, done: 5, total: 5, startedAt: '2026-11-03T00:00:00.000Z', finishedAt: '2026-11-03T00:10:00.000Z' };

test('coverage counts only sites whose latest check succeeded in the latest scan', () => {
  const watches = [
    W('a', 'ok', '2026-11-03T00:01:00.000Z'),
    W('b', 'ok', '2026-11-03T00:02:00.000Z'),
    W('c', 'error', '2026-11-03T00:03:00.000Z'),
    W('d', 'ok', '2026-11-02T00:00:00.000Z'), // succeeded in an earlier scan, not reached in this one
    W('e', undefined, undefined), // never checked
  ];
  const cov = ui.coverage(watches, RUN);
  assert.equal(cov.state, 'done');
  assert.equal(cov.total, 5);
  assert.equal(cov.checked, 2);
  assert.equal(cov.failed, 1);
  assert.equal(cov.notChecked, 3);
  assert.equal(cov.notReached, 2);
  assert.equal(ui.coverageText(cov, RUN, Date.parse('2026-11-03T06:00:00Z')), "Last scan Tue 3 Nov, 11:10 AEDT: 2 of 5 sites checked · 3 couldn't be checked");
  // all good: no "couldn't" clause
  const all = ui.coverage([W('a', 'ok', '2026-11-03T00:01:00.000Z')], RUN);
  assert.equal(ui.coverageText(all, RUN, Date.parse('2026-11-03T06:00:00Z')), 'Last scan Tue 3 Nov, 11:10 AEDT: 1 of 1 sites checked');
});

test('coverage while running, before any scan, and after an early stop', () => {
  const watches = [W('a', 'ok', '2026-11-03T00:01:00.000Z'), W('b', 'ok', '2026-11-02T00:01:00.000Z')];
  const running = { running: true, done: 40, total: 126, startedAt: RUN.startedAt, finishedAt: null };
  assert.equal(ui.coverageText(ui.coverage(watches, running), running), 'Scan in progress — 40 of 126 done');
  const none = ui.coverage(watches, null);
  assert.equal(none.state, 'none');
  assert.match(ui.coverageText(none, null), /No full scan/);
  const stopped = { running: false, done: 1, total: 2, startedAt: RUN.startedAt, finishedAt: RUN.finishedAt };
  const cov = ui.coverage(watches, stopped);
  assert.ok(cov.endedEarly);
  assert.match(ui.coverageText(cov, stopped, Date.parse('2026-11-03T06:00:00Z')), /1 of 2 sites checked · 1 couldn't be checked · scan stopped early \(1 of 2 attempted\)/);
  // without a run on record a site counts only if its latest check succeeded
  assert.equal(ui.isChecked(W('a', 'ok', '2020-01-01T00:00:00Z'), null), true);
  assert.equal(ui.isChecked(W('a', 'error', '2020-01-01T00:00:00Z'), null), false);
});

test('category coverage', () => {
  const ws = [W('a', 'ok', '2026-11-03T00:01:00.000Z'), W('b', 'error', '2026-11-03T00:02:00.000Z'), W('c', undefined, undefined)];
  assert.deepEqual(ui.categoryCoverage(ws, RUN), { checked: 1, total: 3 });
});

test('failed sites are grouped by reason, in display order', async () => {
  const m = await import('../ui-logic.js');
  const w = (id, errorKind, extra = {}) => ({ id, lastStatus: 'error', errorKind, lastError: 'raw', ...extra });
  const g = m.groupByErrorKind([w(1, 'timeout'), w(2, 'blocked'), w(3, 'blocked'), w(4, undefined), w(5, 'weird')]);
  assert.deepEqual(g.map((x) => [x.kind, x.items.length]), [['blocked', 2], ['timeout', 1], ['other', 2]]);
  assert.equal(m.errorText({ errorMessage: 'Friendly', lastError: 'raw' }), 'Friendly');
  assert.equal(m.errorText({ lastError: 'raw' }), 'raw');
  assert.equal(m.errorText({}), 'Check failed');
});
