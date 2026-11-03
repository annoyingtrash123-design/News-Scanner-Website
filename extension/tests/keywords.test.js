import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOPICS, FOCUS, COMPANIES, KW_VERSION, matchText, scoreEvent, relevanceOf, withScore, needsScore } from '../keywords.js';
import { processScan } from '../lib.js';

const rs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../app/src/keywords.rs'), 'utf8');
const unesc = (s) => s.replace(/\\u\{([0-9a-f]+)\}/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const block = (name) => new RegExp(`pub const ${name}: [^=]*= &\\[([\\s\\S]*?)\\n\\];`).exec(rs)[1];
const strs = (t) => [...t.matchAll(/"([^"]*)"/g)].map((m) => unesc(m[1]));
const pairs = (b) => [...b.matchAll(/\(\s*"([^"]+)",\s*&\[([^\]]*)\]\s*\)/g)].map((m) => [unesc(m[1]), strs(m[2])]);

test('keyword lists are identical in keywords.js and keywords.rs', () => {
  assert.equal(KW_VERSION, Number(/pub const KW_VERSION: u32 = (\d+);/.exec(rs)[1]));
  assert.deepEqual(TOPICS, pairs(block('TOPICS')));
  assert.deepEqual(FOCUS, strs(block('FOCUS')));
  assert.deepEqual(COMPANIES, pairs(block('COMPANIES')));
  assert.equal(TOPICS.length, 15);
  assert.equal(COMPANIES.length, 101);
});

test('lists contain what the briefs ask for', () => {
  assert.deepEqual(TOPICS.map((t) => t[0]), ['Battery minerals', 'Battery chemicals', 'Anodes', 'Cathodes', 'Rare earths', 'Critical minerals',
    'Batteries', 'Magnets', 'Semiconductors', 'Defence', 'Export controls & trade', 'Supply disruptions', 'Corporate events', 'Customs & trade data', 'Macro & policy']);
  const names = COMPANIES.map((c) => c[0]);
  for (const n of ['Covalent Lithium', 'RZ Resources', 'GRAPHINEX', 'HPQ Silicon', 'WIM Resource', 'Wyloo', 'Scandium International Mining Corporation',
    'Gippsland Critical Minerals', 'Tronox', 'M Critical Minerals', 'M Battery Minerals', 'Azure Minerals', 'PowerPlus Energy', 'Sicona',
    'Silica Resources Australia', 'Aspiring Materials', 'Li-S Energy', 'Cobra Resources', 'AE Fuels Corporation']) assert.ok(names.includes(n), n);
  for (const n of ['CATL', 'JL MAG', 'LG Energy Solution', 'Lynas', 'MP Materials', 'JS Link', 'Vacuumschmelze']) assert.ok(names.includes(n), n);
  for (const t of ['Gallium', 'Germanium', 'Antimony', 'Graphite', 'Tungsten', 'LS MnM', 'JS Link', 'LS Eco Energy']) assert.ok(FOCUS.includes(t), t);
  // Chinese, Korean and Japanese terms are present
  const all = TOPICS.flatMap((t) => t[1]);
  for (const t of ['稀土', '희토류', 'レアアース', '出口管制', '수출통제', '輸出規制']) assert.ok(all.includes(t), t);
  // generic words that would fire constantly are deliberately absent
  for (const t of ['Results', 'Earnings', 'Merger', 'Acquisition', 'Subsidy', 'Silicon', 'Sodium']) assert.ok(!all.includes(t), t);
});

const topics = (s) => matchText(s).topics;

test('word boundaries', () => {
  assert.deepEqual(topics('Testing the new pipeline'), []);
  assert.deepEqual(topics('Tin prices rise'), ['Critical minerals']);
  assert.deepEqual(topics('Lithiumville'), []);
  assert.deepEqual(topics('Rare Earths rally'), ['Rare earths']);
  assert.deepEqual(topics('rare-earth supply'), ['Rare earths']);
  assert.deepEqual(topics('Export controls tighten'), ['Export controls & trade']);
});

test('short uppercase acronyms are case-sensitive whole words', () => {
  assert.deepEqual(topics('The camera and cam shaft. Camp opens.'), []);
  assert.deepEqual(topics('CAM supply deal'), ['Battery chemicals']);
  assert.deepEqual(topics('new LFP plant'), ['Battery chemicals']);
  assert.deepEqual(topics('lfp'), []);
  assert.deepEqual(matchText('a gem of a result').companies, []);
  assert.deepEqual(matchText('GEM expands').companies, ['GEM']);
  assert.deepEqual(matchText('BYDs').companies, []);
  assert.deepEqual(matchText('BYD sales').companies, ['BYD']);
  assert.deepEqual(topics('M&A activity picks up'), ['Corporate events']);
});

test('CJK terms match as substrings', () => {
  assert.deepEqual(topics('中国收紧稀土出口管制'), ['Rare earths', 'Export controls & trade']);
  assert.deepEqual(matchText('中国收紧稀土出口管制').focus, ['出口管制']);
  assert.deepEqual(topics('희토류 자석 공급'), ['Rare earths', 'Magnets']);
  assert.deepEqual(topics('ネオジム磁石の輸出規制'), ['Magnets', 'Export controls & trade']);
  assert.deepEqual(matchText('宁德时代CATL签约').companies, ['CATL']);
});

test('company aliases', () => {
  assert.deepEqual(matchText('JLMAG wins order').companies, ['JL MAG']);
  assert.deepEqual(matchText('金力永磁 announces').companies, ['JL MAG']);
  assert.deepEqual(matchText('LGES and SK On').companies, ['LG Energy Solution', 'SK On']);
  assert.deepEqual(matchText('Lynas Rare Earths and MP Materials').companies, ['Lynas', 'MP Materials']);
  assert.deepEqual(matchText('Covalent Lithium update').companies, ['Covalent Lithium']);
  assert.deepEqual(matchText('We ask on Monday').companies, []);
});

test('spans are UTF-16 offsets and merged', () => {
  assert.deepEqual(matchText('稀土 and Rare Earths').spans, [[0, 2], [7, 18]]);
  assert.deepEqual(matchText('\u{1F600} gallium').spans, [[3, 10]]);
});

const L = (text) => ({ href: 'https://x.org/a', text });

test('scoring tiers', () => {
  let s = scoreEvent({ newLinks: [L('Local council approves bike lane')] });
  assert.equal(s.relevance, 'low');
  assert.deepEqual(s.itemMatches, []);
  s = scoreEvent({ newLinks: [L('New copper mine approved')] });
  assert.equal(s.relevance, 'medium');
  assert.deepEqual(s.matchedTopics, ['Critical minerals']);
  s = scoreEvent({ newLinks: [L('Lithium carbonate and sintered magnet outlook')] });
  assert.equal(s.matchedTopics.length, 3);
  assert.equal(s.relevance, 'high');
  s = scoreEvent({ newLinks: [L('China tightens rare earth export controls')] });
  assert.equal(s.relevance, 'high');
  assert.deepEqual(s.matchedFocus, ['Rare-Earth Export Controls']);
  s = scoreEvent({ addedText: ['JS Link signs magnet supply deal'] });
  assert.equal(s.relevance, 'high');
  assert.ok(s.matchedCompanies.includes('JS Link') && s.matchedFocus.includes('JS Link'));
  s = scoreEvent({ newDocuments: [{ href: 'https://x.org/a.pdf', text: 'Quarterly graphite report', ext: 'pdf' }], newLinks: [L('nothing'), L('Cobalt update')] });
  assert.equal(s.relevance, 'high');
  assert.deepEqual(s.itemMatches.map((m) => [m.kind, m.index]), [['doc', 0], ['link', 1]]);
  assert.equal(relevanceOf(0, 0, 0), 'low');
  assert.equal(relevanceOf(2, 0, 0), 'medium');
  assert.equal(relevanceOf(3, 0, 0), 'high');
  assert.equal(relevanceOf(0, 1, 0), 'high');
  s = scoreEvent({ newLinks: [L('Chinese export controls on gallium')] });
  assert.deepEqual(s.matchedFocus, ['Chinese Export Controls', 'Gallium']);
});

test('stored events without scores are detected and scored on the fly', () => {
  const old = { watchId: 'w', at: 't', newLinks: [L('Rare earth magnet plant opens')] };
  assert.ok(needsScore(old));
  const sc = withScore(old);
  assert.ok(!needsScore(sc));
  assert.ok(['medium', 'high'].includes(sc.relevance));
});

test('new events are scored when created', () => {
  const w = { id: 'w1', url: 'https://a.org/news', label: 'A', documentsOnly: false };
  const base = processScan(w, {}, { lines: ['Hello world, a long enough line.'], links: [], hash: 'h1' }, 't1');
  const content = { lines: ['Hello world, a long enough line.'], links: [{ href: 'https://a.org/n/1', text: 'China tightens rare earth export controls' }, { href: 'https://a.org/n/2', text: 'Local council approves bike lane' }], hash: 'h2' };
  const out = processScan(w, { meta: base.meta, snap: base.snap }, content, 't2');
  assert.equal(out.event.relevance, 'high');
  assert.equal(out.event.kwVersion, KW_VERSION);
  assert.deepEqual(out.event.itemMatches.filter((m) => m.kind === 'link').map((m) => m.index), [0]);
});
