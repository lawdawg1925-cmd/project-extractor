// Automatic document boundary detection + perspective correction (pure JS, no OpenCV).
//
// Idea: the table/background is what touches the photo's border. We learn its colours from a
// thin frame around the image (k-means), classify every pixel as "background-like" (allowing for
// shadows/darker lighting of the same colour), keep the largest remaining blob (the document),
// fill its holes, take the convex hull and simplify it to the best 4-corner polygon.
// The result is scored (solidity, size, corner angles, edge strength); if it is not confident we
// return null and the caller uses the whole image.
import { resize } from './image.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Order 4 points as TL, TR, BR, BL. */
export function orderCorners(pts) {
  const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  const s = pts.slice().sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // s is clockwise starting from the left-ish point (atan2 from -PI); rotate so TL (min x+y) is first
  let k = 0; for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[k].x + s[k].y) k = i;
  return [0, 1, 2, 3].map((i) => s[(k + i) % 4]);
}

function kmeans(samples, k, iters = 8) {
  const n = samples.length / 3;
  const cent = [];
  for (let i = 0; i < k; i++) { const j = Math.floor(((i + 0.5) / k) * n); cent.push([samples[j * 3], samples[j * 3 + 1], samples[j * 3 + 2]]); }
  const lab = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const dr = samples[i * 3] - cent[c][0], dg = samples[i * 3 + 1] - cent[c][1], db = samples[i * 3 + 2] - cent[c][2]; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = c; } }
      lab[i] = best; const s = sum[best]; s[0] += samples[i * 3]; s[1] += samples[i * 3 + 1]; s[2] += samples[i * 3 + 2]; s[3]++;
    }
    for (let c = 0; c < k; c++) if (sum[c][3]) cent[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  return { cent, lab };
}

// distance of pixel p to colour c allowing brightness scaling s∈[0.3,1.12] (shadows, uneven light)
function shadeDist(r, g, b, c) {
  const cc = c[0] * c[0] + c[1] * c[1] + c[2] * c[2] + 1;
  const s = clamp((r * c[0] + g * c[1] + b * c[2]) / cc, 0.3, 1.12);
  const dr = r - s * c[0], dg = g - s * c[1], db = b - s * c[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function morph(mask, w, h, r, dilate) {
  // separable square min/max filter
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= w) { if (!dilate) { v = 0; break; } continue; } const m = mask[y * w + xx]; if (dilate ? m : !m) { v = dilate ? 1 : 0; break; } }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= h) { if (!dilate) { v = 0; break; } continue; } const m = tmp[yy * w + x]; if (dilate ? m : !m) { v = dilate ? 1 : 0; break; } }
    out[y * w + x] = v;
  }
  return out;
}

function largestComponent(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    let sp = 0, size = 0; stack[sp++] = i; lab[i] = id;
    while (sp) {
      const p = stack[--sp]; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = lab[i] === best ? 1 : 0;
  return { mask: out, size: bestSize };
}

function fillHoles(mask, w, h) {
  // background = zeros reachable from the border; everything else is the object
  const reach = new Uint8Array(w * h), stack = [];
  const push = (i) => { if (!mask[i] && !reach[i]) { reach[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h); let n = 0;
  for (let i = 0; i < w * h; i++) if (!reach[i]) { out[i] = 1; n++; }
  return { mask: out, size: n };
}

function convexHull(pts) {
  pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function polyArea(p) {
  let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return Math.abs(a) / 2;
}

/** Reduce a convex polygon to 4 vertices. Each step removes the vertex whose removal changes the area least,
 *  then the 4 corners are refined by intersecting lines fitted to the hull edges between them. */
function hullToQuad(hull) {
  let p = hull.slice();
  while (p.length > 4) {
    let bi = 0, ba = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const ar = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
      if (ar < ba) { ba = ar; bi = i; }
    }
    p.splice(bi, 1);
  }
  return p.length === 4 ? p : null;
}

/** Fit a straight line to the boundary points of each side (ignoring the 15% near each corner, where
 *  rounded card corners / glare eat into the shape) and intersect neighbouring lines → precise corners. */
function refineByLines(q, pts) {
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 10) return null;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const band = Math.max(3, L * 0.03);
    const sel = [];
    for (const p of pts) {
      const t = (p.x - a.x) * ux + (p.y - a.y) * uy, dn = Math.abs(-(p.x - a.x) * uy + (p.y - a.y) * ux);
      if (t > L * 0.15 && t < L * 0.85 && dn < band) sel.push(p);
    }
    if (sel.length < 8) return null;
    // total least squares line through the selected points
    let mx = 0, my = 0; for (const p of sel) { mx += p.x; my += p.y; } mx /= sel.length; my /= sel.length;
    let sxx = 0, syy = 0, sxy = 0; for (const p of sel) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({ px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang) });
  }
  const out = [];
  for (let i = 0; i < 4; i++) {
    const l1 = lines[(i + 3) % 4], l2 = lines[i];
    const den = l1.dx * l2.dy - l1.dy * l2.dx; if (Math.abs(den) < 1e-6) return null;
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    const p = { x: l1.px + t * l1.dx, y: l1.py + t * l1.dy };
    if (Math.hypot(p.x - q[i].x, p.y - q[i].y) > 0.15 * Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y)) return null;
    out.push(p);
  }
  return out;
}

function cornerAnglesOk(q) {
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) + 1e-9);
    const ang = Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;
    if (ang < 50 || ang > 130) return false;
  }
  return true;
}

/**
 * Detect the document's 4 corners. Returns { corners:[TL,TR,BR,BL] in image px, confidence 0..1, reason } or null.
 */
export function detectDocument(img, { analysisSize = 520 } = {}) {
  const f = analysisSize / Math.max(img.width, img.height);
  const small = f < 1 ? resize(img, img.width * f, img.height * f) : img;
  const sc = small.width / img.width;
  const a = byBackgroundColour(small);
  let best = a;
  if (!a || a.confidence < 0.6) {
    // Strategy B: document separated by its own outline (e.g. a card lying on a sheet of white paper)
    const b = byEdges(small);
    if (b && (!best || b.confidence > best.confidence)) best = b;
  }
  if (!best) return null;
  if (best.confidence >= 0.6) {
    const snapped = snapSides(small, best.corners);
    if (snapped) { best.corners = snapped.corners; best.snapped = snapped.moved; }
  }
  best.corners = best.corners.map((p) => ({ x: clamp(p.x / sc, 0, img.width), y: clamp(p.y / sc, 0, img.height) }));
  return best;
}

/** Directional colour gradient (Sobel on a 3x3 box-blurred copy) used to score candidate document sides. */
function gradients(small) {
  const w = small.width, h = small.height, d = small.data;
  const bl = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let s = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += d[(yy * w + xx) * 4 + c]; k++;
    }
    bl[(y * w + x) * 3 + c] = s / k;
  }
  const gx = new Float32Array(w * h * 3), gy = new Float32Array(w * h * 3);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) {
    const g = (dx, dy) => bl[((y + dy) * w + (x + dx)) * 3 + c];
    const i = (y * w + x) * 3 + c;
    gx[i] = (g(1, -1) + 2 * g(1, 0) + g(1, 1) - g(-1, -1) - 2 * g(-1, 0) - g(-1, 1)) / 8;
    gy[i] = (g(-1, 1) + 2 * g(0, 1) + g(1, 1) - g(-1, -1) - 2 * g(0, -1) - g(1, -1)) / 8;
  }
  return { w, h, gx, gy };
}
/** Edge support of segment a→b: mean over its middle 80% of the colour gradient across the segment. */
function sideScore(G, a, b) {
  const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 10) return 0;
  const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
  // signed sum per channel: a real document edge has the same contrast direction along its whole length,
  // texture and clutter do not (they cancel out)
  const acc = [0, 0, 0]; let k = 0;
  for (let t = 0.1; t <= 0.9; t += 1 / L) {
    const x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
    k++;
    if (x < 1 || y < 1 || x >= G.w - 1 || y >= G.h - 1) continue;
    const i = (y * G.w + x) * 3;
    for (let c = 0; c < 3; c++) acc[c] += Math.max(-40, Math.min(40, G.gx[i + c] * nx + G.gy[i + c] * ny));
  }
  return k ? Math.max(...acc.map(Math.abs)) / k : 0;
}
/**
 * The detected region can stop short of the real card edge (e.g. a hologram or a bright hand next to a white
 * card). Each side is moved outward (each end independently, so its angle can change) to the straight line
 * with the strongest edge support; a side only moves if that line is clearly stronger than where it was.
 */
function snapSides(small, corners) {
  const G = gradients(small);
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4, cy = corners.reduce((s, p) => s + p.y, 0) / 4;
  const size = Math.max(small.width, small.height);
  const maxOut = Math.round(size * 0.2), maxIn = Math.round(size * 0.02), step = Math.max(1, Math.round(size / 260));
  const lines = []; let moved = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    let nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; } // outward normal
    // extend the segment a little so a clipped side can still reach the full edge
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const A0 = { x: a.x - ux * L * 0.05, y: a.y - uy * L * 0.05 }, B0 = { x: b.x + ux * L * 0.05, y: b.y + uy * L * 0.05 };
    const base = sideScore(G, A0, B0);
    let best = { s: base, da: 0, db: 0 };
    for (let da = -maxIn; da <= maxOut; da += step) for (let db = -maxIn; db <= maxOut; db += step) {
      if (Math.abs(da - db) > size * 0.12) continue;
      const s = sideScore(G, { x: A0.x + nx * da, y: A0.y + ny * da }, { x: B0.x + nx * db, y: B0.y + ny * db });
      if (s > best.s) best = { s, da, db };
    }
    let da = 0, db = 0;
    if (best.s > base * 1.25 + 1 && (best.da || best.db)) { da = best.da; db = best.db; moved++; }
    const p1 = { x: A0.x + nx * da, y: A0.y + ny * da }, p2 = { x: B0.x + nx * db, y: B0.y + ny * db };
    lines.push({ px: p1.x, py: p1.y, dx: p2.x - p1.x, dy: p2.y - p1.y });
  }
  if (!moved) return null;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const l1 = lines[(i + 3) % 4], l2 = lines[i];
    const den = l1.dx * l2.dy - l1.dy * l2.dx; if (Math.abs(den) < 1e-6) return null;
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    out.push({ x: clamp(l1.px + t * l1.dx, 0, small.width - 1), y: clamp(l1.py + t * l1.dy, 0, small.height - 1) });
  }
  if (!cornerAnglesOk(out) || polyArea(out) < polyArea(corners) * 0.9) return null;
  return { corners: out, moved };
}

/** Turn an object mask into a scored quad. */
function maskToQuad(objMask, w, h, method) {
  let size = 0;
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!objMask[i]) continue; size++;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !objMask[i - 1] || !objMask[i + 1] || !objMask[i - w] || !objMask[i + w]) pts.push({ x: x + 0.5, y: y + 0.5 });
  }
  if (pts.length < 20) return null;
  const quad = hullToQuad(convexHull(pts));
  if (!quad) return null;
  const ordered = refineByLines(orderCorners(quad), pts) || orderCorners(quad);
  const qa = polyArea(ordered), frac = qa / (w * h);
  const solidity = size / Math.max(1, qa);
  const touches = ordered.filter((p) => p.x < 2 || p.y < 2 || p.x > w - 3 || p.y > h - 3).length;
  let conf = 1;
  const reasons = [];
  if (frac > 0.96) { conf = 0; reasons.push('fills whole photo'); }
  if (frac < 0.08) { conf = 0; reasons.push('too small'); }
  if (solidity < 0.85) { conf *= clamp((solidity - 0.7) / 0.15, 0, 1); reasons.push(`solidity ${solidity.toFixed(2)}`); }
  if (solidity > 1.08) { conf *= 0.5; reasons.push('quad smaller than shape'); }
  if (!cornerAnglesOk(ordered)) { conf *= 0.3; reasons.push('odd angles'); }
  if (touches >= 2) { conf *= 0.6; reasons.push('touches photo edge'); }
  return { corners: ordered, confidence: +conf.toFixed(2), solidity: +solidity.toFixed(3), areaFrac: +frac.toFixed(3), method, reason: reasons.join(', ') || 'ok' };
}

function byEdges(small) {
  const w = small.width, h = small.height, d = small.data;
  // gradient magnitude (max over R,G,B of a Sobel operator)
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const g = (dx, dy) => d[((y + dy) * w + (x + dx)) * 4 + c];
      const gx = g(1, -1) + 2 * g(1, 0) + g(1, 1) - g(-1, -1) - 2 * g(-1, 0) - g(-1, 1);
      const gy = g(-1, 1) + 2 * g(0, 1) + g(1, 1) - g(-1, -1) - 2 * g(0, -1) - g(1, -1);
      m = Math.max(m, Math.abs(gx) + Math.abs(gy));
    }
    mag[y * w + x] = m;
  }
  const sorted = Float32Array.from(mag).sort();
  const thr = Math.max(60, sorted[Math.floor(sorted.length * 0.8)]);
  let edge = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) edge[i] = mag[i] > thr ? 1 : 0;
  edge = morph(edge, w, h, 1, true);
  // connected regions of NON-edge pixels that do not touch the photo border = enclosed shapes
  const free = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) free[i] = edge[i] ? 0 : 1;
  const lab = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h);
  let best = null, id = 0;
  for (let i0 = 0; i0 < w * h; i0++) {
    if (!free[i0] || lab[i0] >= 0) continue;
    let sp = 0, size = 0, border = false; stack[sp++] = i0; lab[i0] = id;
    const members = [];
    while (sp) {
      const p = stack[--sp]; size++; members.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && free[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && free[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && free[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && free[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    id++;
    if (border || size < w * h * 0.15) continue;
    const m = new Uint8Array(w * h); for (const p of members) m[p] = 1;
    const filled = fillHoles(morph(m, w, h, 2, true), w, h).mask;
    const q = maskToQuad(filled, w, h, 'edges');
    // an inner frame/outline close to the photo border on 3+ sides = a flat scan, not a photo of a document
    if (q) {
      const m = 0.035;
      const sides = [Math.min(q.corners[0].y, q.corners[1].y) < h * m, Math.max(q.corners[1].x, q.corners[2].x) > w * (1 - m),
        Math.max(q.corners[2].y, q.corners[3].y) > h * (1 - m), Math.min(q.corners[0].x, q.corners[3].x) < w * m];
      if (sides.filter(Boolean).length >= 3 || q.areaFrac > 0.85) { q.confidence = 0; q.reason = 'inner frame of a flat scan'; }
    }
    if (q && (!best || q.confidence * Math.sqrt(q.areaFrac) > best.confidence * Math.sqrt(best.areaFrac))) best = q;
  }
  return best;
}

function byBackgroundColour(small) {
  const w = small.width, h = small.height, d = small.data;
  // 1. background colours from a frame 3% wide around the photo
  const bw = Math.max(3, Math.round(Math.min(w, h) * 0.03));
  const samp = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= bw && x < w - bw && y >= bw && y < h - bw) continue;
    if ((x + y) % 2) continue;
    const i = (y * w + x) * 4; samp.push(d[i], d[i + 1], d[i + 2]);
  }
  const K = 5;
  const { cent, lab } = kmeans(Float32Array.from(samp), K);
  const n = samp.length / 3;
  // per-cluster tolerance from its own spread
  const spread = cent.map(() => [0, 0]);
  for (let i = 0; i < n; i++) { const c = lab[i]; spread[c][0] += shadeDist(samp[i * 3], samp[i * 3 + 1], samp[i * 3 + 2], cent[c]) ** 2; spread[c][1]++; }
  const tol = spread.map(([s, k]) => clamp(3 * Math.sqrt(s / Math.max(1, k)), 22, 70));
  const used = spread.map(([, k]) => k > n * 0.02);
  // 2. foreground = not like any background colour
  let fg = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    let isBg = false;
    for (let c = 0; c < K && !isBg; c++) if (used[c] && shadeDist(d[p], d[p + 1], d[p + 2], cent[c]) < tol[c]) isBg = true;
    fg[i] = isBg ? 0 : 1;
  }
  // 3. clean up: remove thin lines/noise, keep the biggest blob, fill holes (text, photo, glare)
  const r = Math.max(2, Math.round(Math.min(w, h) / 160));
  fg = morph(morph(fg, w, h, r, false), w, h, r, true);
  const comp = largestComponent(fg, w, h);
  if (comp.size < w * h * 0.06) return null;
  let obj = fillHoles(morph(comp.mask, w, h, r, true), w, h);
  obj = { mask: morph(obj.mask, w, h, r, false), size: 0 };
  return maskToQuad(obj.mask, w, h, 'background');
}

/** Solve the 3x3 homography H mapping src[i] → dst[i] (4 point pairs). */
export function homography(src, dst) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  // Gaussian elimination
  for (let c = 0; c < 8; c++) {
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  const hh = B.map((b, i) => b / A[i][i]);
  return [hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], 1];
}

/** Warp the quadrilateral `corners` (TL,TR,BR,BL) of img into a flat rectangle. */
export function warpQuad(img, corners, { maxSide = 2400 } = {}) {
  const [tl, tr, br, bl] = corners;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.max(dist(tl, tr), dist(bl, br)), H = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(10, Math.round(W * s)); H = Math.max(10, Math.round(H * s));
  const Hm = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], corners); // dst → src
  const out = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const sw = img.width, sh = img.height, sd = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const X = x + 0.5, Y = y + 0.5;
      const zz = Hm[6] * X + Hm[7] * Y + 1;
      const fx = (Hm[0] * X + Hm[1] * Y + Hm[2]) / zz - 0.5, fy = (Hm[3] * X + Hm[4] * Y + Hm[5]) / zz - 0.5;
      const x0 = clamp(Math.floor(fx), 0, sw - 1), y0 = clamp(Math.floor(fy), 0, sh - 1);
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const dx = clamp(fx - x0, 0, 1), dy = clamp(fy - y0, 0, 1);
      const i00 = (y0 * sw + x0) * 4, i01 = (y0 * sw + x1) * 4, i10 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        out.data[o + c] = (sd[i00 + c] * (1 - dx) + sd[i01 + c] * dx) * (1 - dy) + (sd[i10 + c] * (1 - dx) + sd[i11 + c] * dx) * dy;
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/** True if the quad is (almost) the whole image — then no warp is needed. */
export function isFullImage(corners, w, h) {
  return polyArea(corners) > w * h * 0.97;
}
