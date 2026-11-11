// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a night-blue gradient, a
// small border router box (antenna, status LEDs) on the left, linked to a
// mesh of round nodes on the right (lines between them, one node amber).
// No logo of any project. Plain Node (zlib), no dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const NIGHT = [10, 20, 40];
const DUSK = [24, 52, 92];
const PANEL = [196, 202, 212];
const PANEL_DARK = [150, 158, 170];
const DARK = [40, 48, 60];
const GREEN = [70, 220, 120];
const AMBER = [250, 176, 40];
const CYAN = [86, 210, 236];
const STEEL = [120, 132, 150];

/** Distance from a point to a rounded rectangle (negative inside). */
function roundedBox(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Distance from a point to a segment. */
function segment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

const ROUTER = { cx: 210, cy: 300 };
const NODES = [
  [470, 150],
  [610, 120],
  [700, 250],
  [560, 280],
  [450, 400],
  [620, 420],
];
const LINKS = [
  [-1, 0],
  [-1, 3],
  [-1, 4],
  [0, 1],
  [0, 3],
  [1, 2],
  [2, 3],
  [3, 4],
  [3, 5],
  [2, 5],
  [4, 5],
];
const at = (i) => (i < 0 ? [ROUTER.cx + 110, ROUTER.cy] : NODES[i]);

function pixel(x, y) {
  let color = mix(NIGHT, DUSK, y / HEIGHT);
  // The mesh: links first, then the nodes.
  let link = Infinity;
  for (const [a, b] of LINKS) link = Math.min(link, segment(x, y, ...at(a), ...at(b)));
  color = mix(color, STEEL, smooth(3, link));
  for (const [i, [cx, cy]] of NODES.entries()) {
    const d = Math.hypot(x - cx, y - cy);
    color = mix(color, i === 2 ? AMBER : CYAN, smooth(30, d));
    color = mix(color, DARK, smooth(14, d));
    color = mix(color, i === 2 ? AMBER : GREEN, smooth(7, d));
  }
  // The border router: a shadow, the box, its LEDs, its antenna.
  color = mix(color, DARK, smooth(0, roundedBox(x, y, ROUTER.cx + 8, ROUTER.cy + 8, 120, 70, 16)));
  color = mix(
    color,
    mix(PANEL, PANEL_DARK, (y - ROUTER.cy + 70) / 140),
    smooth(0, roundedBox(x, y, ROUTER.cx, ROUTER.cy, 120, 70, 16)),
  );
  for (let k = 0; k < 3; k += 1) {
    color = mix(
      color,
      k === 2 ? AMBER : GREEN,
      smooth(7, Math.hypot(x - (150 + k * 40), y - ROUTER.cy - 30)),
    );
  }
  color = mix(color, STEEL, smooth(0, roundedBox(x, y, ROUTER.cx, ROUTER.cy - 10, 80, 8, 4)));
  color = mix(
    color,
    PANEL,
    smooth(5, segment(x, y, ROUTER.cx + 80, ROUTER.cy - 70, ROUTER.cx + 80, ROUTER.cy - 150)),
  );
  color = mix(color, CYAN, smooth(9, Math.hypot(x - ROUTER.cx - 80, y - ROUTER.cy + 156)));
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
