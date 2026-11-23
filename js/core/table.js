// Ruled-table helpers for grid documents such as the LTO Certificate of Registration (pure JS).
//
// findTable(img)  – locate the printed table border (not the whole sheet of paper) in a photo:
//                   long dark horizontal / vertical strokes are kept, joined into connected
//                   components, and the biggest component that looks like a grid (several
//                   horizontal AND vertical rules) gives the 4 corners.
// detectGrid(img) – on the straightened table, list the ruled lines so each printed label can be
//                   mapped to the box (cell) it sits in. Values are read from inside that box only.
import { resize } from './image.js';
import { convexHull, hullToQuad, refineByLines, orderCorners, cornerAnglesOk, polyArea, detectDocument } from './quad.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Gray level that ignores yellow/orange stamp ink (light) but keeps black and red/blue ink dark. */
export function stampFreeGray(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const mn = Math.min(r, g, b);
  // yellow / ochre stamp: red and green both clearly above blue, red ≈ green
  if (r - b > 45 && g - b > 35 && Math.abs(r - g) < 70) return Math.max(r, g) * 0.95;
  return 0.6 * lum + 0.4 * mn;
}

/** Dark-pixel mask: darker than 82% of the local mean (window ≈ win px). */
function darkMask(img, win) {
  const { width: w, height: h, data: d } = img;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; p < w * h; i += 4, p++) g[p] = stampFreeGray(d[i], d[i + 1], d[i + 2]);
  const W1 = w + 1, S = new Float64Array(W1 * (h + 1));
  for (let y = 1; y <= h; y++) { let rs = 0; for (let x = 1; x <= w; x++) { rs += g[(y - 1) * w + x - 1]; S[y * W1 + x] = S[(y - 1) * W1 + x] + rs; } }
  const r = win >> 1, m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const mean = (S[yb * W1 + xb] - S[ya * W1 + xb] - S[yb * W1 + xa] + S[ya * W1 + xa]) / ((yb - ya) * (xb - xa));
      const v = g[y * w + x];
      m[y * w + x] = v < mean * 0.82 && v < 170 ? 1 : 0;
    }
  }
  return m;
}

/** Stroke thickness across the run direction must stay ≤ maxThick (rules are thin, text rows are not). */
function thinOnly(mask, w, h, maxThick, dir) {
  const out = new Uint8Array(w * h);
  const N = dir === 'h' ? w : h, L = dir === 'h' ? h : w; // scan perpendicular to the rule
  const idx = dir === 'h' ? (a, b) => b * w + a : (a, b) => a * w + b;
  for (let a = 0; a < N; a++) {
    let start = -1;
    for (let b = 0; b <= L; b++) {
      const on = b < L && mask[idx(a, b)];
      if (on && start < 0) start = b;
      else if (!on && start >= 0) { if (b - start <= maxThick) for (let k = start; k < b; k++) out[idx(a, k)] = 1; start = -1; }
    }
  }
  return out;
}

/** Keep only runs of dark pixels at least `len` long (gaps ≤ `gap` px bridged). dir 'h' or 'v'. */
/**
 * Rule pixels in direction dir ('h' | 'v'): thin dark strokes that can be followed for at least `len` px,
 * allowing the trace to drift ±1 px per step (curled / folded paper bends the rules) and to jump
 * short gaps (≤ gap px: stamp ink, text touching the rule, faint print).
 */
/** Keep stroke pixels that continue almost unbroken for ±half px along dir (±1 px across): rules, not letters. */
function straightOnly(T, w, h, dir, half, need = 0.8) {
  const band = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (dir === 'h') band[i] = T[i] | (y > 0 ? T[i - w] : 0) | (y < h - 1 ? T[i + w] : 0);
    else band[i] = T[i] | (x > 0 ? T[i - 1] : 0) | (x < w - 1 ? T[i + 1] : 0);
  }
  const out = new Uint8Array(w * h);
  const A = dir === 'h' ? w : h, B = dir === 'h' ? h : w;
  const idx = dir === 'h' ? (a, b) => b * w + a : (a, b) => a * w + b;
  const pre = new Int32Array(A + 1);
  for (let b = 0; b < B; b++) {
    for (let a = 0; a < A; a++) pre[a + 1] = pre[a] + band[idx(a, b)];
    for (let a = 0; a < A; a++) {
      const i = idx(a, b); if (!T[i]) continue;
      const lo = Math.max(0, a - half), hi = Math.min(A, a + half + 1);
      if (pre[hi] - pre[lo] >= (hi - lo) * need) out[i] = 1;
    }
  }
  return out;
}

function longRuns(mask, w, h, len, gap, dir, maxThick = 0) {
  let T = maxThick ? thinOnly(mask, w, h, maxThick, dir) : mask;
  T = straightOnly(T, w, h, dir, Math.max(5, Math.round(len / 5)));
  // work in "rows along the rule": a = position along the rule, b = across
  const A = dir === 'h' ? w : h, B = dir === 'h' ? h : w;
  const idx = dir === 'h' ? (a, b) => b * w + a : (a, b) => a * w + b;
  const pass = (forward) => {
    const L = new Uint16Array(w * h), G = new Uint8Array(w * h);
    for (let k = 0; k < A; k++) {
      const a = forward ? k : A - 1 - k, pa = forward ? a - 1 : a + 1;
      for (let b = 0; b < B; b++) {
        let bl = 0, bg = 0;
        if (pa >= 0 && pa < A) {
          for (let db = -1; db <= 1; db++) {
            const bb = b + db; if (bb < 0 || bb >= B) continue;
            const j = idx(pa, bb);
            if (L[j] > bl || (L[j] === bl && G[j] < bg)) { bl = L[j]; bg = G[j]; }
          }
        }
        const i = idx(a, b);
        if (T[i]) { L[i] = bl + 1; G[i] = 0; }
        else if (bl > 0 && bg < gap) { L[i] = bl; G[i] = bg + 1; }
      }
    }
    return L;
  };
  const F = pass(true), Bk = pass(false);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (T[i] && F[i] + Bk[i] - 1 >= len) out[i] = 1;
  return out;
}

function dilate(mask, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!mask[y * w + x]) continue; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) tmp[y * w + xx] = 1; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!tmp[y * w + x]) continue; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) out[yy * w + x] = 1; } }
  return out;
}

/** Connected components (4-neighbour) → [{ id, pixels:[idx], x0,y0,x1,y1 }]. */
function components(mask, w, h, minSize = 1) {
  const lab = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h), comps = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const c = { id: comps.length, pixels: [], x0: w, y0: h, x1: 0, y1: 0 };
    let sp = 0; stack[sp++] = i; lab[i] = c.id;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0;
      c.pixels.push(p); if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = c.id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = c.id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = c.id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = c.id; stack[sp++] = p + w; }
    }
    if (c.pixels.length >= minSize) comps.push(c);
  }
  return comps;
}

/** Number of distinct rules (lines) in a 1-D profile: runs of positions whose coverage ≥ minCov. */
function countRules(profile, minCov) {
  let n = 0, on = false;
  for (const v of profile) { if (v >= minCov && !on) { n++; on = true; } else if (v < minCov) on = false; }
  return n;
}

/** Dominant text/rule angle (radians, small) of a dark mask: shear projections, sharpest row profile wins. */
function dominantAngle(dm, w, h, maxDeg = 10, stepDeg = 0.5) {
  const pts = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (dm[y * w + x]) pts.push(x, y);
  let best = 0, bestScore = -1;
  const hist = new Float32Array(h + 2 * w + 10);
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += stepDeg) {
    const t = Math.tan(d * Math.PI / 180);
    hist.fill(0);
    for (let i = 0; i < pts.length; i += 2) { const k = Math.round(pts[i + 1] - pts[i] * t) + w; if (k >= 0 && k < hist.length) hist[k]++; }
    let sc = 0; for (let k = 0; k < hist.length; k++) sc += hist[k] * hist[k];
    if (sc > bestScore) { bestScore = sc; best = d; }
  }
  return best * Math.PI / 180;
}

/** Rotate an image by `ang` radians about its centre (same size, white fill). */
function rotateImg(img, ang) {
  const { width: w, height: h, data: d } = img;
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) };
  const c = Math.cos(ang), s = Math.sin(ang), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // inverse map: destination → source
    const dx = x - cx, dy = y - cy;
    const sx = Math.round(cx + dx * c - dy * s), sy = Math.round(cy + dx * s + dy * c);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
    out.data[di] = d[si]; out.data[di + 1] = d[si + 1]; out.data[di + 2] = d[si + 2];
  }
  return out;
}

/**
 * Find the ruled table of a grid document. Returns { corners:[TL,TR,BR,BL], confidence, hRules, vRules, areaFrac } or null.
 */
export function findTable(img, { analysisSize = 1000 } = {}) {
  const f = Math.min(1, analysisSize / Math.max(img.width, img.height));
  const small = f < 1 ? resize(img, img.width * f, img.height * f) : img;
  const w = small.width, h = small.height, long = Math.max(w, h);
  const win = Math.max(15, Math.round(long / 40) | 1);
  let dm = darkMask(small, win);
  // level a tilted photo first so the rules become straight pixel runs
  const ang = dominantAngle(dm, w, h);
  let work = small;
  if (Math.abs(ang) > 0.004) { work = rotateImg(small, ang); dm = darkMask(work, win); }
  const unrotate = (p) => {
    const c = Math.cos(ang), s = Math.sin(ang), dx = p.x - w / 2, dy = p.y - h / 2;
    return { x: w / 2 + dx * c - dy * s, y: h / 2 + dx * s + dy * c };
  };
  const minLen = Math.round(long * 0.035);
  const thick = Math.max(3, Math.round(long * 0.005));
  const H = longRuns(dm, w, h, minLen, 3, 'h', thick), V = longRuns(dm, w, h, minLen, 3, 'v', thick);
  const both = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) both[i] = H[i] | V[i];
  const joined = dilate(both, w, h, Math.max(2, Math.round(long * 0.004)));
  const comps = components(joined, w, h, minLen * 4);
  let best = null;
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (bw < w * 0.25 || bh < h * 0.15) continue;
    // count horizontal and vertical rules inside this component
    const rowCov = new Float32Array(bh), colCov = new Float32Array(bw);
    let hp = 0, vp = 0;
    for (const p of c.pixels) {
      const x = p % w, y = (p / w) | 0;
      if (H[p]) { rowCov[y - c.y0]++; hp++; }
      if (V[p]) { colCov[x - c.x0]++; vp++; }
    }
    // smooth profiles a little (slightly sloped rules spread over a few rows)
    const sm = (a) => a.map((_, i) => Math.max(a[i], a[i - 1] || 0, a[i + 1] || 0));
    // rules may be slightly sloped / broken: use the amount of rule ink, in "full-width rules"
    const hRules = Math.round(hp / bw), vRules = Math.round(vp / bh);
    if (hRules < 3 || vRules < 2) continue;
    const score = bw * bh * Math.min(1, hRules / 5) * Math.min(1, vRules / 3);
    if (!best || score > best.score) best = { c, hRules, vRules, score };
  }
  if (!best) return null;
  // The table's rules are often broken (paper folds, stamps, faint print), so the header / footer
  // part may not be connected to the main grid. Grow the region by chaining nearby rules that line up
  // with it (horizontal rules overlapping it in x, vertical rules inside its x-range).
  const rules = components(dilate(both, w, h, 1), w, h, minLen);
  const reg = { x0: best.c.x0, y0: best.c.y0, x1: best.c.x1, y1: best.c.y1 };
  const core = { ...reg };
  const used = new Set();
  const maxGap = (core.y1 - core.y0) * 0.13, tol = w * 0.012;
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rules) {
      if (used.has(r)) continue;
      const rw = r.x1 - r.x0 + 1, rh = r.y1 - r.y0 + 1;
      const inside = r.x0 >= core.x0 - tol && r.x1 <= core.x1 + tol && r.y0 >= core.y0 - 2 && r.y1 <= core.y1 + 2;
      const gapY = Math.max(0, reg.y0 - r.y1, r.y0 - reg.y1);
      let ok = inside;
      if (!ok && gapY <= maxGap) {
        if (rw >= rh) ok = Math.max(0, Math.min(r.x1, reg.x1) - Math.max(r.x0, reg.x0)) >= rw * 0.6;
        else ok = r.x0 >= reg.x0 - tol && r.x1 <= reg.x1 + tol;
      }
      if (!ok) continue;
      used.add(r); changed = true;
      reg.x0 = Math.min(reg.x0, r.x0); reg.x1 = Math.max(reg.x1, r.x1); reg.y0 = Math.min(reg.y0, r.y0); reg.y1 = Math.max(reg.y1, r.y1);
    }
  }
  const pts = [];
  for (const r of used) {
    const step = Math.max(1, Math.floor(r.pixels.length / 3000));
    for (let i = 0; i < r.pixels.length; i += step) { const p = r.pixels[i]; if (both[p]) pts.push({ x: p % w, y: (p / w) | 0 }); }
  }
  if (pts.length < 50) return null;
  const hull = convexHull(pts);
  let q = hullToQuad(hull);
  if (!q) return null;
  q = orderCorners(q);
  // refine with lines fitted to the outermost rule pixels
  const edgePts = hull.length > 40 ? hull : pts.filter((p, i) => i % 3 === 0);
  const r = refineByLines(q, edgePts);
  if (r) q = orderCorners(r);
  if (!cornerAnglesOk(q)) return null;
  const areaFrac = polyArea(q) / (w * h);
  if (areaFrac < 0.08) return null;
  // small margin outside the border: printed values sometimes overflow the outer rule
  const cx = q.reduce((a, p) => a + p.x, 0) / 4, cy = q.reduce((a, p) => a + p.y, 0) / 4;
  // and room above the table for the header printed outside it (CR No. / Date / Field Office) and below
  // it for the CR No. the revised form prints under the signature block
  const tw = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
  q = q.map((p, i) => ({ x: cx + (p.x - cx) * 1.035, y: i < 2 ? Math.min(cy + (p.y - cy) * 1.12, p.y - tw * 0.075) : cy + (p.y - cy) * 1.04 }));
  const confidence = +Math.min(1, 0.5 + 0.05 * best.hRules + 0.05 * best.vRules).toFixed(2);
  return {
    angle: +(ang * 180 / Math.PI).toFixed(1),
    corners: q.map(unrotate).map((p) => ({ x: clamp(p.x / f, 0, img.width - 1), y: clamp(p.y / f, 0, img.height - 1) })),
    confidence, hRules: best.hRules, vRules: best.vRules, areaFrac: +areaFrac.toFixed(3), method: 'table',
  };
}

/**
 * Analyse a (gray, straightened) table image once:
 *  erased – copy with the ruled lines painted white (Tesseract reads ruled forms much better without
 *           them: rules otherwise turn into "|", "_" or merge with letters)
 *  cells  – the boxes enclosed by the rules [{x0,y0,x1,y1,id}], label map `cellMap` (−1 = rule/outside)
 *  grid   – the rules themselves (see detectGrid)
 */
export function analyzeTable(img) {
  const w = img.width, h = img.height, long = Math.max(w, h);
  const dm = darkMask(img, Math.max(15, Math.round(long / 50) | 1));
  const minLen = Math.round(long * 0.04);
  const thick = Math.max(3, Math.round(long * 0.006));
  // gaps of a few px are bridged (stamp ink or a fold crossing a rule)
  const gap = Math.max(3, Math.round(long * 0.0025));
  const H = longRuns(dm, w, h, minLen, gap, 'h', thick), V = longRuns(dm, w, h, minLen, gap, 'v', thick);
  const both = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) both[i] = H[i] | V[i];
  const m = dilate(both, w, h, 1);
  const erased = { width: w, height: h, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < w * h; i++) if (m[i]) { erased.data[i * 4] = erased.data[i * 4 + 1] = erased.data[i * 4 + 2] = 255; }
  // cells = connected areas between the (slightly thickened) rules
  const wr = Math.max(3, Math.round(long * 0.0035));
  const walls = dilate(both, w, h, wr);
  // long horizontal rules are extended to the image edge: text that overflows the table's outer
  // border (or a broken border) must not join all rows into one region through the margin
  const hComps = components(dilate(H, w, h, 1), w, h, minLen);
  for (const c of hComps) {
    if (c.x1 - c.x0 < w * 0.45) continue;
    const endY = (pick) => { let sy = 0, n = 0; for (const p of c.pixels) { const x = p % w; if (pick(x)) { sy += (p / w) | 0; n++; } } return n ? Math.round(sy / n) : null; };
    const yl = endY((x) => x <= c.x0 + 6), yr = endY((x) => x >= c.x1 - 6);
    const draw = (xa, xb, y) => { if (y == null) return; for (let yy = Math.max(0, y - wr); yy <= Math.min(h - 1, y + wr); yy++) for (let x = xa; x <= xb; x++) walls[yy * w + x] = 1; };
    draw(0, c.x0, yl); draw(c.x1, w - 1, yr);
  }
  const cellMap = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h);
  const cells = [];
  let id = 0;
  for (let i = 0; i < w * h; i++) {
    if (walls[i] || cellMap[i] >= 0) continue;
    const c = { id, x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    let sp = 0; stack[sp++] = i; cellMap[i] = id;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0;
      c.area++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && !walls[p - 1] && cellMap[p - 1] < 0) { cellMap[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && !walls[p + 1] && cellMap[p + 1] < 0) { cellMap[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && !walls[p - w] && cellMap[p - w] < 0) { cellMap[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && !walls[p + w] && cellMap[p + w] < 0) { cellMap[p + w] = id; stack[sp++] = p + w; }
    }
    cells.push(c); id++;
  }
  // a real box: not tiny, not the area around the table (touches the image border or is huge)
  const boxes = cells.filter((c) => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    return bw >= long * 0.04 && bh >= long * 0.015 && c.area <= w * h * 0.2 && c.area >= bw * bh * 0.5;
  });
  const box = (c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
  const hs = hComps.map(box);
  const vs = components(dilate(V, w, h, 1), w, h, minLen).map(box).filter((b) => (b.x1 - b.x0) < (b.y1 - b.y0) * 0.5);
  return { erased, cells: boxes, cellMap, grid: { h: hs, v: vs, width: w, height: h, cells: boxes } };
}

/** Which analysed cell contains point (x, y)? (looks a few px around when the point is on a rule) */
export function cellIdAt(t, x, y) {
  const w = t.erased.width, h = t.erased.height;
  for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [6, 0], [-6, 0]]) {
    const xx = Math.round(x + dx), yy = Math.round(y + dy);
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const id = t.cellMap[yy * w + xx];
    if (id >= 0 && t.cells.some((c) => c.id === id)) return id;
  }
  return -1;
}

/**
 * Ruled lines of a (straightened) table image, in that image's pixel coordinates:
 * { h:[{x0,x1,y0,y1}], v:[{x0,x1,y0,y1}] } — each entry is the bounding box of one rule.
 */
export function detectGrid(img) {
  const w = img.width, h = img.height, long = Math.max(w, h);
  const dm = darkMask(img, Math.max(15, Math.round(long / 50) | 1));
  const minLen = Math.round(long * 0.03);
  const thick = Math.max(3, Math.round(long * 0.006));
  const H = longRuns(dm, w, h, minLen, 3, 'h', thick), V = longRuns(dm, w, h, minLen, 3, 'v', thick);
  const box = (c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
  // a rule is long and thin; a thick filled banner (white-on-black heading) is kept as a block too
  const hs = components(dilate(H, w, h, 1), w, h, minLen).map(box).filter((b) => b.x1 - b.x0 >= minLen);
  const vs = components(dilate(V, w, h, 1), w, h, minLen).map(box).filter((b) => b.y1 - b.y0 >= minLen && (b.x1 - b.x0) < (b.y1 - b.y0) * 0.5);
  return { h: hs, v: vs, width: w, height: h };
}

/**
 * Box (cell) around a point/box b = {x0,y0,x1,y1}: nearest rules left/right/above/below that span it.
 * Missing sides stay at ±Infinity. tol = how far a rule may overlap the box (thick lines / tilt).
 */
export function cellAt(grid, b, tol = 4) {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity;
  for (const r of grid.v) {
    if (r.y0 > cy || r.y1 < cy) continue;
    if (r.x1 <= b.x0 + tol) left = Math.max(left, r.x1);
    else if (r.x0 >= b.x1 - tol) right = Math.min(right, r.x0);
  }
  for (const r of grid.h) {
    if (r.x0 > cx || r.x1 < cx) continue;
    if (r.y1 <= b.y0 + tol) top = Math.max(top, r.y1);
    else if (r.y0 >= b.y1 - tol) bottom = Math.min(bottom, r.y0);
  }
  return { x0: left, x1: right, y0: top, y1: bottom };
}

/**
 * Outline used for straightening: for grid documents (CR) the printed table border, otherwise the
 * paper/card edge. Returns the same shape as detectDocument() (+ method 'table') or null.
 */
function edgeAngle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
function maxEdgeAngleDiff(q1, q2) {
  let m = 0;
  for (let i = 0; i < 4; i++) {
    let d = Math.abs(edgeAngle(q1[i], q1[(i + 1) % 4]) - edgeAngle(q2[i], q2[(i + 1) % 4]));
    if (d > 180) d = 360 - d;
    m = Math.max(m, d);
  }
  return m;
}
function quadInside(inner, outer) {
  const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const sgn = Math.sign(cross(outer[0], outer[1], outer[2]));
  return inner.every((p) => outer.every((a, i) => sgn * cross(a, outer[(i + 1) % 4], p) >= -15));
}

export function detectOutline(img, { docType = 'auto' } = {}) {
  let t = null;
  if (docType !== 'license') { try { t = findTable(img); } catch (e) { t = null; } }
  // a small ruled area (a photo frame or a box on an ID card) is not a CR table
  const d = detectDocument(img);
  if (t && t.confidence >= 0.6 && (t.areaFrac == null || t.areaFrac >= 0.25)) {
    // part of a rule washed out (glare) bends the table outline: when a clear page outline contains
    // the table and runs at a clearly different angle along some edge, the page outline is used
    if (d && d.confidence >= 0.9 && quadInside(t.corners, d.corners) && maxEdgeAngleDiff(t.corners, d.corners) > 3) return { ...d, method: 'table', via: 'page' };
    return t;
  }
  return d;
}
