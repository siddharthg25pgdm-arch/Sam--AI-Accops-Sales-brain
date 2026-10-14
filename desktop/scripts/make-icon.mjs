// Run: node desktop/scripts/make-icon.mjs - writes assets/icon.png, icon.ico and tray-live.ico.
// Navy rounded square with a geometric white "S" (two arcs); the live tray variant adds a red dot.
// No external assets: shapes are supersampled here, PNG via zlib, ICO = PNG entries.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const R = 12; // bowl radius in a 100-unit box; the renderer's title-bar mark draws the same path
const ARCS = [{ cx: 50, cy: 38, from: 90, to: 330 }, { cx: 50, cy: 62, from: -90, to: 150 }]; // degrees, y down

function arcDist(x, y, { cx, cy, from, to }) {
  let a = Math.atan2(y - cy, x - cx) * 180 / Math.PI;
  while (a < from) a += 360;
  if (a <= to) return Math.abs(Math.hypot(x - cx, y - cy) - R);
  const end = t => Math.hypot(x - cx - R * Math.cos(t * Math.PI / 180), y - cy - R * Math.sin(t * Math.PI / 180));
  return Math.min(end(from), end(to));
}
function inSquare(x, y, m, r) {
  const q = Math.abs(x - 50) - (50 - m - r), p = Math.abs(y - 50) - (50 - m - r);
  return Math.hypot(Math.max(q, 0), Math.max(p, 0)) + Math.min(Math.max(q, p), 0) <= r;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const TOP = [24, 66, 114], BOTTOM = [11, 37, 69], WHITE = [255, 255, 255], RED = [255, 59, 48];

function render(size, live) {
  const ss = 5, px = Buffer.alloc(size * size * 4);
  const stroke = size <= 24 ? 13 : 10.5, margin = size <= 24 ? 1 : 4; // small tray sizes get a bolder S
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let bg = 0, s = 0, ring = 0, dot = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const u = (x + (i + 0.5) / ss) * 100 / size, v = (y + (j + 0.5) / ss) * 100 / size;
      const d = live ? Math.hypot(u - 79, v - 21) : 99;
      if (d <= 14) dot++;
      else if (d <= 20) ring++;
      else if (inSquare(u, v, margin, 22)) { bg++; if (Math.min(...ARCS.map(a => arcDist(u, v, a))) <= stroke / 2) s++; }
    }
    const n = ss * ss, cover = (bg + ring + dot) / n;
    let c = mix(mix(TOP, BOTTOM, y / size), WHITE, bg ? s / bg : 0);
    if (ring + dot) c = mix(mix(c, WHITE, ring / (bg + ring + dot)), RED, dot / (bg + ring + dot));
    px.set([...c.map(Math.round), Math.round(cover * 255)], (y * size + x) * 4);
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function ico(sizes, live) {
  const imgs = sizes.map(size => ({ size, data: render(size, live) }));
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head[e] = head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += data.length;
  });
  return Buffer.concat([head, ...imgs.map(i => i.data)]);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), render(256, false));
fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 20, 24, 32, 40, 48, 64, 128, 256], false));
fs.writeFileSync(path.join(out, 'tray-live.ico'), ico([16, 20, 24, 32, 40, 48, 64], true));
console.log(`icons written to ${out}`);
