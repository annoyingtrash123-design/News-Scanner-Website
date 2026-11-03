import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../lib.js';

const L = (h, t = 't') => ({ href: h, text: t });

test('classifies documents', () => {
  assert.equal(lib.documentExt('https://x.org/a/Report.PDF?dl=1'), 'pdf');
  assert.equal(lib.documentExt('https://x.org/a/data.xlsx#p'), 'xlsx');
  assert.equal(lib.documentExt('https://x.org/a/b.zip'), 'zip');
  assert.equal(lib.documentExt('https://x.org/pdf'), null);
  assert.equal(lib.documentExt('https://x.org/page.html'), null);
  assert.equal(lib.documentExt('https://x.org/dir.pdf/index'), null);
  assert.equal(lib.documentExt('/rel/file.docx'), 'docx');
});

test('diff finds new docs, links, text', () => {
  const d = lib.computeDiff(['Hello world. Old news here.'], [L('https://a.org/old.pdf')],
    ['Hello world. Old news here. Brand new item for the site.'],
    [L('https://a.org/old.pdf'), L('https://a.org/new.pdf'), L('https://a.org/news/2')]);
  assert.equal(d.newDocuments.length, 1);
  assert.equal(d.newDocuments[0].ext, 'pdf');
  assert.deepEqual(d.newLinks.map((l) => l.href), ['https://a.org/news/2']);
  assert.deepEqual(d.addedText, ['Brand new item for the site.']);
  assert.equal(lib.summarizeDiff(d), '1 new document, 1 new link, 1 added text item');
});

test('noise filter', () => {
  for (const n of ['Monday, 12 March 2025', '3 minutes ago', 'Last updated 2 hours ago', '12:30 pm AEST', '2025-03-12',
    'Published: 12 March 2025 10:15', 'short text', 'Read more', 'Yesterday at 9:30am', 'a few seconds ago']) {
    assert.ok(lib.isNoiseText(n), `${n} should be noise`);
  }
  for (const m of ['Minister announces new critical minerals funding round', 'Applications close 12 March 2025 for the grant program']) {
    assert.ok(!lib.isNoiseText(m), `${m} should be meaningful`);
  }
  const d = lib.computeDiff(['Old line of text here that stays.'], [], ['Old line of text here that stays.', 'Updated 5 minutes ago', 'Monday, 12 March 2025', 'Tiny'], []);
  assert.deepEqual(d.addedText, []);
});

test('splits sentences', () => {
  assert.deepEqual(lib.splitUnits(['One thing. Two things! three lower']), ['One thing.', 'Two things! three lower']);
});

test('url validation (SSRF-ish)', () => {
  assert.ok(!lib.validateUrl('https://example.com/a#frag').includes('#'));
  for (const bad of ['ftp://example.com', 'http://localhost:3000', 'http://foo.local/', 'http://127.0.0.1/', 'http://[::1]/',
    'http://2130706433/', 'not a url', 'http://192.168.1.1/', 'http://10.0.0.1/', 'http://169.254.169.254/', 'http://[fe80::1]/',
    'http://[fc00::1]/', 'http://[::ffff:127.0.0.1]/', 'http://100.64.0.1/', 'http://172.16.5.5/']) {
    assert.throws(() => lib.validateUrl(bad), bad);
  }
  for (const ok of ['http://8.8.8.8/', 'http://172.32.0.1/', 'http://[2606:4700:4700::1111]/']) assert.doesNotThrow(() => lib.validateUrl(ok), ok);
});

const watch = (docsOnly = false) => ({ id: 'w1', url: 'https://a.org/news', label: 'A', documentsOnly: docsOnly });
const content = async (lines, links, text = lines.join(' ')) => ({ lines, links, hash: await lib.sha256Hex(text) });

test('sha256', async () => {
  assert.equal(await lib.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('baseline then change', async () => {
  const w = watch();
  const base = lib.processScan(w, { meta: {}, snap: null }, await content(['Hello world.'], [L('https://a.org/a.pdf')]), 't1');
  assert.equal(base.event, null);
  const same = lib.processScan(w, base, await content(['Hello world.'], [L('https://a.org/a.pdf')]), 't2');
  assert.equal(same.event, null);
  const ch = lib.processScan(w, base, await content(['Hello world. Something new here.'], [L('https://a.org/a.pdf'), L('https://a.org/b.pdf')]), 't3');
  assert.equal(ch.event.newDocuments.length, 1);
  assert.equal(ch.event.newDocuments[0].href, 'https://a.org/b.pdf');
  assert.equal(ch.meta.lastChanged, 't3');
  assert.equal(ch.event.watchId, 'w1');
});

test('documentsOnly gating: state advances, no event', async () => {
  const w = watch(true);
  const base = lib.processScan(w, { meta: {} }, await content(['Hello world.'], [L('https://a.org/a.pdf')]), 't1');
  const textOnly = lib.processScan(w, base, await content(['Hello world. Only text changed here, a lot of it.'], [L('https://a.org/a.pdf')]), 't2');
  assert.equal(textOnly.event, null);
  assert.equal(textOnly.meta.lastChanged, undefined);
  assert.notEqual(textOnly.meta.lastHash, base.meta.lastHash);
  const withDoc = lib.processScan(w, base, await content(['Hello world.'], [L('https://a.org/a.pdf'), L('https://a.org/b.pdf')], 'x'), 't3');
  assert.ok(withDoc.event);
});

test('noise-only change makes no event but updates state; meaningful text does', async () => {
  const w = watch();
  const a = ['Hello world, this is a long enough sentence.', 'Updated 3 minutes ago'];
  const b = ['Hello world, this is a long enough sentence.', 'Updated 9 minutes ago', 'Monday, 12 March 2025'];
  const base = lib.processScan(w, { meta: {} }, await content(a, []), 't1');
  const ch = lib.processScan(w, base, await content(b, []), 't2');
  assert.equal(ch.event, null);
  assert.equal(ch.meta.lastChanged, undefined);
  assert.notEqual(ch.meta.lastHash, base.meta.lastHash);
  assert.ok(ch.snap.lines.some((l) => l.includes('9 minutes')));
  const c = ['Hello world, this is a long enough sentence.', 'Minister announces a brand new funding program'];
  const ev = lib.processScan(w, ch, await content(c, []), 't3').event;
  assert.equal(ev.addedText.length, 1);
});

test('stored caps and error meta keeps old hash', async () => {
  const lines = Array.from({ length: 1200 }, (_, i) => `line ${i}`);
  const links = Array.from({ length: 1700 }, (_, i) => L(`https://a.org/${i}`));
  const r = lib.processScan(watch(), { meta: {} }, await content(lines, links), 't');
  assert.equal(r.snap.lines.length, 1000);
  assert.equal(r.snap.links.length, 1500);
  const e = lib.errorMeta(r.meta, 't2', 'boom');
  assert.equal(e.lastStatus, 'error');
  assert.equal(e.lastHash, r.meta.lastHash);
});

test('page problems: bot challenge, JS-only, HTTP errors', () => {
  const p = (o) => lib.pageProblem({ status: 200, title: '', textLength: 500, hasSelector: false, ...o });
  assert.equal(p({}), null);
  assert.equal(p({ title: 'Just a moment...' }).errorKind, 'blocked');
  assert.equal(p({ title: 'Attention Required! | Cloudflare', status: 403 }).errorKind, 'blocked');
  for (const status of [403, 429, 401, 412]) assert.equal(p({ status }).errorKind, 'blocked');
  assert.equal(p({ status: 503 }).errorKind, 'server');
  assert.equal(p({ status: 404 }).errorKind, 'not_found');
  assert.equal(p({ status: 404 }).error, 'HTTP 404');
  assert.equal(p({ textLength: 10 }).errorKind, 'no_text');
  assert.equal(p({ textLength: 10, hasSelector: true }), null);
  assert.equal(p({ textLength: 0, hasSelector: true }).error, 'No text found on page');
  assert.match(lib.BOT_ERROR, /Opening the site once in Chrome sometimes helps/);
});

test('error classification: statuses and messages', () => {
  for (const s of [401, 403, 412, 429]) assert.equal(lib.kindForStatus(s), 'blocked');
  for (const s of [404, 410]) assert.equal(lib.kindForStatus(s), 'not_found');
  for (const s of [500, 502, 503, 520, 524]) assert.equal(lib.kindForStatus(s), 'server');
  assert.equal(lib.kindForStatus(418), 'other');
  const k = lib.kindForMessage;
  assert.equal(k('invalid peer certificate: UnknownIssuer'), 'tls');
  assert.equal(k('received fatal alert: HandshakeFailure'), 'tls');
  assert.equal(k('peer closed connection without sending TLS close_notify'), 'tls');
  assert.equal(k('forcibly closed by the remote host (os error 10054)'), 'connection');
  assert.equal(k('hostname resolution (os error 11002)'), 'dns');
  assert.equal(k('Timed out after 35s'), 'timeout');
  assert.equal(k('something odd'), 'other');
});

test('retry policy: transient failures once, never blocked', () => {
  const r = (errorKind, error, extra = {}) => lib.fail(errorKind, error, extra);
  const http = (status, extra = {}) => r(lib.kindForStatus(status), `HTTP ${status}`, { status, ...extra });
  for (const s of [502, 503, 504, 520, 522, 524]) assert.equal(lib.retryDelayMs(http(s)), 3000, String(s));
  for (const s of [500, 404, 410, 400]) assert.equal(lib.retryDelayMs(http(s)), null, String(s));
  for (const s of [401, 403, 412]) assert.equal(lib.retryDelayMs(http(s, { retryAfter: 1 })), null, String(s));
  assert.equal(lib.retryDelayMs(r('blocked', 'Bot-challenge page')), null);
  assert.equal(lib.retryDelayMs(http(429)), null);
  assert.equal(lib.retryDelayMs(http(429, { retryAfter: 61 })), null);
  assert.equal(lib.retryDelayMs(http(429, { retryAfter: 60 })), 60000);
  assert.equal(lib.retryDelayMs(http(429, { retryAfter: 5 })), 5000);
  assert.equal(lib.retryDelayMs(r('timeout', 'Timed out after 35s')), 3000);
  assert.equal(lib.retryDelayMs(r('connection', lib.NETWORK_ERROR)), 3000);
  assert.equal(lib.retryDelayMs(r('connection', 'Connection refused (os error 10061)')), null);
  assert.equal(lib.retryDelayMs(r('dns', 'temporary (os error 11002)')), 3000);
  assert.equal(lib.retryDelayMs(r('dns', 'ERR_NAME_NOT_RESOLVED')), null);
  assert.equal(lib.retryDelayMs(r('tls', 'peer closed connection without sending TLS close_notify')), 3000);
  assert.equal(lib.retryDelayMs(r('tls', 'UnknownIssuer')), null);
  assert.equal(lib.retryDelayMs(r('no_text', 'No text found on page')), null);
  assert.equal(lib.retryDelayMs(r('timeout', 'Timed out', { attempts: 2 })), null);
  assert.equal(lib.retryDelayMs({ ok: true }), null);
  assert.equal(lib.parseRetryAfter('7'), 7);
  assert.equal(lib.parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'), null);
  assert.equal(lib.parseRetryAfter(null), null);
});

test('friendly messages and error state', () => {
  assert.equal(lib.friendlyError(lib.fail('blocked', 'HTTP 403', { status: 403 })), lib.BOT_ERROR);
  assert.equal(lib.friendlyError(lib.fail('server', 'HTTP 520', { status: 520 })), "The site's own server returned an error (HTTP 520) — usually temporary or the site is down.");
  assert.equal(lib.friendlyError(lib.fail('timeout', 'x', { attempts: 2 })), 'Timed out after 35s (tried twice).');
  assert.match(lib.friendlyError(lib.fail('no_text', 'x')), /needs JavaScript/);
  const m = lib.errorMeta({ lastHash: 'h' }, 't', lib.fail('server', 'HTTP 502', { status: 502, attempts: 2 }));
  assert.equal(m.lastStatus, 'error');
  assert.equal(m.lastError, 'HTTP 502');
  assert.equal(m.errorKind, 'server');
  assert.match(m.errorMessage, /\(tried twice\)/);
  assert.equal(m.lastHash, 'h');
  assert.equal(lib.errorMeta({}, 't', 'boom').errorKind, 'other');
});

test('notification text', () => {
  const ev = (label, docs = 0) => ({ label, url: 'https://x.org', newDocuments: Array(docs).fill({}) });
  assert.equal(lib.buildNotification([]), null);
  assert.equal(lib.buildNotification([ev('Tronox', 1)]).message, 'New document: Tronox');
  assert.equal(lib.buildNotification([ev('A'), ev('B'), ev('C'), ev('D')]).message, '4 sites updated — A, B, C, …');
  assert.equal(lib.buildNotification([ev('NSW Resources')]).message, '1 site updated — NSW Resources');
});

test('bounded concurrency: global 4, one per host', async () => {
  let total = 0, maxTotal = 0, done = 0;
  const per = { a: 0, b: 0, c: 0 }, maxPer = { a: 0, b: 0, c: 0 };
  const items = Array.from({ length: 18 }, (_, i) => ['a', 'b', 'c'][i % 3]);
  await lib.forEachBounded(items, 4, (h) => h, async (h) => {
    total++; maxTotal = Math.max(maxTotal, total);
    per[h]++; maxPer[h] = Math.max(maxPer[h], per[h]);
    await new Promise((r) => setTimeout(r, 10));
    per[h]--; total--; done++;
    if (done === 5) throw new Error('one failure must not stop the run');
  });
  assert.equal(done, 18);
  assert.ok(maxTotal <= 4 && maxTotal >= 2);
  assert.deepEqual(maxPer, { a: 1, b: 1, c: 1 });
});
