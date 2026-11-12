import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULTS, CATEGORIES, DEFAULT_FEEDS, DEFAULT_URL_FIXES } from '../defaults.js';
import { seedFrom, validateUrl, migrateDefaults } from '../lib.js';

const rs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../app/src/defaults.rs'), 'utf8');
const unesc = (s) => s.replace(/\\u\{([0-9a-f]+)\}/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

const cats = {};
for (const m of rs.matchAll(/pub const (\w+): &str = "([^"]*)";/g)) cats[m[1]] = unesc(m[2]);
const rows = [...rs.matchAll(/^\s*\("([^"]+)", "([^"]*)", "([^"]*)", (\w+)\),$/gm)]
  .map((m) => ({ id: m[1], label: unesc(m[2]), url: m[3], category: cats[m[4]] }));
const catList = /CATEGORIES: \[&str; \d+\] = \[([^\]]*)\]/.exec(rs)[1].split(',').map((s) => cats[s.trim()]);

test('defaults.js matches app/src/defaults.rs exactly', () => {
  assert.equal(rows.length, 181);
  assert.deepEqual(CATEGORIES, catList);
  assert.deepEqual(DEFAULTS, rows);
});

test('defaults are valid and unique', () => {
  const ids = new Set(), urls = new Set();
  for (const d of DEFAULTS) {
    assert.ok(!ids.has(d.id), `dup id ${d.id}`); ids.add(d.id);
    assert.ok(d.label && CATEGORIES.includes(d.category));
    const u = validateUrl(d.url);
    assert.ok(!urls.has(u), `dup url ${d.url}`); urls.add(u);
  }
  const n = (c) => DEFAULTS.filter((d) => d.category === c).length;
  assert.deepEqual(CATEGORIES.slice(0, 5).map(n), [6, 7, 6, 2, 19]);
});

test('seeds once; removed defaults stay removed; reset brings them back', () => {
  const d = { watches: [], seededDefaults: [] };
  assert.equal(seedFrom(DEFAULTS, d, 't').length, DEFAULTS.length);
  const gone = d.watches.splice(3, 1)[0].id;
  assert.deepEqual(seedFrom(DEFAULTS, d, 't2'), []);
  d.seededDefaults = [];
  assert.deepEqual(seedFrom(DEFAULTS, d, 't3'), [gone]);
  assert.equal(d.watches.length, DEFAULTS.length);
});

test('new defaults reach existing users and URLs are deduped', () => {
  const list = [{ id: 'a', label: 'A', url: 'https://a.org/x', category: 'Other' }, { id: 'b', label: 'B', url: 'https://b.org/y', category: 'Other' }];
  const d = { watches: [{ id: 'mine', url: 'https://a.org/x', label: 'mine', category: '' }], seededDefaults: [] };
  assert.deepEqual(seedFrom(list.slice(0, 1), d, 't'), []);
  assert.equal(d.watches.length, 1);
  assert.deepEqual(d.seededDefaults, ['a']);
  assert.deepEqual(seedFrom(list, d, 't'), ['b']);
  assert.equal(d.watches[1].id, 'b');
});

test('category backfill', () => {
  const d = { watches: [], seededDefaults: [] };
  seedFrom(DEFAULTS, d, 't');
  d.watches[0].category = '';
  seedFrom(DEFAULTS, d, 't');
  assert.equal(d.watches[0].category, DEFAULTS[0].category);
});

// ---------- DEFAULT_FEEDS / DEFAULT_URL_FIXES ----------

const pairs = (name) => {
  const block = new RegExp(`pub const ${name}: &\\[\\(&str, &str\\)\\] = &\\[([\\s\\S]*?)\\n\\];`).exec(rs)[1];
  return Object.fromEntries([...block.matchAll(/^\s*\("([^"]+)", "([^"]+)"\),$/gm)].map((m) => [m[1], m[2]]));
};

test('DEFAULT_FEEDS and DEFAULT_URL_FIXES match app/src/defaults.rs', () => {
  assert.deepEqual(DEFAULT_FEEDS, pairs('DEFAULT_FEEDS'));
  assert.deepEqual(DEFAULT_URL_FIXES, pairs('DEFAULT_URL_FIXES'));
  assert.equal(Object.keys(DEFAULT_FEEDS).length, 11);
  for (const [id, f] of Object.entries({ ...DEFAULT_FEEDS, ...DEFAULT_URL_FIXES })) {
    assert.ok(DEFAULTS.some((d) => d.id === id), `unknown id ${id}`);
    validateUrl(f);
  }
  const ft = DEFAULTS.find((d) => d.id === 'ft-commodities');
  assert.equal(ft.url, 'https://www.ft.com/commodities'); // DEFAULTS themselves are untouched
  assert.equal(DEFAULTS.find((d) => d.id === 'usa-rare-earth').url, 'https://investors.usare.com/news-events/press-releases');
});

test('seeding applies built-in feeds', () => {
  const d = { watches: [], seededDefaults: [] };
  seedFrom(DEFAULTS, d, 't', DEFAULT_FEEDS);
  assert.equal(d.watches.filter((w) => w.feedUrl).length, 11);
  assert.equal(d.watches.find((w) => w.id === 'lynas').feedUrl, 'https://lynasrareearths.com/feed/');
  assert.equal(d.watches.find((w) => w.id === 'lynas').url, 'https://lynasrareearths.com/');
  assert.equal(d.watches.find((w) => w.id === 'mnr').feedUrl, undefined);
});

const watchOf = (id) => { const d = DEFAULTS.find((x) => x.id === id); return { id, url: validateUrl(d.url), label: d.label, category: d.category }; };

test('migration sets feeds on existing watches but keeps a user-set feed', () => {
  const data = { watches: [watchOf('lynas'), { ...watchOf('solvay'), feedUrl: 'https://my.example.org/s.xml' }, watchOf('mnr')] };
  assert.equal(migrateDefaults(DEFAULTS, data, DEFAULT_FEEDS, DEFAULT_URL_FIXES), 1);
  assert.equal(data.watches[0].feedUrl, 'https://lynasrareearths.com/feed/');
  assert.equal(data.watches[1].feedUrl, 'https://my.example.org/s.xml');
  assert.equal(data.watches[2].feedUrl, undefined);
  assert.equal(migrateDefaults(DEFAULTS, data, DEFAULT_FEEDS, DEFAULT_URL_FIXES), 0);
});

test('url fix applies only while the stored url is still the old default', () => {
  const next = 'https://investors.usare.com/news-events/news-releases';
  let data = { watches: [watchOf('usa-rare-earth')] };
  assert.equal(migrateDefaults(DEFAULTS, data, DEFAULT_FEEDS, DEFAULT_URL_FIXES), 1);
  assert.equal(data.watches[0].url, next);
  data = { watches: [{ ...watchOf('usa-rare-earth'), url: 'https://investors.usare.com/custom' }] };
  assert.equal(migrateDefaults(DEFAULTS, data, DEFAULT_FEEDS, DEFAULT_URL_FIXES), 0);
  assert.equal(data.watches[0].url, 'https://investors.usare.com/custom');
  data = { watches: [watchOf('usa-rare-earth'), { id: 'mine', url: next }] };
  assert.equal(migrateDefaults(DEFAULTS, data, DEFAULT_FEEDS, DEFAULT_URL_FIXES), 0); // no duplicate url
});
