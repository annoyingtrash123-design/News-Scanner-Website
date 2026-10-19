'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let state = { watches: [], events: [], settings: {} };
let chain = Promise.resolve();

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    state = { watches: [], events: [], settings: {}, ...parsed };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not read db.json, starting empty:', e.message);
  }
  return state;
}

/** Atomic write: temp file + rename. Writes are serialized. */
function save() {
  chain = chain.then(async () => {
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.promises.rename(tmp, DB_FILE);
  }).catch((e) => console.error('Failed to save db:', e.message));
  return chain;
}

module.exports = { load, save, get: () => state, DB_FILE };
