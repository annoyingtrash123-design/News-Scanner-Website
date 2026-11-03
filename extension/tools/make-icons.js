// Generates icons/icon{16,32,48,128}.png: accent rounded square with a white "N". Node built-ins only.
// Usage: node tools/make-icons.js
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ACCENT = [0x25, 0x63, 0xeb];
const SS = 4; // supersampling per axis

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Shapes in unit coordinates (0..1).
function inRoundedSquare(x, y) {
  const r = 0.22, m = 0.02;
  const cx = Math.min(Math.max(x, m + r), 1 - m - r), cy = Math.min(Math.max(y, m + r), 1 - m - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inN(x, y) {
  const left = 0.27, right = 0.73, top = 0.25, bot = 0.75, bar = 0.12;
  if (y < top || y > bot) return false;
  if (x >= left && x <= left + bar) return true;
  if (x >= right - bar && x <= right) return true;
  // diagonal from top-left to bottom-right
  const t = (y - top) / (bot - top);
  const dx0 = left + t * (right - bar - left);
  return x >= dx0 && x <= dx0 + bar * 1.05;
}

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
        if (inRoundedSquare(x, y)) { bg++; if (inN(x, y)) fg++; }
      }
      const total = SS * SS;
      const a = bg / total;
      const w = bg ? fg / bg : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(ACCENT[c] * (1 - w) + 255 * w);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(dir, { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(join(dir, `icon${s}.png`), render(s));
console.log('icons written to', dir);
