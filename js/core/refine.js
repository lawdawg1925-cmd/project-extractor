// Targeted second pass for strict-format fields (license no., plate, MV file no., dates, blood type …).
// The value area is cut out of the image, enlarged, cleaned in several ways and re-read as a single
// line (Tesseract PSM 7) with a character whitelist. A re-read value is used only if it passes the
// field's format check. It becomes OK only when two different variants agree with high confidence;
// otherwise it stays [VERIFY]. Nothing is ever invented: if no variant passes, the original stays.
import { crop, resize, normalizeContrast, adaptiveThreshold, clone } from './image.js';
import { STATUS } from './status.js';

function otsu(img) {
  const hist = new Uint32Array(256), d = img.data, n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  const out = clone(img);
  for (let i = 0; i < d.length; i += 4) { const v = d[i] > thr ? 255 : 0; out.data[i] = out.data[i + 1] = out.data[i + 2] = v; }
  return out;
}

/** Divide by a heavily blurred copy → removes glare gradients / shadows / faint background patterns. */
export function flatten(img) {
  const s = 16;
  const small = resize(img, Math.max(4, img.width / s), Math.max(4, img.height / s));
  // blur the small image with a 5x5 box (max) to estimate the paper brightness
  const w = small.width, h = small.height, bgd = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); m = Math.max(m, small.data[(yy * w + xx) * 4]); }
    bgd[y * w + x] = m;
  }
  const out = clone(img);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const bx = Math.min(w - 1, Math.floor(x / s)), by = Math.min(h - 1, Math.floor(y / s));
    const i = (y * img.width + x) * 4;
    const v = Math.min(255, (img.data[i] / Math.max(30, bgd[by * w + bx])) * 245);
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
  }
  return out;
}

function region(geo, img, opts = {}) {
  if (geo.value) {
    const b = geo.value, h = b.y1 - b.y0;
    return { x: b.x0 - h * 0.6, y: b.y0 - h * 0.35, w: b.x1 - b.x0 + h * 1.2, h: h * 1.7 };
  }
  if (geo.label) {
    const b = geo.label, h = b.y1 - b.y0;
    const x1 = Math.min(geo.nextLabelX - h * 0.4, b.x0 + Math.max(b.x1 - b.x0 + h, h * (opts.w || 14)));
    const x0 = b.x0 - h * 1.5; // values can start left of a short label (e.g. codes under "DL Codes")
    return { x: x0, y: b.y1, w: Math.max(h * 3, x1 - x0), h: h * (opts.h || 2.4) };
  }
  return null;
}

/**
 * @param fields  extracted fields (mutated in place)
 * @param defs    extractor field definitions (with .refine = { whitelist })
 * @param img     the preprocessed grayscale image the OCR ran on
 * @param recognize async (img, {psm, whitelist}) => tesseract data
 */
async function readRegion(img, r, def, recognize) {
  r = { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.w, h: r.h };
  r.w = Math.min(r.w, img.width - r.x); r.h = Math.min(r.h, img.height - r.y);
  if (r.w < 8 || r.h < 8) return [];
  let c = crop(img, r);
  const scale = Math.min(4, Math.max(1, 64 / Math.max(1, r.h)));
  if (scale > 1.05) c = resize(c, c.width * scale, c.height * scale);
  const base = normalizeContrast(c);
  const variants = { contrast: base, flat: otsu(flatten(base)), sauvola: adaptiveThreshold(base, Math.max(15, (c.height | 1)), 0.2) };
  const reads = [];
  for (const [name, v] of Object.entries(variants)) {
    const data = await recognize(v, { psm: '7', whitelist: def.refine.whitelist });
    const text = (data.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const fmt = def.format(text);
    // confidence of the words that carry letters/digits (Tesseract gives lone punctuation 0 when whitelisted)
    const all = data.words && data.words.length ? data.words
      : (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).flatMap((l) => l.words || [])));
    const ws = all.filter((w) => /[A-Za-z0-9]/.test(w.text));
    if (globalThis.GRX_DEBUG_REFINE) console.log('  words', ws.map((w) => w.text + ':' + Math.round(w.confidence) + '/' + (w.symbols || []).map((y) => y.text + Math.round(y.confidence)).join('')).join(' '), 'page', Math.round(data.confidence));
    // Tesseract sometimes reports 0 for a whole word that contains whitelisted punctuation ("O+", "A,A1");
    // then use the mean of its letter/digit symbol confidences instead
    const wconf = (w) => {
      if (w.confidence > 0 || !w.symbols || !w.symbols.length) return w.confidence;
      const sy = w.symbols.filter((y) => /[A-Za-z0-9]/.test(y.text));
      return sy.length ? sy.reduce((a, y) => a + y.confidence, 0) / sy.length : 0;
    };
    const conf = ws.length ? Math.min(...ws.map(wconf)) : data.confidence;
    reads.push({ name, text, fmt, conf });
  }
  return reads;
}

export async function refineFields(fields, defs, img, recognize, { maxFields = 8 } = {}) {
  const todo = fields.filter((f) => {
    const d = defs.find((x) => x.key === f.key);
    return d && d.refine && f._geo && (f.status === STATUS.VERIFY || f.status === STATUS.UNREADABLE) && !/differs|conflict/i.test(f.note || '');
  }).slice(0, maxFields);
  let changed = 0;
  for (const f of todo) {
    const def = defs.find((x) => x.key === f.key);
    // read the value box first; if that gives nothing usable, the area right under the label
    // (a value box much smaller than the label text is a speck/stray mark, not the value — skip it)
    const g = f._geo, lh = g.label ? g.label.y1 - g.label.y0 : 0;
    const tiny = g.value && lh && (g.value.y1 - g.value.y0) < lh * 0.6;
    const regions = [tiny ? null : region(g, img), g.value ? region({ ...g, value: null }, img, def.refine) : null].filter(Boolean);
    let reads = [];
    for (const r of regions) {
      reads = await readRegion(img, r, def, recognize);
      if (globalThis.GRX_DEBUG_REFINE) console.log('refine', f.key, JSON.stringify(r), reads.map((x) => `${x.name}:${x.text}(${Math.round(x.conf)})${x.fmt.ok ? '' : '✗'}`).join(' '));
      if (reads.some((x) => x.fmt.ok)) break;
    }
    const good = reads.filter((x) => x.fmt.ok);
    if (!good.length) continue;
    good.sort((a, b) => b.conf - a.conf);
    const top = good[0];
    const agree = good.filter((x) => x.fmt.value === top.fmt.value && !x.fmt.fixed);
    const before = f.value;
    if (agree.length >= 2 && Math.min(...agree.map((x) => x.conf)) >= 85 && !top.fmt.fixed) {
      f.value = top.fmt.value; f.status = STATUS.OK; f.confidence = Math.round(Math.min(...agree.map((x) => x.conf)));
      f.note = `Confirmed by a targeted re-read (${agree.length} image variants agree).`;
    } else {
      f.value = top.fmt.value; f.status = STATUS.VERIFY; f.confidence = Math.round(top.conf);
      f.note = `Re-read from the value area${before && before !== top.fmt.value ? ` (first read: "${before}")` : ''} — check it.`;
    }
    if (top.fmt.iso) f.iso = top.fmt.iso;
    if (f.value !== before || f.status === STATUS.OK) changed++;
  }
  return changed;
}
