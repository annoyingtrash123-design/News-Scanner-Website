'use strict';
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./src/db');
const { validateUrl, normalizeText } = require('./src/lib');
const { checkWatch, startScheduler, getNotifyEmail, newId } = require('./src/checker');
const { sendMail } = require('./src/mailer');

db.load();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));

// ---- Auth (optional) ----
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('ns:' + APP_PASSWORD).digest('hex');
const COOKIE = 'ns_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function makeToken() { const exp = String(Date.now() + SESSION_MS); return `${exp}.${sign(exp)}`; }
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  return Boolean(exp && sig && safeEq(sig, sign(exp)) && Number(exp) > Date.now());
}
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
const authed = (req) => !APP_PASSWORD || validToken(getCookie(req, COOKIE));
const cookieOpts = (req, maxAge) =>
  `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${(req.secure || req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : ''}`;

let failures = [];
app.get('/api/session', (req, res) => res.json({ authRequired: Boolean(APP_PASSWORD), authenticated: authed(req) }));
app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  const now = Date.now();
  failures = failures.filter((t) => now - t < 60000);
  if (failures.length >= 10) return res.status(429).json({ error: 'Too many attempts, try again in a minute' });
  const pw = String((req.body || {}).password || '');
  if (!safeEq(sign(pw), sign(APP_PASSWORD))) { failures.push(now); return res.status(401).json({ error: 'Wrong password' }); }
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken())}${cookieOpts(req, SESSION_MS / 1000)}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=${cookieOpts(req, 0)}`);
  res.json({ ok: true });
});
app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'Login required' })));

// ---- API ----
const publicWatch = ({ snapshot, ...w }) => w;
const find = (id) => db.get().watches.find((w) => w.id === id);

app.get('/api/watches', (req, res) => res.json(db.get().watches.map(publicWatch)));

app.post('/api/watches', async (req, res) => {
  const { url, label, selector } = req.body || {};
  const v = validateUrl(url);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const sel = normalizeText(selector).slice(0, 300);
  const lab = normalizeText(label).slice(0, 100);
  if (db.get().watches.some((w) => w.url === v.url && (w.selector || '') === sel)) {
    return res.status(409).json({ error: 'Already watching that URL' });
  }
  const watch = {
    id: newId(), url: v.url, label: lab, selector: sel, createdAt: new Date().toISOString(),
    lastChecked: null, lastChanged: null, lastHash: null, lastStatus: null, lastError: null, lastSnippet: null,
  };
  db.get().watches.push(watch);
  await db.save();
  await checkWatch(watch); // baseline
  res.status(201).json(publicWatch(watch));
});

app.delete('/api/watches/:id', async (req, res) => {
  const s = db.get();
  const i = s.watches.findIndex((w) => w.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  s.watches.splice(i, 1);
  await db.save();
  res.json({ ok: true });
});

app.post('/api/watches/:id/check', async (req, res) => {
  const w = find(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  await checkWatch(w);
  res.json(publicWatch(w));
});

app.get('/api/events', (req, res) => res.json(db.get().events));

app.get('/api/settings', (req, res) => res.json({ notifyEmail: getNotifyEmail() }));
app.put('/api/settings', async (req, res) => {
  const email = String((req.body || {}).notifyEmail || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  db.get().settings.notifyEmail = email;
  await db.save();
  res.json({ notifyEmail: getNotifyEmail() });
});

app.post('/api/test-email', async (req, res) => {
  try {
    const to = getNotifyEmail();
    const r = await sendMail({ to, subject: 'News Scanner test email', text: 'This is a test email from News Scanner. Notifications are working.', html: '<p>This is a test email from <b>News Scanner</b>. Notifications are working.</p>' });
    res.json({ ok: true, to, logged: Boolean(r.logged) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Server error' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`News Scanner running on http://localhost:${PORT}${APP_PASSWORD ? ' (password protected)' : ' (no APP_PASSWORD set: open access)'}`);
  startScheduler();
});
