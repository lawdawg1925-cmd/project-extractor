// Box-by-box OCR for ruled forms (LTO Certificate of Registration).
// Full-page OCR of a ruled form is unreliable: the rules become "|" / "_" characters, stamp ink and
// folds confuse the page-layout analysis, and a label can be glued to the value of the next box.
// Here every box enclosed by the printed rules is cut out (rules erased, neighbouring boxes masked),
// enlarged a little and read on its own as one text block. Each word keeps the id of its box, so a
// label's value is only ever taken from the label's own box. Text outside the boxes (headers,
// footers) comes from the normal full-page read.
import { analyzeTable } from './table.js';
import { crop, resize } from './image.js';

function wordsOf(data) {
  if (data.words && data.words.length) return data.words;
  return (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).flatMap((l) => l.words || [])));
}
function linesOf(data) {
  if (data.lines && data.lines.length) return data.lines;
  return (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
}

/**
 * @param img        gray, straightened table image (the image the page OCR ran on)
 * @param pageOcr    normalized full-page OCR of the same image (normalizeOcr shape)
 * @param recognize  async (img, {psm}) => tesseract data
 * @returns { data, table } where data is a tesseract-like { lines:[{words:[{text,confidence,bbox,cell}]}], text }
 *          or null when no usable boxes were found.
 */
export async function readCells(img, pageOcr, recognize, { onProgress = () => {}, maxCells = 60, passes = [{ level: 0.35, psm: '11' }, { level: 0.35, psm: '6' }] } = {}) {
  const t = analyzeTable(img);
  // a "box" much taller than a normal row is several rows whose rules were lost (fold, faint print):
  // it is read as a free band below, not as one box
  const hts = t.cells.map((c) => c.y1 - c.y0).sort((a, b) => a - b);
  const medH = hts.length ? hts[Math.floor(hts.length / 2)] : 0;
  const cells = t.cells.filter((c) => c.y1 - c.y0 <= medH * 2.6).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).slice(0, maxCells);
  if (cells.length < 6) return null;
  const W = img.width;
  // bands inside the table that no box covers: rules missing there → read those strips as free text
  const top = Math.min(...cells.map((c) => c.y0)), bottom = Math.max(...t.cells.map((c) => c.y1));
  const bands = [];
  { let b0 = -1;
    for (let y = top; y <= bottom + 1; y++) {
      let cov = 0; for (const c of cells) if (y >= c.y0 && y <= c.y1) cov += c.x1 - c.x0;
      const open = y <= bottom && cov < W * 0.5;
      if (open && b0 < 0) b0 = y;
      if (!open && b0 >= 0) { if (y - b0 > medH * 0.6) bands.push({ y0: b0, y1: y - 1 }); b0 = -1; }
    } }
  const variants = passes.map(() => []);
  let n = 0;
  for (const c of cells) {
    n++;
    onProgress({ stage: 'ocr', text: `Reading box ${n} of ${cells.length}…` });
    // a box on the table's left/right edge also takes the margin beside it: printed values often
    // overflow the outer rule ("CLE WITHOUT SIDE CAR", the first letter of a name)
    const extL = c.x0 < W * 0.08, extR = c.x1 > W * 0.92;
    const r = { x: extL ? 0 : c.x0, y: c.y0, w: (extR ? W - 1 : c.x1) - (extL ? 0 : c.x0) + 1, h: c.y1 - c.y0 + 1 };
    const valid = new Set(t.cells.map((x) => x.id));
    const im = crop(t.erased, r);
    // blank everything that is not this box (rules, parts of neighbouring boxes); gray histogram of the box
    const hist = new Uint32Array(256); let cnt = 0;
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const id = t.cellMap[(r.y + y) * W + (r.x + x)], o = (y * im.width + x) * 4, X = r.x + x;
      const margin = ((extL && X < c.x0) || (extR && X > c.x1)) && !valid.has(id);
      if (margin) continue;
      if (id !== c.id) { im.data[o] = im.data[o + 1] = im.data[o + 2] = 255; } else { hist[im.data[o]]++; cnt++; }
    }
    const pct = (q) => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= cnt * q) return v; } return 255; };
    // short text in a big box ("GAS") is well under 3% of its pixels: take the ink level from the darkest 1%
    const paper = pct(0.6);
    let dark = pct(0.03);
    if (paper - dark < 40) dark = pct(0.01);
    if (paper - dark < 40) continue; // empty box (no ink clearly darker than the paper)
    // the box is binarised (drops stamp ink / faint marks) and read twice with different Tesseract
    // page-segmentation modes (sparse text, uniform block): two independent readings to compare
    const bins = {};
    for (let k = 0; k < passes.length; k++) {
      const { level, psm } = passes[k];
      const s = globalThis.GRX_CELL_SCALE || 2, pad = 16;
      if (!bins[level]) {
        const thr = dark + level * (paper - dark);
        const b = { width: im.width, height: im.height, data: new Uint8ClampedArray(im.data) };
        if (level === 'gray') {
          // soft letters (blurry photo): keep the gray levels, stretched from ink to paper — a hard
          // threshold would break thin blurred strokes apart
          for (let i = 0; i < b.data.length; i += 4) { const g = Math.max(0, Math.min(255, (b.data[i] - dark) * 255 / Math.max(1, paper - dark))); b.data[i] = b.data[i + 1] = b.data[i + 2] = g; }
        } else for (let i = 0; i < b.data.length; i += 4) { const g = b.data[i] > thr ? 255 : 0; b.data[i] = b.data[i + 1] = b.data[i + 2] = g; }
        const big = resize(b, b.width * s, b.height * s);
        const padded = { width: big.width + 2 * pad, height: big.height + 2 * pad, data: new Uint8ClampedArray((big.width + 2 * pad) * (big.height + 2 * pad) * 4).fill(255) };
        for (let y = 0; y < big.height; y++) padded.data.set(big.data.subarray(y * big.width * 4, (y + 1) * big.width * 4), ((y + pad) * padded.width + pad) * 4);
        bins[level] = padded;
      }
      const data = await recognize(bins[level], { psm });
      const map = (bb) => ({ x0: r.x + (bb.x0 - pad) / s, y0: r.y + (bb.y0 - pad) / s, x1: r.x + (bb.x1 - pad) / s, y1: r.y + (bb.y1 - pad) / s });
      let lns = linesOf(data).map((ln) => ln.words || []);
      if (!lns.length) lns = [wordsOf(data)];
      for (const lw of lns) {
        const ws = lw.filter((w) => w.text && w.text.trim()).map((w) => ({ text: w.text, confidence: w.confidence, bbox: map(w.bbox), cell: c.id }));
        if (ws.length) variants[k].push({ words: ws, cell: c.id });
      }
    }
  }
  // free bands (no usable boxes): rules erased, binarised, read as strips without a box id
  for (const bd of bands) {
    const pad = 16, s = 2, r = { x: 0, y: Math.max(0, bd.y0 - 4), w: W, h: Math.min(img.height - 1, bd.y1 + 4) - Math.max(0, bd.y0 - 4) + 1 };
    const im = crop(t.erased, r);
    const hist = new Uint32Array(256); for (let i = 0; i < im.data.length; i += 4) hist[im.data[i]]++;
    const cnt = im.data.length / 4; const pct = (q) => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= cnt * q) return v; } return 255; };
    const paper = pct(0.6);
    let dark = pct(0.03);
    if (paper - dark < 40) dark = pct(0.01);
    if (paper - dark < 40) continue;
    for (let k = 0; k < passes.length; k++) {
      const thr = dark + passes[k].level * (paper - dark);
      const b = { width: im.width, height: im.height, data: new Uint8ClampedArray(im.data) };
      for (let i = 0; i < b.data.length; i += 4) { const g = b.data[i] > thr ? 255 : 0; b.data[i] = b.data[i + 1] = b.data[i + 2] = g; }
      const big = resize(b, b.width * s, b.height * s);
      const padded = { width: big.width + 2 * pad, height: big.height + 2 * pad, data: new Uint8ClampedArray((big.width + 2 * pad) * (big.height + 2 * pad) * 4).fill(255) };
      for (let y = 0; y < big.height; y++) padded.data.set(big.data.subarray(y * big.width * 4, (y + 1) * big.width * 4), ((y + pad) * padded.width + pad) * 4);
      onProgress({ stage: 'ocr', text: 'Reading the unruled part of the table…' });
      const data = await recognize(padded, { psm: passes[k].psm });
      const map = (bb) => ({ x0: r.x + (bb.x0 - pad) / s, y0: r.y + (bb.y0 - pad) / s, x1: r.x + (bb.x1 - pad) / s, y1: r.y + (bb.y1 - pad) / s });
      let lns = linesOf(data).map((ln) => ln.words || []);
      if (!lns.length) lns = [wordsOf(data)];
      for (const lw of lns) {
        const ws = lw.filter((w) => w.text && w.text.trim()).map((w) => ({ text: w.text, confidence: w.confidence, bbox: map(w.bbox) }));
        if (ws.length) variants[k].push({ words: ws });
      }
    }
  }
  // page words outside every box and band (title, CR No., date, footer, …)
  const inBox = (w) => { const cx = (w.bbox.x0 + w.bbox.x1) / 2, cy = (w.bbox.y0 + w.bbox.y1) / 2; return cells.some((c) => cx >= c.x0 && cx <= c.x1 && cy >= c.y0 && cy <= c.y1) || bands.some((b) => cy >= b.y0 && cy <= b.y1); };
  const outside = [];
  for (const ln of pageOcr.lines) {
    const ws = ln.words.filter((w) => !inBox(w)).map((w) => ({ text: w.text, confidence: w.conf, bbox: { ...(w.obox || w.bbox) } }));
    if (ws.length) outside.push({ words: ws });
  }
  const datas = variants.filter((v) => v.length).map((v) => {
    const lines = v.concat(outside);
    lines.sort((a, b) => Math.min(...a.words.map((w) => w.bbox.y0)) - Math.min(...b.words.map((w) => w.bbox.y0)));
    return { lines, text: lines.map((l) => l.words.map((w) => w.text).join(' ')).join('\n') };
  });
  if (!datas.length) return null;
  return { datas, table: t, cells };
}
