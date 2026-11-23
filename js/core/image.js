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
export function grayscale(img) {
  const out = make(img.width, img.height);
  const d = img.data, o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    // use min-channel blend so colored text on light paper stays dark
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    const g = 0.6 * lum + 0.4 * mn;
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
export function preprocess(img, { mode = 'standard', target = 2000 } = {}) {
  let out = scaleToLongSide(img, target);
  out = grayscale(out);
  out = normalizeContrast(out);
  if (mode === 'enhanced') {
    out = sharpen(out, 0.8);
    out = adaptiveThreshold(out, Math.max(15, Math.round(Math.max(out.width, out.height) / 60) | 1), 0.2);
  }
  return out;
}
