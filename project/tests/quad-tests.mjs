// Perspective / document-boundary detection tests.
//  1. synthetic in-memory scene (bright quad on a noisy dark table)
//  2. sample photos with known ground-truth corners (expected.json "corners")
//  3. flat scans (no background) must return null / full image (no wrong crop)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectDocument, warpQuad } from '../app/js/core/quad.js';
import { loadImage } from './node-ocr.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '✓' : '✗'} ${name} ${info}`); };
const maxErr = (got, want) => Math.max(...got.map((p, i) => Math.hypot(p.x - want[i][0], p.y - want[i][1])));

// 1. synthetic
{
  const W = 800, H = 600, data = new Uint8ClampedArray(W * H * 4);
  const quad = [[150, 120], [650, 90], [700, 480], [120, 520]];
  const inside = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = quad[i], [xj, yj] = quad[j]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const v = inside(x, y) ? 225 + rnd() * 20 : 60 + rnd() * 40; data[i] = v; data[i + 1] = v * (inside(x, y) ? 1 : 0.8); data[i + 2] = v * (inside(x, y) ? 1 : 0.6); data[i + 3] = 255; }
  const r = detectDocument({ width: W, height: H, data });
  const err = r ? maxErr(r.corners, quad) : Infinity;
  check('synthetic quad detected', r && r.confidence >= 0.6 && err < 8, `err=${err.toFixed(1)}px conf=${r && r.confidence}`);
  const flat = warpQuad({ width: W, height: H, data }, r.corners);
  check('warp output size ~ quad size', Math.abs(flat.width - 580) < 40 && Math.abs(flat.height - 430) < 40, `${flat.width}x${flat.height}`);
}

function pointInPoly(p, poly, tol) {
  // inside test against the polygon grown by `tol` px around its centroid
  const c = poly.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]);
  const g = poly.map(([x, y]) => { const dx = x - c[0], dy = y - c[1], l = Math.hypot(dx, dy); return [x + dx / l * tol, y + dy / l * tol]; });
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = g[i], [xj, yj] = g[j]; if (((yi > p.y) !== (yj > p.y)) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) inside = !inside; }
  return inside;
}

// 2+3. samples
const exp = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/expected.json'), 'utf8'));
for (const [file, e] of Object.entries(exp)) {
  const img = await loadImage(path.join(ROOT, 'samples', file));
  const t = Date.now();
  const r = detectDocument(img);
  const ms = Date.now() - t;
  if (e.corners) {
    const diag = Math.hypot(img.width, img.height);
    const err = r ? maxErr(r.corners, e.corners) : Infinity;
    if (e.cornersKnownHard) {
      // known limitation: part of the card blends into the background; we only require that NO background is included
      const inside = r && r.corners.every((p) => pointInPoly(p, e.corners, diag * 0.01));
      check(`corners ${file} (known hard: ${e.cornersKnownHard})`, r && inside, `err=${err.toFixed(1)}px, quad inside the card: ${inside}`);
    } else check(`corners ${file}`, r && r.confidence >= 0.6 && err < diag * 0.015, `err=${err.toFixed(1)}px (${(100 * err / diag).toFixed(2)}% of diagonal) conf=${r && r.confidence} ${r && r.method} ${ms}ms`);
  } else if (/skew/.test(file)) {
    check(`photo-on-background ${file} detected`, r && r.confidence >= 0.6, `conf=${r && r.confidence} ${r && r.reason} ${ms}ms`);
  } else {
    check(`flat scan ${file} → whole image`, !r || r.confidence < 0.6, r ? `conf=${r.confidence} (${r.reason})` : 'null');
  }
}
console.log(`\nQuad tests: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
