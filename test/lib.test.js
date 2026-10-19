'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractContent, computeDiff, validateUrl, sha256, isBlockedHost, normalizeText } = require('../src/lib');

const html = `<html><body><script>var x=1</script><style>p{}</style>
<nav><a href="/about">About</a></nav>
<div id="list"><h2>Releases</h2><ul>
<li><a href="/r/1">Release One</a> Something happened.</li>
<li><a href="https://other.example/r/2">Release Two</a></li></ul></div>
<a href="mailto:x@y.z">mail</a></body></html>`;

test('normalizeText collapses whitespace', () => {
  assert.equal(normalizeText('  a \n\t b  '), 'a b');
});

test('extractContent strips scripts and resolves links', () => {
  const c = extractContent(html, { baseUrl: 'https://site.test/news/' });
  assert.ok(!c.text.includes('var x'));
  assert.ok(c.text.includes('Release One'));
  assert.deepEqual(c.links.map((l) => l.href), ['https://site.test/about', 'https://site.test/r/1', 'https://other.example/r/2']);
});

test('selector limits scope; bad selector throws', () => {
  const c = extractContent(html, { selector: '#list', baseUrl: 'https://site.test/' });
  assert.ok(!c.text.includes('About'));
  assert.equal(c.links.length, 2);
  assert.throws(() => extractContent(html, { selector: '#nope' }), /matched nothing/);
});

test('hash is stable and changes with content', () => {
  const a = extractContent(html, { baseUrl: 'https://s.test/' });
  const b = extractContent(html, { baseUrl: 'https://s.test/' });
  const c = extractContent(html.replace('Release Two', 'Release Three'), { baseUrl: 'https://s.test/' });
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
  assert.equal(a.hash, sha256(a.text));
});

test('computeDiff finds new links and added text', () => {
  const before = extractContent(html, { baseUrl: 'https://s.test/' });
  const after = extractContent(html.replace('</ul>', '<li><a href="/r/3">Release Three</a> Brand new statement. Another one.</li></ul>'), { baseUrl: 'https://s.test/' });
  const d = computeDiff(before, after);
  assert.deepEqual(d.newLinks.map((l) => l.href), ['https://s.test/r/3']);
  assert.ok(d.addedText.some((t) => t.includes('Brand new statement.')));
  assert.ok(d.addedText.some((t) => t === 'Another one.'));
});

test('computeDiff caps results', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `Line number ${i}`);
  const d = computeDiff({ lines: [], links: [] }, { lines, links: [] }, 20);
  assert.equal(d.addedText.length, 20);
});

test('validateUrl accepts http(s) and rejects unsafe targets', () => {
  assert.equal(validateUrl('https://example.com/a#frag').url, 'https://example.com/a');
  for (const bad of ['ftp://example.com', 'javascript:alert(1)', 'not a url', 'http://localhost:3000', 'http://127.0.0.1', 'http://10.1.2.3', 'http://192.168.1.1', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://172.16.0.1']) {
    assert.equal(validateUrl(bad).ok, false, bad);
  }
});

test('isBlockedHost', () => {
  assert.equal(isBlockedHost('example.com'), false);
  assert.equal(isBlockedHost('8.8.8.8'), false);
  assert.equal(isBlockedHost('::ffff:127.0.0.1'), true);
});

const { documentExt, isDocumentLink } = require('../src/lib');

test('document classification by URL path extension', () => {
  for (const e of ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'rtf', 'zip']) {
    assert.equal(documentExt(`https://s.test/f/file.${e}`), e);
  }
  assert.equal(documentExt('https://s.test/a/B.PDF?download=1#p2'), 'pdf');
  assert.equal(isDocumentLink('https://s.test/page.html'), false);
  assert.equal(isDocumentLink('https://s.test/pdf'), false);
  assert.equal(isDocumentLink('https://s.test/view?file=a.pdf'), false);
});

test('computeDiff separates new documents from other links', () => {
  const prev = { lines: [], links: [{ href: 'https://s.test/old.pdf', text: 'Old' }] };
  const curr = { lines: [], links: [
    { href: 'https://s.test/old.pdf', text: 'Old' },
    { href: 'https://s.test/new.docx', text: 'New' },
    { href: 'https://s.test/news/1', text: 'Story' },
  ] };
  const d = computeDiff(prev, curr);
  assert.deepEqual(d.newDocuments.map((l) => [l.href, l.ext]), [['https://s.test/new.docx', 'docx']]);
  assert.deepEqual(d.newLinks.map((l) => l.href), ['https://s.test/news/1']);
});
