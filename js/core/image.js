// Pure-JS image preprocessing on ImageData-like objects {width, height, data: Uint8ClampedArray RGBA}.
// Used unchanged in the browser (canvas ImageData) and in Node tests (decoded with jimp).

function make(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function clone(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/** Rotate clockwise by 90° * times. */
export function rotate90(img, times = 1) {
  times = ((times % 4) + 4) % 4;
  let cur = img;
  for (let t = 0; t < times; t++) {
    const { width: w, height: h, data } = cur;
    const out = make(h, w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4;
        const nx = h - 1 - y, ny = x;
        const di = (ny * h + nx) * 4;
        out.data[di] = data[si]; out.data[di + 1] = data[si + 1]; out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
      }
    }
    cur = out;
  }
  return times ? cur : clone(img);
}

/** Bilinear resize. */
export function resize(img, nw, nh) {
  nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh));
  const { width: w, height: h, data } = img;
  const out = make(nw, nh);
  const sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), dy = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), dx = fx - x0;
      const i00 = (y0 * w + x0) * 4, i01 = (y0 * w + x1) * 4, i10 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      const di = (y * nw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = data[i00 + c] * (1 - dx) + data[i01 + c] * dx;
        const bot = data[i10 + c] * (1 - dx) + data[i11 + c] * dx;
        out.data[di + c] = top * (1 - dy) + bot * dy;
      }
    }
  }
  return out;
}

/** Scale so the long side is about `target` px (OCR works best with ~20-40px letter height). */
export function scaleToLongSide(img, target = 2000) {
  const long = Math.max(img.width, img.height);
  if (Math.abs(long - target) / target < 0.08) return clone(img);
  const f = target / long;
  return resize(img, img.width * f, img.height * f);
}

/** Crop to rect {x, y, w, h} (clamped). */
export function crop(img, r) {
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(img.width, Math.round(r.x + r.w)), y1 = Math.min(img.height, Math.round(r.y + r.h));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const out = make(w, h);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * img.width + x0) * 4;
    out.data.set(img.data.subarray(s, s + w * 4), y * w * 4);
  }
  return out;
}

/** Luminance grayscale (keeps RGBA layout). Colored ink (red CR numbers, blue headers) stays dark enough. */
export function grayscale(img, { stampFree = false } = {}) {
  const out = make(img.width, img.height);
  const d = img.data, o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    // use min-channel blend so colored text on light paper stays dark
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    let g = 0.6 * lum + 0.4 * mn;
    // yellow / ochre rubber-stamp ink over the text (CRs): render it light so it does not mask letters
    if (stampFree && d[i] - d[i + 2] > 45 && d[i + 1] - d[i + 2] > 35 && Math.abs(d[i] - d[i + 1]) < 70) g = Math.max(d[i], d[i + 1]) * 0.95;
    o[i] = o[i + 1] = o[i + 2] = g; o[i + 3] = 255;
  }
  return out;
}

/** Stretch gray levels so the 1st..99th percentiles cover 0..255 (fixes faded/low-contrast photos). */
export function normalizeContrast(img, lowPct = 0.01, highPct = 0.99) {
  const hist = new Uint32Array(256);
  const d = img.data, n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * lowPct) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * (1 - highPct)) { hi = v; break; } }
  const out = clone(img);
  if (hi - lo < 10) return out;
  const scale = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.max(0, Math.min(255, (d[i] - lo) * scale));
    out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
  }
  return out;
}

/** 3x3 sharpen (unsharp-like) on a gray image. */
export function sharpen(img, amount = 0.6) {
  const { width: w, height: h, data: d } = img;
  const out = clone(img);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const nb = (d[i - 4] + d[i + 4] + d[i - w * 4] + d[i + w * 4]) / 4;
      const v = d[i] + amount * 4 * (d[i] - nb) / 2;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = Math.max(0, Math.min(255, v));
    }
  }
  return out;
}

/** Sauvola-style adaptive threshold (handles uneven lighting / shadows). Input must be gray. */
export function adaptiveThreshold(img, win = 31, k = 0.25) {
  const { width: w, height: h, data: d } = img;
  const W1 = w + 1;
  const sum = new Float64Array(W1 * (h + 1)), sq = new Float64Array(W1 * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rs = 0, rq = 0;
    for (let x = 1; x <= w; x++) {
      const v = d[((y - 1) * w + (x - 1)) * 4];
      rs += v; rq += v * v;
      sum[y * W1 + x] = sum[(y - 1) * W1 + x] + rs;
      sq[y * W1 + x] = sq[(y - 1) * W1 + x] + rq;
    }
  }
  const r = win >> 1;
  const out = clone(img);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const cnt = (yb - ya) * (xb - xa);
      const s = sum[yb * W1 + xb] - sum[ya * W1 + xb] - sum[yb * W1 + xa] + sum[ya * W1 + xa];
      const q = sq[yb * W1 + xb] - sq[ya * W1 + xb] - sq[yb * W1 + xa] + sq[ya * W1 + xa];
      const mean = s / cnt, sd = Math.sqrt(Math.max(0, q / cnt - mean * mean));
      const t = mean * (1 + k * (sd / 128 - 1));
      const i = (y * w + x) * 4;
      const v = d[i] > t ? 255 : 0;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    }
  }
  return out;
}

/**
 * Standard preprocessing chain.
 * mode 'standard': scale + grayscale + contrast stretch.
 * mode 'enhanced': standard + sharpen + adaptive threshold (for blurry/shadowed photos).
 */
export function preprocess(img, { mode = 'standard', target = 2000, stampFree = false } = {}) {
  let out = scaleToLongSide(img, target);
  out = grayscale(out, { stampFree });
  out = normalizeContrast(out);
  if (mode === 'enhanced') {
    out = sharpen(out, 0.8);
    out = adaptiveThreshold(out, Math.max(15, Math.round(Math.max(out.width, out.height) / 60) | 1), 0.2);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Low-end phone cameras: photo quality check and restoration (all on-device, pure JS).

/** Separable Gaussian blur of one Float32 channel (w × h), edge pixels repeated. */
function blurPlane(src, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2.5)), k = new Float32Array(2 * r + 1);
  let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h), dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) { let xx = x + i; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; a += k[i + r] * src[row + xx]; }
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) { let yy = y + i; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; a += k[i + r] * tmp[yy * w + x]; }
      dst[y * w + x] = a;
    }
  }
  return dst;
}

/**
 * Quick quality measures of a photo (or the straightened document):
 *  noise     – sensor-noise level (Immerkær estimate, gray levels; clean photos ≈ 1-3, cheap cameras in dim light 5+)
 *  paper     – brightness of the paper (90th percentile gray; dim photos < 150)
 *  contrast  – paper minus ink level (5th percentile)
 *  sharpness – mean edge strength of the strongest edges relative to the contrast (blurry < ~0.12)
 *  long      – long side in px
 */
export function photoQuality(img) {
  const { width: w, height: h, data: d } = img;
  const step = Math.max(1, Math.round(Math.max(w, h) / 1200)); // sample ≈1200 px on the long side
  const sw = Math.floor(w / step), sh = Math.floor(h / step);
  const g = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = ((y * step) * w + x * step) * 4; g[y * sw + x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
  const hist = new Uint32Array(256); for (let i = 0; i < g.length; i++) hist[Math.min(255, g[i] | 0)]++;
  const pct = (q) => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= g.length * q) return v; } return 255; };
  const paper = pct(0.9), ink = pct(0.05);
  // noise: on the full-resolution gray of a central window (noise is averaged away by subsampling)
  const cw = Math.min(w, 600), ch = Math.min(h, 600), ox = (w - cw) >> 1, oy = (h - ch) >> 1;
  let acc = 0, n = 0;
  const G = (x, y) => { const i = ((oy + y) * w + ox + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
  const lap = [];
  for (let y = 1; y < ch - 1; y += 2) for (let x = 1; x < cw - 1; x += 2) {
    const v = G(x - 1, y - 1) - 2 * G(x, y - 1) + G(x + 1, y - 1) - 2 * G(x - 1, y) + 4 * G(x, y) - 2 * G(x + 1, y) + G(x - 1, y + 1) - 2 * G(x, y + 1) + G(x + 1, y + 1);
    lap.push(Math.abs(v));
  }
  // flat areas only (text edges would count as noise): the lower 60% of the Laplacian magnitudes
  lap.sort((a, b) => a - b);
  const m = Math.floor(lap.length * 0.6);
  for (let i = 0; i < m; i++) { acc += lap[i]; n++; }
  const noise = n ? Math.sqrt(Math.PI / 2) * (acc / n) / 6 * 1.6 : 0;
  // sharpness: 99th percentile of the gradient magnitude on the sampled image, relative to contrast,
  // corrected for the sampling step (a gradient per sampled px spans `step` original px)
  const grads = [];
  for (let y = 1; y < sh - 1; y += 2) for (let x = 1; x < sw - 1; x += 2) {
    const gx = g[y * sw + x + 1] - g[y * sw + x - 1], gy = g[(y + 1) * sw + x] - g[(y - 1) * sw + x];
    grads.push(Math.hypot(gx, gy) / 2);
  }
  grads.sort((a, b) => a - b);
  const g99 = grads.length ? grads[Math.floor(grads.length * 0.99)] : 0;
  const sharpness = (g99 / Math.max(20, paper - ink)) / step;
  return { noise, paper, ink, contrast: paper - ink, sharpness, long: Math.max(w, h) };
}

/**
 * Is this (straightened) document photo dim, blurry or low-resolution — typical of a cheap phone camera?
 * Measured on a 1000 px copy so the sharpness figure does not depend on the camera resolution.
 * (Calibrated on real phone photos: sharp ones ≥ 0.47; soft / shaken / low-resolution ones ≤ 0.34.)
 */
export function docQuality(img) {
  const q = photoQuality(scaleToLongSide(img, 1000));
  const long = Math.max(img.width, img.height);
  const low = q.paper < 150 || long < 1400 || q.sharpness < 0.4;
  return { ...q, long, low, dim: q.paper < 150, small: long < 1400, blurry: q.sharpness < 0.4 };
}

/**
 * Restore a low-quality photo for OCR: (1) upscale small images, (2) remove sensor noise with a light
 * blur, (3) even out the lighting (divide by the paper brightness → dim / shadowed photos become
 * white paper with dark ink), (4) unsharp mask to firm up soft letters. Colours are kept (the stamp-ink
 * filter and colour cues still work). Text is never added or removed, only cleaned.
 */
export function restorePhoto(img, q = photoQuality(img), { minLong = 1600 } = {}) {
  let src = img;
  let f = 1;
  if (q.long < minLong) { f = minLong / q.long; src = resize(img, img.width * f, img.height * f); }
  const w = src.width, h = src.height, N = w * h, d = src.data;
  const sigma = Math.min(1.6, Math.max(0.7, q.noise / 6)) * Math.max(1, f * 0.8);
  const planes = [0, 1, 2].map((c) => { const p = new Float32Array(N); for (let i = 0; i < N; i++) p[i] = d[i * 4 + c]; return blurPlane(p, w, h, sigma); });
  // paper brightness: max of the gray over 16×16 tiles, widened 5×5 tiles, then smoothed
  const s = 16, tw = Math.max(1, Math.ceil(w / s)), th = Math.max(1, Math.ceil(h / s));
  const tile = new Float32Array(tw * th);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = 0.299 * planes[0][i] + 0.587 * planes[1][i] + 0.114 * planes[2][i], t = ((y / s) | 0) * tw + ((x / s) | 0);
    if (v > tile[t]) tile[t] = v;
  }
  const wide = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let m = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = Math.min(tw - 1, Math.max(0, x + dx)), yy = Math.min(th - 1, Math.max(0, y + dy)); m = Math.max(m, tile[yy * tw + xx]); }
    wide[y * tw + x] = m;
  }
  const bg = blurPlane(wide, tw, th, 1.5);
  // unsharp mask on the evened-out image
  const us = 1.6 * Math.max(1, f * 0.8), amt = 0.9;
  const out = make(w, h);
  const blurred = planes.map((p) => blurPlane(p, w, h, us));
  for (let y = 0; y < h; y++) {
    const fy = Math.min(th - 1, Math.max(0, y / s - 0.5)), y0 = Math.floor(fy), y1 = Math.min(th - 1, y0 + 1), dy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tw - 1, Math.max(0, x / s - 0.5)), x0 = Math.floor(fx), x1 = Math.min(tw - 1, x0 + 1), dx = fx - x0;
      const b = (bg[y0 * tw + x0] * (1 - dx) + bg[y0 * tw + x1] * dx) * (1 - dy) + (bg[y1 * tw + x0] * (1 - dx) + bg[y1 * tw + x1] * dx) * dy;
      const gain = 235 / Math.max(30, b), i = y * w + x;
      for (let c = 0; c < 3; c++) {
        const v = planes[c][i] + amt * (planes[c][i] - blurred[c][i]);
        out.data[i * 4 + c] = Math.max(0, Math.min(255, v * gain));
      }
      out.data[i * 4 + 3] = 255;
    }
  }
  return out;
}
