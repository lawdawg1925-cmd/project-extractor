// Layout-aware helpers: find printed labels (e.g. "License No.") among OCR words and
// read the value that sits to the RIGHT of the label or BELOW it in the same column.
import { normToken, levenshtein, allowedDistance, cleanValue } from './text.js';

/**
 * Normalize an OCR result (tesseract.js shape or a test fixture) into
 * { words:[{text,conf,bbox:{x0,y0,x1,y1},line}], lines:[{text,words}], text, meanConf }.
 * A fixture may be plain text: each line becomes a row with synthetic boxes
 * (words laid out left-to-right; columns separated by 2+ spaces keep their x position).
 */
export function normalizeOcr(input) {
  if (typeof input === 'string') return fromPlainText(input);
  const words = [];
  const lines = [];
  (input.lines || []).forEach((ln, li) => {
    const lw = [];
    (ln.words || []).forEach((w) => {
      if (!w.text || !w.text.trim()) return;
      const nw = { text: w.text.trim(), conf: w.confidence ?? w.conf ?? 0, bbox: { ...w.bbox }, line: li };
      words.push(nw); lw.push(nw);
    });
    if (lw.length) lines.push({ text: lw.map((w) => w.text).join(' '), words: lw, idx: li });
  });
  if (!lines.length && input.words) {
    // words without lines: group by y overlap
    return groupWords(input.words.map((w) => ({ text: w.text, conf: w.confidence ?? w.conf ?? 0, bbox: { ...w.bbox } })), input.text);
  }
  const meanConf = words.length ? words.reduce((a, w) => a + w.conf, 0) / words.length : 0;
  return { words, lines, text: input.text || lines.map((l) => l.text).join('\n'), meanConf };
}

function groupWords(ws, text) {
  ws.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lines = [];
  for (const w of ws) {
    const yc = (w.bbox.y0 + w.bbox.y1) / 2;
    let ln = lines.find((l) => yc > l.y0 && yc < l.y1);
    if (!ln) { ln = { y0: w.bbox.y0, y1: w.bbox.y1, words: [] }; lines.push(ln); }
    ln.words.push(w);
  }
  const out = { words: [], lines: [], text: '', meanConf: 0 };
  lines.forEach((l, i) => {
    l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    l.words.forEach((w) => { w.line = i; out.words.push(w); });
    out.lines.push({ text: l.words.map((w) => w.text).join(' '), words: l.words, idx: i });
  });
  out.text = text || out.lines.map((l) => l.text).join('\n');
  out.meanConf = out.words.length ? out.words.reduce((a, w) => a + w.conf, 0) / out.words.length : 0;
  return out;
}

/**
 * Remove residual skew from word coordinates (tilted photo, leftover perspective): estimate the median
 * slope of the OCR text lines and shear every word box so rows become horizontal again.
 * Rows/columns are then compared reliably ("value below the label", "same row"). Idempotent.
 */
export function deskewWords(ocr) {
  if (ocr._deskewed) return ocr;
  const slopes = [];
  for (const ln of ocr.lines) {
    const ws = ln.words.filter((w) => w.text.length >= 2);
    if (ws.length < 3) continue;
    const xs = ws.map((w) => (w.bbox.x0 + w.bbox.x1) / 2), ys = ws.map((w) => w.bbox.y1);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    if (den > 0 && Math.max(...xs) - Math.min(...xs) > 150) slopes.push(num / den);
  }
  ocr._deskewed = true;
  if (slopes.length < 2) return ocr;
  slopes.sort((a, b) => a - b);
  const k = slopes[slopes.length >> 1];
  ocr.skewSlope = k;
  if (Math.abs(k) < 0.004 || Math.abs(k) > 0.25) return ocr;
  for (const w of ocr.words) {
    w.obox = w.obox || { ...w.bbox }; // original image coordinates (used to crop regions for re-reading)
    const dy = k * ((w.bbox.x0 + w.bbox.x1) / 2);
    w.bbox = { ...w.bbox, y0: w.bbox.y0 - dy, y1: w.bbox.y1 - dy };
  }
  return ocr;
}

/** Share of multi-letter words whose box is wider than tall (≈1 when the page is upright, ≈0 when sideways). */
export function horizontalRatio(ocr) {
  const ws = ocr.words.filter((w) => w.text.length >= 3);
  if (!ws.length) return 0;
  return ws.filter((w) => (w.bbox.x1 - w.bbox.x0) > (w.bbox.y1 - w.bbox.y0)).length / ws.length;
}

/** Plain-text fixture → synthetic word boxes (char width 20px, line height 40px). */
export function fromPlainText(text, conf = 95) {
  const CW = 20, LH = 40;
  const words = [], lines = [];
  text.split(/\r?\n/).forEach((raw, li) => {
    const lw = [];
    const re = /\S+/g; let m;
    while ((m = re.exec(raw))) {
      const w = { text: m[0], conf, bbox: { x0: m.index * CW, x1: (m.index + m[0].length) * CW, y0: li * LH, y1: li * LH + 28 }, line: li };
      words.push(w); lw.push(w);
    }
    if (lw.length) lines.push({ text: lw.map((w) => w.text).join(' '), words: lw, idx: li });
  });
  return { words, lines, text, meanConf: conf };
}

const unionBox = (ws) => ({
  x0: Math.min(...ws.map((w) => w.bbox.x0)), y0: Math.min(...ws.map((w) => w.bbox.y0)),
  x1: Math.max(...ws.map((w) => w.bbox.x1)), y1: Math.max(...ws.map((w) => w.bbox.y1)),
});

/**
 * Find every occurrence of a printed label. `label` is the label as printed, e.g. "License No.".
 * Matching is done on the concatenation of consecutive words in the same OCR line with all
 * punctuation/spaces removed, so "Height(m)", "Height (m)" and "Helght(m)" all match.
 * Options: {exact:true} forbids fuzzy matching; {lineStart:true} label must start its line.
 */
export function findLabel(ocr, label, opts = {}) {
  const target = normToken(label);
  const maxD = opts.maxDist !== undefined ? opts.maxDist : (opts.exact ? 0 : allowedDistance(target.length));
  const hits = [];
  for (const ln of ocr.lines) {
    const ws = ln.words;
    for (let i = 0; i < ws.length; i++) {
      if (opts.lineStart && i > 0) break;
      let acc = '';
      for (let j = i; j < ws.length && j < i + 8; j++) {
        acc += normToken(ws[j].text);
        if (acc.length > target.length + maxD) break;
        if (acc.length >= target.length - maxD && levenshtein(acc, target) <= maxD) {
          // the next word must not continue the label (avoid matching "Date" inside "Date of Birth")
          const span = ws.slice(i, j + 1);
          hits.push({ label, words: span, bbox: unionBox(span), line: ln.idx, dist: levenshtein(acc, target) });
          break;
        }
      }
    }
  }
  return hits;
}

/** Height of a box. */
const hgt = (b) => b.y1 - b.y0;
const vOverlap = (a, b) => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) / Math.max(1, Math.min(hgt(a), hgt(b)));

/**
 * Read the value for a label hit.
 * ctx = { ocr, labelWords:Set (words used by any label), labelHits:[all label hits on the page] }
 * opts = { where:'auto'|'right'|'below', multiline:false, maxLines:3, maxGap:3.5 }
 * Returns { text, words, conf, minConf, where } or null.
 */
export function readValue(hit, ctx, opts = {}) {
  const where = opts.where || 'auto';
  const lh = Math.max(8, hgt(hit.bbox));
  // right boundary = nearest other label to the right on the same row
  let colRight = Infinity;
  for (const o of ctx.labelHits) {
    if (o === hit) continue;
    if (o.bbox.x0 > hit.bbox.x1 && vOverlap(o.bbox, hit.bbox) > 0.4) colRight = Math.min(colRight, o.bbox.x0 - lh * 0.5);
  }
  const free = (w) => !ctx.labelWords.has(w);
  if (where === 'right') {
    // Same printed row only. On tilted photos a value row ABOVE/BELOW can drift into the label's
    // y-band at the far right, so a word must sit on the label's own OCR line, or on a line whose
    // centre is level with the label (|Δy| < 0.45 × label height).
    const hc = (hit.bbox.y0 + hit.bbox.y1) / 2;
    const lc = lineCenters(ctx.ocr);
    const rRight = colRight === Infinity ? Infinity : colRight + lh * 0.5;
    const ws = ctx.ocr.words.filter((w) => free(w) && w.bbox.x0 >= hit.bbox.x1 - 2 && w.bbox.x0 < rRight &&
      (w.line === hit.line || (vOverlap(w.bbox, hit.bbox) > 0.5 && Math.abs((lc[w.line] ?? hc) - hc) < lh * 0.45)))
      .sort((a, b) => a.bbox.x0 - b.bbox.x0);
    // stop at a big horizontal gap (another column / signature block)
    const keep = [];
    for (const w of ws) {
      const prev = keep.length ? keep[keep.length - 1].bbox.x1 : hit.bbox.x1;
      if (w.bbox.x0 - prev > (keep.length ? hgt(w.bbox) * (opts.colGap || 1.8) : lh * (opts.rightMaxGap || 16))) break;
      keep.push(w);
    }
    if (keep.length && cleanValue(keep.map((w) => w.text).join(' '))) return pack(keep, 'right');
    return null;
  }
  // BELOW: same column, first row(s) under the label, above the next label in this column
  const colLeft = hit.bbox.x0 - lh * 0.6;
  const maxGap = lh * (opts.maxGap || 3.5);
  let nextLabelY = Infinity;
  for (const o of ctx.labelHits) {
    if (o === hit || o.bbox.y0 <= hit.bbox.y1 - 2) continue;
    const ox0 = o.bbox.x0, ox1 = o.bbox.x1;
    if (ox1 > colLeft && ox0 < Math.min(colRight, hit.bbox.x1 + lh * 12)) nextLabelY = Math.min(nextLabelY, o.bbox.y0);
  }
  const cand = ctx.ocr.words.filter((w) => free(w) && w.bbox.y0 > hit.bbox.y1 - lh * 0.3 &&
    w.bbox.y0 < nextLabelY - 2 && w.bbox.x0 >= colLeft && w.bbox.x0 < colRight);
  if (!cand.length) return null;
  cand.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rows = [];
  for (const w of cand) {
    const yc = (w.bbox.y0 + w.bbox.y1) / 2;
    let r = rows.find((r) => yc > r.y0 && yc < r.y1);
    if (!r) { r = { y0: w.bbox.y0, y1: w.bbox.y1, words: [] }; rows.push(r); }
    r.words.push(w);
  }
  rows.sort((a, b) => a.y0 - b.y0);
  if (rows[0].y0 - hit.bbox.y1 > maxGap) return null;
  const take = [rows[0]];
  if (opts.multiline) {
    for (let i = 1; i < rows.length && take.length < (opts.maxLines || 3); i++) {
      const prev = take[take.length - 1];
      if (rows[i].y0 - prev.y1 > hgt(prev) * 0.9) break;
      take.push(rows[i]);
    }
  }
  const ws = [];
  for (const r of take) {
    r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    // within a row, drop words separated by a huge gap (likely another column / stray mark)
    const rowWords = [];
    for (const w of r.words) {
      const prev = rowWords.length ? rowWords[rowWords.length - 1] : null;
      // a gap much wider than a normal space = next column (e.g. "M   1983/04/17   70")
      if (prev && w.bbox.x0 - prev.bbox.x1 > Math.max(hgt(prev.bbox), hgt(w.bbox)) * (opts.colGap || 1.8)) break;
      rowWords.push(w);
    }
    ws.push(...rowWords);
  }
  return pack(ws, 'below');
}

const _lcCache = new WeakMap();
function lineCenters(ocr) {
  if (_lcCache.has(ocr)) return _lcCache.get(ocr);
  const m = {};
  for (const ln of ocr.lines) {
    const cs = ln.words.map((w) => (w.bbox.y0 + w.bbox.y1) / 2).sort((a, b) => a - b);
    m[ln.idx] = cs[cs.length >> 1];
  }
  _lcCache.set(ocr, m);
  return m;
}

function pack(ws, where) {
  const confs = ws.map((w) => w.conf);
  return {
    text: cleanValue(ws.map((w) => w.text).join(' ')),
    words: ws,
    conf: confs.reduce((a, b) => a + b, 0) / Math.max(1, confs.length),
    minConf: Math.min(...confs),
    where,
  };
}
