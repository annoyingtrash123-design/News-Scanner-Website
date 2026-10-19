'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkWatch } = require('../src/checker');
const { buildChangeEmail } = require('../src/mailer');

const wrap = (items) => `<body><ul>${items.join('')}</ul></body>`;
const A = '<li><a href="/a">Alpha</a> First item.</li>';
const fetcherFor = (html) => async () => ({ html, finalUrl: 'https://site.test/' });

async function run(watch, prev, html) {
  return checkWatch(watch, prev, { fetcher: fetcherFor(html), now: '2025-01-01T00:00:00.000Z' });
}

test('baseline, unchanged, then change with new link', async () => {
  const w = { id: 't1', url: 'https://site.test/' };
  const r1 = await run(w, undefined, wrap([A]));
  assert.equal(r1.entry.lastStatus, 'ok');
  assert.equal(r1.event, null);
  const r2 = await run(w, r1.entry, wrap([A]));
  assert.equal(r2.event, null);
  const r3 = await run(w, r2.entry, wrap([A, '<li><a href="/b">Beta</a> Second item.</li>']));
  assert.ok(r3.event);
  assert.match(r3.event.summary, /1 new link/);
  assert.equal(r3.diff.newLinks[0].href, 'https://site.test/b');
  assert.equal(r3.entry.lastChanged, '2025-01-01T00:00:00.000Z');
});

test('new document produces event with newDocuments and email subject', async () => {
  const w = { id: 't2', url: 'https://site.test/', label: 'Press' };
  const r1 = await run(w, undefined, wrap([A]));
  const r2 = await run(w, r1.entry, wrap([A, '<li><a href="/files/report.PDF?x=1">Annual report</a></li>']));
  assert.equal(r2.event.newDocuments.length, 1);
  assert.equal(r2.event.newDocuments[0].ext, 'pdf');
  const mail = buildChangeEmail({ watch: w, diff: r2.diff, at: r2.event.at });
  assert.equal(mail.subject, 'New document: Press');
  assert.ok(mail.text.indexOf('New documents:') < mail.text.indexOf('Added text') || !mail.text.includes('Added text'));
  assert.match(mail.html, /PDF/);
});

test('plain change gives "Update detected" subject', async () => {
  const w = { id: 't3', url: 'https://site.test/' };
  const r1 = await run(w, undefined, wrap([A]));
  const r2 = await run(w, r1.entry, wrap([A, '<li><a href="/b">Beta</a> Second.</li>']));
  assert.equal(buildChangeEmail({ watch: w, diff: r2.diff, at: r2.event.at }).subject, 'Update detected: site.test');
});

test('documentsOnly: non-document change is stored silently', async () => {
  const w = { id: 't4', url: 'https://site.test/', documentsOnly: true };
  const r1 = await run(w, undefined, wrap([A]));
  const r2 = await run(w, r1.entry, wrap([A, '<li><a href="/b">Beta</a> Second.</li>']));
  assert.equal(r2.event, null);
  assert.notEqual(r2.entry.lastHash, r1.entry.lastHash);
  assert.ok(r2.entry.links.some((l) => l.href.endsWith('/b')));
  assert.equal(r2.entry.lastChanged, undefined);
  const r3 = await run(w, r2.entry, wrap([A, '<li><a href="/b">Beta</a> Second.</li>', '<li><a href="/d.xlsx">Data</a></li>']));
  assert.ok(r3.event);
  assert.deepEqual(r3.event.newDocuments.map((d) => d.ext), ['xlsx']);
});

test('errors are recorded, not thrown', async () => {
  const r = await checkWatch({ id: 'x', url: 'https://site.test/' }, { lastHash: 'abc', links: [] }, { fetcher: async () => { throw new Error('HTTP 500'); } });
  assert.equal(r.entry.lastStatus, 'error');
  assert.equal(r.entry.lastHash, 'abc');
  assert.equal(r.entry.lastError, 'HTTP 500');
});

test('redirect to private address is blocked', async () => {
  const w = { id: 't5', url: 'http://127.0.0.1/' };
  const r = await checkWatch(w, undefined);
  assert.equal(r.entry.lastStatus, 'error');
  assert.match(r.entry.lastError, /not allowed/);
});
