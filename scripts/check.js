'use strict';
const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch { /* optional */ }
const { checkWatch } = require('../src/checker');
const { sendMail, buildChangeEmail } = require('../src/mailer');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const WATCHLIST = path.join(DATA_DIR, 'watchlist.json');
const STATE = path.join(DATA_DIR, 'state.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const watchlist = readJson(WATCHLIST, { notifyEmail: '', watches: [] });
  const watches = Array.isArray(watchlist.watches) ? watchlist.watches : [];
  const state = readJson(STATE, { events: [] });
  if (!Array.isArray(state.events)) state.events = [];
  const only = process.argv[2] || process.env.WATCH_ID || '';
  const to = watchlist.notifyEmail || process.env.NOTIFY_EMAIL || '';

  // Prune state for removed watches (everything except "events" is keyed by watch id).
  const ids = new Set(watches.map((w) => w.id));
  for (const k of Object.keys(state)) if (k !== 'events' && !ids.has(k)) delete state[k];

  const targets = only ? watches.filter((w) => w.id === only) : watches;
  if (only && !targets.length) console.log(`No watch with id ${only}`);
  for (let i = 0; i < targets.length; i++) {
    const w = targets[i];
    const { entry, event, diff } = await checkWatch(w, state[w.id]);
    state[w.id] = entry;
    console.log(`${w.url}: ${entry.lastStatus}${entry.lastError ? ` (${entry.lastError})` : ''}${event ? ` - ${event.summary}` : ''}`);
    if (event) {
      try {
        await sendMail({ to, ...buildChangeEmail({ watch: w, diff, at: event.at }) });
      } catch (e) {
        console.error(`Email failed for ${w.url}: ${e.message}`);
        event.summary += ' (email failed)';
      }
      state.events.unshift(event);
      state.events.length = Math.min(state.events.length, 100);
    }
    if (i < targets.length - 1) await sleep(1500);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
}

main().catch((e) => { console.error(e); }).finally(() => { process.exitCode = 0; });
