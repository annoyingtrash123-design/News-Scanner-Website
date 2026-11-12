import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../lib.js';
import { parseXml } from './xml-shim.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>Mining News</title><link>https://a.org/</link><lastBuildDate>Mon, 02 Nov 2026 01:00:00 +0000</lastBuildDate>
<atom:link href="https://a.org/feed/" rel="self" type="application/rss+xml"/>
<item><title><![CDATA[Lithium &amp; rare earths: Lynas expands]]></title><link>https://a.org/news/lynas</link><guid isPermaLink="false">a-1</guid><pubDate>Mon, 02 Nov 2026 00:00:00 +0000</pubDate>
<description><![CDATA[<p>Lynas will <b>double</b> output.</p><p>More&nbsp;soon.</p>]]></description></item>
<item><title>Annual report</title><link>/files/report.pdf</link><guid>https://a.org/files/report.pdf</guid><description>Escaped &lt;i&gt;html&lt;/i&gt; here &amp;amp; there</description></item>
<item><title>Guid only</title><guid isPermaLink="true">https://a.org/news/guid-only</guid></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><updated>2026-11-02T00:00:00Z</updated>
<entry><title type="html">Export controls &lt;b&gt;tighten&lt;/b&gt;</title><id>tag:a.org,2026:1</id>
<link rel="self" href="https://a.org/atom/1"/><link rel="alternate" href="/news/controls"/><updated>2026-11-02T01:00:00Z</updated><summary>Short summary</summary></entry>
<entry><title>No alternate</title><id>tag:a.org,2026:2</id><link href="https://a.org/news/two"/></entry></feed>`;

const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://a.org/"><title>R</title></channel>
<item rdf:about="https://a.org/rdf/1"><title>RDF one</title><link>https://a.org/rdf/1</link><description>Desc one</description><dc:date>2026-11-02</dc:date></item>
<item><title>RDF two</title><link>rdf/2</link></item></rdf:RDF>`;

const parse = (xml, base) => lib.parseFeedDoc(parseXml(xml), base);
const content = (xml, base = 'https://a.org/feed/') => lib.feedToContent(parse(xml, base));

test('detects feeds by content type and by root element', () => {
  assert.ok(lib.isFeed('application/rss+xml; charset=utf-8', ''));
  assert.ok(lib.isFeed('application/atom+xml', 'garbage'));
  assert.ok(lib.isFeed('text/xml', RSS));
  assert.ok(lib.isFeed('text/html', RSS)); // plain URL that returns a feed
  assert.ok(lib.isFeed('', ATOM));
  assert.ok(lib.isFeed('text/html', '\uFEFF<!-- c --><rdf:RDF xmlns:rdf="x"></rdf:RDF>'));
  assert.ok(!lib.isFeed('text/html', '<!DOCTYPE html><html><body>hi</body></html>'));
  assert.ok(!lib.isFeed('application/xhtml+xml', '<html xmlns="x"><body/></html>'));
  assert.ok(lib.isFeed('application/xml', '<oops')); // xml content type but unreadable: reported as a feed error
  assert.equal(lib.sniffRoot('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><rss/>'), 'rss');
});

test('RSS 2.0: CDATA, HTML in descriptions, relative links, guid permalinks', () => {
  const items = parse(RSS, 'https://a.org/feed/');
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Lithium & rare earths: Lynas expands');
  assert.equal(items[0].link, 'https://a.org/news/lynas');
  assert.equal(items[0].summary, 'Lynas will double output. More soon.');
  assert.equal(items[0].published, 'Mon, 02 Nov 2026 00:00:00 +0000');
  assert.equal(items[1].link, 'https://a.org/files/report.pdf');
  assert.equal(items[1].summary, 'Escaped html here & there');
  assert.equal(items[2].link, 'https://a.org/news/guid-only');
});

test('Atom: alternate link preferred, relative links resolved', () => {
  const items = parse(ATOM, 'https://a.org/atom');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Export controls tighten');
  assert.equal(items[0].link, 'https://a.org/news/controls');
  assert.equal(items[0].id, 'tag:a.org,2026:1');
  assert.equal(items[0].published, '2026-11-02T01:00:00Z');
  assert.equal(items[0].summary, 'Short summary');
  assert.equal(items[1].link, 'https://a.org/news/two');
});

test('RSS 1.0 / RDF', () => {
  const items = parse(RDF, 'https://a.org/index.rdf');
  assert.equal(items.length, 2);
  assert.equal(items[0].summary, 'Desc one');
  assert.equal(items[0].published, '2026-11-02');
  assert.equal(items[1].link, 'https://a.org/rdf/2');
});

test('descriptions are truncated to about 300 chars', () => {
  const xml = `<rss><channel><item><title>T</title><link>https://a.org/1</link><description>${'word '.repeat(200)}</description></item></channel></rss>`;
  const s = parse(xml, 'https://a.org/')[0].summary;
  assert.ok(Array.from(s).length <= lib.MAX_DESC_CHARS && s.endsWith('...'));
});

test('malformed or non-feed XML throws "Feed could not be read"', () => {
  for (const bad of ['<rss><channel><item><title>x</rss>', 'not xml at all', '', '<html><body>hi</body></html>', '<rss><channel></channel></rss>', '<rss></channel></rss>']) {
    assert.throws(() => parse(bad, 'https://a.org/'), { message: lib.FEED_ERROR }, bad);
  }
});

test('content model: titles + descriptions as lines, items as links', () => {
  const c = content(RSS);
  assert.equal(c.links.length, 3);
  assert.deepEqual(c.links[0], { href: 'https://a.org/news/lynas', text: 'Lithium & rare earths: Lynas expands' });
  assert.ok(c.lines.includes('Lynas will double output. More soon.'));
  assert.ok(c.lines.includes('Annual report'));
  assert.ok(c.text.length > 0);
});

const W = { id: 'w', url: 'https://a.org/news', feedUrl: 'https://a.org/feed/', label: 'A' };
const scan = async (xml) => {
  const c = content(xml);
  return { lines: c.lines, links: c.links, hash: await lib.sha256Hex(c.hashSrc) };
};

test('lastBuildDate-only change is not a change; a new item is an event with the item as a new link', async () => {
  const base = lib.processScan(W, { meta: {}, snap: null }, await scan(RSS), 't1');
  assert.equal(base.event, null);
  assert.equal(base.meta.sourceUrl, 'https://a.org/feed/');
  const bumped = await scan(RSS.replace('01:00:00 +0000</lastBuildDate>', '09:30:00 +0000</lastBuildDate>'));
  assert.equal(bumped.hash, base.meta.lastHash);
  assert.equal(lib.processScan(W, base, bumped, 't2').event, null);

  const more = RSS.replace('</channel>', '<item><title>Lynas signs heavy rare earths offtake</title><link>/news/2</link><guid>g2</guid></item><item><title>Brochure</title><link>https://a.org/b.pdf</link><guid>g3</guid></item></channel>');
  const out = lib.processScan(W, base, await scan(more), 't3');
  assert.ok(out.event);
  assert.deepEqual(out.event.newLinks, [{ href: 'https://a.org/news/2', text: 'Lynas signs heavy rare earths offtake' }]);
  assert.equal(out.event.newDocuments.length, 1); // .pdf in a feed is still a document
  assert.equal(out.event.newDocuments[0].ext, 'pdf');
  assert.equal(out.event.url, 'https://a.org/news'); // the event points at the site, not the feed
  assert.equal(out.event.relevance, 'high'); // scoring works on feed titles
});

test('switching the fetched source (page -> feed, or url fix) is a new baseline, not a change', async () => {
  const page = { id: 'w', url: 'https://a.org/news' };
  const pageContent = { lines: ['Old page text that is long enough.'], links: [{ href: 'https://a.org/x', text: 'x' }], hash: 'h-page' };
  const base = lib.processScan(page, { meta: {}, snap: null }, pageContent, 't1');
  assert.equal(base.meta.sourceUrl, 'https://a.org/news');
  const sw = lib.processScan(W, base, await scan(RSS), 't2');
  assert.equal(sw.event, null);
  assert.equal(sw.meta.lastChanged, undefined);
  assert.equal(sw.meta.sourceUrl, 'https://a.org/feed/');
  const again = lib.processScan(W, sw, await scan(RSS.replace('</channel>', '<item><title>Brand new offtake by Lynas</title><link>/n/9</link><guid>g9</guid></item></channel>')), 't3');
  assert.ok(again.event);
  // legacy state without sourceUrl counts as coming from the page url
  const legacy = { meta: { lastHash: 'h-page' }, snap: base.snap };
  assert.ok(lib.processScan(page, legacy, { ...pageContent, hash: 'h2', links: [...pageContent.links, { href: 'https://a.org/y', text: 'new story' }] }, 't4').event);
  assert.equal(lib.processScan(W, legacy, await scan(RSS), 't4').event, null);
  // url fix: same idea
  const moved = lib.processScan({ ...page, url: 'https://a.org/new-news' }, base, pageContent, 't5');
  assert.equal(moved.event, null);
});
