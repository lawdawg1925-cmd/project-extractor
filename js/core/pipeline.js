// The full extraction pipeline, independent of browser/Node:
// preprocess → OCR (with rotation retry) → detect document type → map fields → validate.
import { preprocess, rotate90, crop, restorePhoto, docQuality } from './image.js';
import { normalizeOcr, horizontalRatio } from './layout.js';
import { warpQuad, isFullImage } from './quad.js';
import { detectOutline } from './table.js';
import { readCells } from './cellocr.js';
import { mergeReads } from '../extractors/base.js';
import { buildMessages } from './validate.js';
import { refineFields, refineCrNo } from './refine.js';
import * as registry from '../extractors/registry.js';

/**
 * @param {object} image  ImageData-like {width,height,data}
 * @param {object} opts   { recognize: async (imageData) => tesseractData, docType: 'auto'|'license'|'cr', onProgress }
 */
export async function extractDocument(image, { recognize, docType = 'auto', onProgress = () => {}, corners, outlineMethod = null } = {}) {
  const t0 = Date.now();
  // Document boundary + perspective correction. corners: undefined = auto-detect, null = use whole image,
  // [TL,TR,BR,BL] = use these (e.g. adjusted by the user on the preview).
  let quad = null;
  if (corners === undefined) {
    onProgress({ stage: 'detect', text: 'Finding the document edges…' });
    const q = detectOutline(image, { docType });
    if (q && q.confidence >= 0.6) { quad = q.corners; outlineMethod = q.method; }
  } else if (corners) quad = corners;
  const original = image;
  if (quad && !isFullImage(quad, image.width, image.height)) {
    image = warpQuad(image, quad, { maxSide: 2600 });
  } else quad = null;
  const straightened = !!quad;
  // a ruled table (CR) was found and straightened: read it larger and ignore yellow stamp ink
  const tableLock = straightened && outlineMethod === 'table' && docType !== 'license';
  const attempts = [];
  const restoredCache = new Map();
  const restoredOf = (src, rot) => {
    const key = `${rot}|${src.width}x${src.height}`;
    if (!restoredCache.has(key)) restoredCache.set(key, restorePhoto(src));
    return restoredCache.get(key);
  };
  const run = async (rot, mode, label) => {
    onProgress({ stage: 'ocr', text: label });
    // 'restored': a dim / blurry / low-resolution photo (cheap phone camera) is cleaned first —
    // upscaled, denoised, lighting evened out and sharpened — then read like a normal photo
    let src = rot ? rotate90(image, rot) : image;
    if (mode === 'restored') src = restoredOf(src, rot);
    const img = preprocess(src, { mode: mode === 'restored' ? 'standard' : mode, stampFree: tableLock, target: tableLock ? 2600 : 2000 });
    const data = await recognize(img);
    const ocr = normalizeOcr(data);
    const det = registry.detect(ocr.text);
    const wantScore = docType === 'auto' ? det[0].score : (det.find((d) => d.id === docType) || { score: 0 }).score;
    // Tesseract can read sideways text but then the word boxes are sideways too, which breaks the
    // label/column mapping — so an upright layout (words wider than tall) is required.
    const upright = horizontalRatio(ocr);
    const quality = (ocr.meanConf * Math.min(1, ocr.words.length / 15) + 60 * wantScore) * (upright >= 0.6 ? 1 : 0.3);
    const a = { rot, mode, ocr, det, quality, img, upright };
    attempts.push(a);
    return a;
  };
  const good = (a) => a.upright >= 0.6 && a.ocr.meanConf >= 75 && (docType === 'auto' ? a.det[0].score : a.det.find((d) => d.id === docType).score) >= 0.35;

  let best = await run(0, 'standard', 'Reading text…');
  const dq = docQuality(image);
  if (!good(best) && dq.low && !globalThis.GRX_NO_RESTORE) {
    const a = await run(0, 'restored', 'Cleaning up a dim or blurry photo…');
    if (a.quality > best.quality) best = a;
  }
  if (!good(best)) {
    // words already lie horizontally (upright or upside down): only the 180° turn is worth a try
    const rots = best.upright >= 0.8 && best.ocr.words.length >= 20 ? [2] : [1, 3, 2];
    for (const rot of rots) {
      const a = await run(rot, 'standard', `Trying rotation ${rot * 90}°…`);
      if (a.quality > best.quality) best = a;
      if (good(best)) break;
    }
  }
  if (best.ocr.meanConf < 70) {
    const a = await run(best.rot, 'enhanced', 'Enhancing a difficult photo…');
    if (a.quality > best.quality) best = a;
  }

  // A CR photographed together with the OFFICIAL RECEIPT printed below it: the receipt's rules join
  // the table outline. Trim the outline just above the CR's legal footer and read the table again,
  // larger (the receipt and the signature block are never read).
  let receiptCut = false;
  if (tableLock && best.rot === 0 && quad) {
    const H = best.img.height;
    const lines = best.ocr.lines.map((l) => ({ t: l.words.map((w) => w.text).join(' '), y0: Math.min(...l.words.map((w) => (w.obox || w.bbox).y0)), ym: l.words.map((w) => (w.obox || w.bbox).y0).sort((p, q) => p - q)[Math.floor(l.words.length / 2)] }));
    const rec = lines.filter((l) => l.y0 > H * 0.4 && /OFFICIAL\s*RECEIPT|RECEIVED\s*FROM|\(Last\s*name|B?REAKDOWN\s*OF|PAYMENT\s*DETAILS|Office\s*Code|Republi\S*\s+\S*\s*\S*\s*Philippines/i.test(l.t) && !/proof|accompan|unautho/i.test(l.t)).sort((a, b) => a.y0 - b.y0)[0];
    if (rec) {
      receiptCut = true;
      const foot = lines.filter((l) => l.y0 > H * 0.3 && l.y0 < rec.y0 && /certify|authori[sz]e|REGISTRANT|alteration|erasure|This\s+is\s+t/i.test(l.t)).sort((a, b) => a.y0 - b.y0)[0];
      const cutY = foot ? foot.ym + H * 0.015 : rec.y0 - H * 0.12; // the footer text itself is ignored later
      const f = Math.min(1, Math.max(0.3, cutY / H));

      if (f < 0.9) {
        // crop the straightened image (same pixels; the warp never enlarges)
        image = crop(image, { x: 0, y: 0, w: image.width, h: Math.round(image.height * f) });
        best = await run(0, best.mode, 'Reading the CR table…');
      }
    }
  }

  onProgress({ stage: 'map', text: 'Organizing fields…' });
  const det = best.det;
  let id = docType;
  if (docType === 'auto') id = det[0].score >= registry.MIN_DETECT_SCORE ? det[0].id : 'unknown';
  // a ruled table was locked but the page read is too poor to name the document: read the boxes and
  // decide from their text (only a ruled-form extractor can use them)
  // soft / low-resolution photo: the second box reading keeps the gray levels instead of a hard
  // black/white threshold (which breaks blurred letters apart)
  const cellPasses = dq.low && !globalThis.GRX_NO_GRAYCELL ? [{ level: 0.35, psm: '11' }, { level: 'gray', psm: '6' }] : undefined;
  let preCells = null, byLayout = false;
  const withCells = (o, cr, img) => { o.cells = cr.cells; o.tableWidth = img.width; return o; };
  if (id === 'unknown' && tableLock) {
    try {
      const cr = await readCells(best.img, best.ocr, recognize, { onProgress, passes: cellPasses });
      if (cr) {
        const d2 = registry.detect(cr.datas.map((d) => d.text || '').join('\n'));
        if (d2[0].score >= registry.MIN_DETECT_SCORE && registry.get(d2[0].id).useGrid) { id = d2[0].id; preCells = cr; }
        else {
          // labels unreadable (blurry / low-resolution photo): recognise the form by its printed box layout
          for (const ex of registry.list()) {
            if (!ex.useGrid || !ex.matchTable) continue;
            if (cr.datas.some((d) => ex.matchTable(withCells(normalizeOcr(d), cr, best.img)))) { id = ex.id; preCells = cr; byLayout = true; break; }
          }
        }
      }
    } catch (e) { console.warn('box reading failed', e); }
  }
  const base = { photo: { dim: dq.dim, small: dq.small, blurry: dq.blurry }, detection: det, rawText: best.ocr.text, meanConf: Math.round(best.ocr.meanConf), rotation: best.rot * 90, mode: best.mode,
    attempts: attempts.length, ms: Date.now() - t0, processedImage: best.img, straightened };
  if (id === 'unknown') {
    return { ...base, docType: 'unknown', docLabel: 'Unknown / unsupported document', fields: [],
      messages: [{ level: 'error', text: 'Document type not recognized. Choose "Driver\'s License" or "CR" in Step 2 and extract again, or retake the photo so the whole document is visible.' }] };
  }
  const ex = registry.get(id);
  // ruled forms (CR): read box by box (two binarisations); each word knows its box, so values never
  // cross a box border. The two readings are compared field by field.
  let ocrIn = best.ocr, boxes = 0, fields = null, cellList = null;
  if (ex.useGrid && tableLock) {
    try {
      const cr = preCells || await readCells(best.img, best.ocr, recognize, { onProgress, passes: cellPasses });
      if (cr) {
        const reads = cr.datas.map((d) => ex.extract(withCells(normalizeOcr(d), cr, best.img)).fields);
        fields = mergeReads(reads, { fallback: ex.extract(best.ocr).fields });
        ocrIn = normalizeOcr(cr.datas[0]); boxes = cr.cells.length; cellList = cr.cells;
      }
    } catch (e) { console.warn('box reading failed', e); fields = null; }
  }
  if (!fields) {
    // several readings of the same photo (normal / cleaned-up / high-contrast) see different fields
    // on a poor photo: combine them field by field (readings that disagree are marked VERIFY)
    const same = attempts.filter((a) => a !== best && a.rot === best.rot && a.upright >= 0.6 && a.img.width === best.img.width && a.img.height === best.img.height &&
      (a.det.find((d) => d.id === id) || { score: 0 }).score > 0);
    fields = ex.extract(ocrIn).fields;
    if (same.length && ocrIn === best.ocr) fields = mergeReads(preferValid([fields, ...same.map((a) => ex.extract(a.ocr).fields)], ex.fields));
  }
  onProgress({ stage: 'refine', text: 'Double-checking uncertain numbers…' });
  const refined = await refineFields(fields, ex.fields, best.img, recognize, { cells: cellList });
  if (ex.useGrid) { try { await refineCrNo(fields, ex.fields, best.img, { words: [...ocrIn.words, ...(ocrIn === best.ocr ? [] : best.ocr.words)] }, recognize); } catch (e) { console.warn('CR No. re-read failed', e); } }
  // the header (Field Office / Office Code / date) and the CR No. line sit just outside the ruled table:
  // read a thin strip above it (and one just below it when no receipt is attached) for those only
  if (ex.useGrid && tableLock && quad && best.rot === 0) {
    try { await readOutside(original, quad, fields, ex, recognize, { below: !receiptCut }); } catch (e) { console.warn('header strip failed', e); }
  }
  if (ex.postRefine) ex.postRefine(Object.fromEntries(fields.map((f) => [f.key, f])));
  if (boxes) { base.boxes = boxes; base.rawText = ocrIn.text; base.meanConf = Math.round(Math.max(base.meanConf, ocrIn.meanConf)); }
  const result = { ...base, docType: id, docLabel: ex.label, sectionTitles: ex.sectionTitles, fields, refined, ms: Date.now() - t0 };
  if (docType !== 'auto' && det[0].id !== id && det[0].score > 0.35) {
    result.mismatch = `This looks more like a ${det[0].label}. Check the document type in Step 2.`;
  }
  result.messages = buildMessages(result, ex);
  if (result.mismatch) result.messages.unshift({ level: 'warn', text: result.mismatch });
  if (byLayout) result.messages.unshift({ level: 'warn', text: 'The printed labels were too small or blurry to read, so the CR was recognised by its box layout. Check every field against the document.' });
  return result;
}

// Readings of the same field from several image variants: a value that fails the field's format check
// ("J" for Sex) gives way to one that passes it ("M"); the merge then compares the remaining readings.
function preferValid(reads, defs) {
  const valid = (f) => { const d = defs.find((x) => x.key === f.key); try { return !!(f.value && d && d.format && d.format(f.value).ok); } catch { return false; } };
  return reads.map((r) => r.map((f, i) => {
    if (!f || !f.value || valid(f)) return f;
    if (!reads.some((o) => o[i] && o[i] !== f && valid(o[i]))) return f;
    const g = { ...f, value: '', status: STATUS_NF, note: 'Label not found on the image.' };
    if (f._geo) Object.defineProperty(g, '_geo', { value: f._geo, enumerable: false });
    return g;
  }));
}
const STATUS_NF = 'NOT FOUND';

// Extend the table outline upward (or downward) along its side edges, straighten that strip and read
// only the fields printed outside the table. Values found there are always VERIFY.
const OUTSIDE = { top: ['field_office', 'office_code', 'date_registered', 'cr_no'], bottom: ['cr_no'] };
async function readOutside(img, q, fields, ex, recognize, { below }) {
  const [tl, tr, br, bl] = q;
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x <= img.width - 1 && p.y <= img.height - 1;
  const fit = (a, b, want) => { let t = want; while (t > 0.04 && !inside(lerp(a, b, -t))) t -= 0.02; return t; };
  const jobs = [];
  const tTop = Math.min(fit(tl, bl, 0.3), fit(tr, br, 0.3));
  if (tTop > 0.05) jobs.push({ side: 'top', quad: [lerp(tl, bl, -tTop), lerp(tr, br, -tTop), lerp(tr, br, 0.02), lerp(tl, bl, 0.02)] });
  if (below) {
    const tBot = Math.min(fit(bl, tl, 0.3), fit(br, tr, 0.3));
    if (tBot > 0.05) jobs.push({ side: 'bottom', quad: [lerp(bl, tl, 0.02), lerp(br, tr, 0.02), lerp(br, tr, -tBot), lerp(bl, tl, -tBot)] });
  }
  for (const job of jobs) {
    const want = OUTSIDE[job.side].filter((k) => { const f = fields.find((x) => x.key === k); return f && f.status === 'NOT FOUND'; });
    if (!want.length) continue;
    const strip = warpQuad(img, job.quad, { maxSide: 2600 });
    const data = await recognize(preprocess(strip, { mode: 'standard', target: 2000 }));
    const got = ex.extract(normalizeOcr(data)).fields;
    for (const k of want) {
      const g = got.find((x) => x.key === k); const f = fields.find((x) => x.key === k);
      if (!g || !g.value || (g.status !== 'OK' && g.status !== 'VERIFY')) continue;
      Object.assign(f, { value: g.value, raw: g.raw, status: 'VERIFY', confidence: g.confidence,
        note: `Read from the ${job.side === 'top' ? 'header above' : 'line below'} the table — check it.` });
    }
  }
}
