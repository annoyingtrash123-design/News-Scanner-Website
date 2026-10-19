'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-test-'));
delete process.env.SMTP_HOST;
process.env.NOTIFY_EMAIL = 'me@example.com';

const dns = require('dns').promises;
const db = require('../src/db');
const { checkWatch } = require('../src/checker');

let page = '<body><ul><li><a href="/a">Alpha</a> First item.</li></ul></body>';
dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
global.fetch = async (url) => {
  if (String(url) === 'https://redirect.test/') return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } });
  return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
};

test('baseline, then change records event and logs email', async () => {
  db.load();
  const w = { id: 't1', url: 'https://site.test/', label: '', selector: '', lastHash: null };
  db.get().watches.push(w);
  const logs = [];
  const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    await checkWatch(w);
    assert.equal(w.lastStatus, 'ok');
    assert.ok(w.lastHash);
    assert.equal(db.get().events.length, 0);
    assert.equal(logs.length, 0, 'no email on baseline');

    await checkWatch(w); // unchanged
    assert.equal(db.get().events.length, 0);

    page = page.replace('</ul>', '<li><a href="/b">Beta</a> Second item.</li></ul>');
    await checkWatch(w);
  } finally { console.log = orig; }
  assert.equal(db.get().events.length, 1);
  assert.match(db.get().events[0].summary, /1 new link/);
  const mail = logs.join('\n');
  assert.match(mail, /Subject: Update detected: site\.test/);
  assert.match(mail, /https:\/\/site\.test\/b/);
  assert.match(mail, /Second item\./);
  assert.ok(fs.existsSync(db.DB_FILE));
});

test('redirect to private address is blocked', async () => {
  const w = { id: 't2', url: 'https://redirect.test/', lastHash: null };
  await checkWatch(w);
  assert.equal(w.lastStatus, 'error');
  assert.match(w.lastError, /not allowed/);
});
