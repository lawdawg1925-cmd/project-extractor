// Generic field-extraction engine. Each document extractor (license.js, cr.js, …) only
// DECLARES its fields (labels, position, format); this engine does the work.
import { findLabel, readValue, normalizeOcr, deskewWords } from '../core/layout.js';
import { normToken, alnumRatio, cleanValue } from '../core/text.js';
import { STATUS, VERIFY_BELOW, UNREADABLE_BELOW } from '../core/status.js';

/** Keyword scoring used for document-type detection. Returns 0..1. */
export function keywordScore(text, keywords = [], patterns = []) {
  const flat = normToken(text);
  let total = 0, got = 0;
  const hits = [];
  for (const { k, w = 1 } of keywords) {
    total += w;
    if (flat.includes(normToken(k))) { got += w; hits.push(k); }
  }
  for (const { re, w = 1, name } of patterns) {
    total += w;
    if (re.test(text)) { got += w; hits.push(name || String(re)); }
  }
  return { score: total ? got / total : 0, hits };
}

function resolveOverlaps(hits) {
  // When two label hits share a word, keep the longer label ("Expiration Date" beats "Date").
  hits.sort((a, b) => a.dist - b.dist || normToken(b.label).length - normToken(a.label).length);
  const used = new Set();
  const keep = [];
  for (const h of hits) {
    if (h.words.some((w) => used.has(w))) continue;
    h.words.forEach((w) => used.add(w));
    keep.push(h);
  }
  return keep;
}

export function makeField(def, patch) {
  return {
    key: def.key, label: def.label, section: def.section || 'main', optional: !!def.optional, alwaysShow: !!def.alwaysShow,
    value: '', raw: '', status: STATUS.NOT_FOUND, confidence: null, note: '', ...(def.okConf ? { okConf: def.okConf } : {}), ...(def.group ? { group: def.group } : {}), ...patch,
  };
}

/**
 * Run a declarative extractor over an OCR result.
 * extractor = { fields:[{key,label,section,labels:[..],labelOpts,where,multiline,maxLines,format,fallback}], stopLabels:[..], postProcess }
 */
export function runExtractor(extractor, ocrInput) {
  const ocr = deskewWords(ocrInput.words && ocrInput.lines && ocrInput.meanConf !== undefined ? ocrInput : normalizeOcr(ocrInput));
  // 1. find every label on the page
  let all = [];
  for (const f of extractor.fields) {
    for (const lab of f.labels || []) {
      // a label is a string (uses the field's labelOpts) or { label, opts }
      const [text, opts] = typeof lab === 'string' ? [lab, f.labelOpts || {}] : [lab.label, lab.opts || {}];
      for (const h of findLabel(ocr, text, opts)) { h.field = f.key; all.push(h); }
    }
  }
  for (const lab of extractor.stopLabels || []) {
    const opts = typeof lab === 'string' ? {} : lab;
    for (const h of findLabel(ocr, opts.label || lab, opts)) { h.field = null; all.push(h); }
  }
  // words that must never become a value or a label (e.g. the LTO official's signature block, a
  // receipt printed below the form)
  const ignored = new Set(extractor.ignoreWords ? extractor.ignoreWords(ocr) : []);
  all = resolveOverlaps(all.filter((h) => !h.words.every((w) => ignored.has(w))));
  const ctx = { ocr, labelHits: all, labelWords: new Set(all.flatMap((h) => h.words)) };
  for (const w of ignored) ctx.labelWords.add(w);

  // 2. read each field
  const out = {};
  for (const f of extractor.fields) {
    if (!f.labels) continue; // derived field, filled by postProcess
    const hits = all.filter((h) => h.field === f.key).sort((a, b) => a.bbox.y0 - b.bbox.y0);
    let best = null;
    const fmtFn = f.format || ((s) => ({ ok: !!cleanValue(s), value: cleanValue(s), fixed: false, note: '' }));
    const wheres0 = f.where && f.where !== 'auto' ? [f.where] : ['right', 'below'];
    outer: for (const h of hits) {
      // try "value right of label" and "value below label"; keep the first reading that passes the
      // field's own sanity/format check (e.g. an Address must not look like "M 1983/04/17 70").
      // In a ruled box (CR) the value sits under the label, so "below" is tried first.
      const wheres = h.words[0].cell !== undefined && wheres0.length > 1 ? ['below', 'right'] : wheres0;
      for (const where of wheres) {
        const v0 = readValue(h, ctx, { where, multiline: f.multiline, maxLines: f.maxLines, maxGap: f.maxGap, colGap: f.colGap, leftSlack: f.leftSlack });
        const v = v0 && f.clean ? f.clean(v0) : v0;
        if (!v || !v.text) { if (!best) best = { hit: h, v: null }; continue; }
        const fmt = fmtFn(v.text);
        const cand = { hit: h, v, fmt };
        if (!best || !best.v || (fmt.ok && !(best.fmt && best.fmt.ok))) best = cand;
        if (fmt.ok) break outer;
      }
    }
    // nearby-pattern rescue: label found but its value is not where expected (unusual layout)
    if (f.near && best && best.hit && (!best.v || !(best.fmt && best.fmt.ok))) {
      const anchor = best && best.hit;
      const r = nearPattern(ctx, f, anchor);
      if (r) { const fmt = fmtFn(r.text); if (fmt.ok) best = { hit: anchor, v: r, fmt, near: true }; }
    }
    out[f.key] = judge(f, best, ocr);
    // remember where the value / label is (original image coordinates) for the targeted re-read pass
    const ob = (ws) => ws && ws.length ? ws.map((w) => w.obox || w.bbox).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })) : null;
    if (best && best.hit) {
      const lb = ob(best.hit.words);
      let right = Infinity;
      for (const o of all) if (o !== best.hit && o.bbox.x0 > best.hit.bbox.x1 && Math.abs(o.bbox.y0 - best.hit.bbox.y0) < (best.hit.bbox.y1 - best.hit.bbox.y0) * 0.6) right = Math.min(right, (o.words[0].obox || o.bbox).x0);
      Object.defineProperty(out[f.key], '_geo', { value: { label: lb, value: best.v ? ob(best.v.words) : null, nextLabelX: right, cell: best.hit.words[0].cell }, enumerable: false });
    }
  }
  // 3. derived fields & cross-checks
  const fields = extractor.fields.map((f) => out[f.key] || makeField(f, {}));
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  if (extractor.postProcess) extractor.postProcess(byKey, ocr);
  return { fields: extractor.fields.map((f) => byKey[f.key]), ocr };
}

/** Find words matching f.near.re (joined per OCR line) closest to the label (or anywhere if no label). */
function nearPattern(ctx, f, anchor) {
  const { re, maxDist = 12 } = f.near;
  let bestR = null, bestD = Infinity;
  for (const ln of ctx.ocr.lines) {
    const ws = ln.words.filter((w) => !ctx.labelWords.has(w));
    for (let i = 0; i < ws.length; i++) {
      for (let j = i; j < Math.min(ws.length, i + 8); j++) {
        const span = ws.slice(i, j + 1);
        const txt = span.map((w) => w.text).join(' ');
        if (!re.test(f.near.prep ? f.near.prep(txt) : txt)) continue;
        const b = { x0: span[0].bbox.x0, y0: Math.min(...span.map((w) => w.bbox.y0)), y1: Math.max(...span.map((w) => w.bbox.y1)) };
        let d = 0;
        if (anchor) {
          const lh = anchor.bbox.y1 - anchor.bbox.y0;
          d = Math.hypot((b.x0 - anchor.bbox.x0) / lh, (b.y0 - anchor.bbox.y0) / lh);
          if (b.y1 < anchor.bbox.y0 || d > maxDist) continue; // never above the label
        }
        if (d < bestD || (d === bestD && bestR && txt.length > bestR.text.length)) {
          bestD = d;
          const confs = span.map((w) => w.conf);
          bestR = { text: cleanValue(txt), words: span, conf: confs.reduce((a, c) => a + c, 0) / confs.length, minConf: Math.min(...confs), where: 'near' };
        }
      }
    }
  }
  return bestR;
}

function judge(f, best, ocr) {
  if (!best) {
    if (f.fallback) {
      const fb = f.fallback(ocr);
      if (fb && fb.value) {
        return makeField(f, { value: fb.value, raw: fb.raw || fb.value, status: STATUS.VERIFY, confidence: Math.round(fb.conf ?? 0),
          note: 'Label not read; value found by its format only — check it.' });
      }
    }
    return makeField(f, { note: 'Label not found on the image.' });
  }
  if (!best.v) {
    // ruled form: the label's own box holds nothing readable → the box is blank on the document
    if (best.hit && best.hit.words[0].cell !== undefined) return makeField(f, { status: STATUS.NOT_FOUND, note: 'Blank: nothing readable in this box — check the document.' });
    return makeField(f, { status: STATUS.UNREADABLE, note: 'Label found, but no readable value next to/below it.' });
  }
  const { v, fmt } = best;
  if (best.near) fmt.note = [fmt.note, 'Value found near the label (layout differs from the usual) — check it.'].filter(Boolean).join(' ');
  const conf = Math.round(v.minConf);
  const garbled = alnumRatio(v.text) < 0.5 || (!fmt.ok && v.conf < UNREADABLE_BELOW);
  if (garbled) {
    return makeField(f, { status: STATUS.UNREADABLE, raw: v.text, confidence: conf,
      note: `Value could not be read reliably (OCR saw "${v.text}"). Type it from the document or retake the photo.` });
  }
  // ruled box holding only a speck / stamp fragment ("AK", "7") that fails the field's format: blank
  const alnum = v.text.replace(/[^A-Za-z0-9]/g, '').length;
  if (best.hit && best.hit.words[0].cell !== undefined && ((!fmt.ok && alnum <= 2) || (v.conf < 30 && alnum <= 3 && !/^N\s*\/?\s*A$/i.test(v.text.trim())))) {
    const own = (f.labels || []).some((l) => normToken(typeof l === 'string' ? l : l.label).includes(normToken(v.text)));
    return makeField(f, { status: STATUS.NOT_FOUND, note: own ? 'Blank: nothing readable in this box — check the document.' : `Blank: only faint marks were read ("${v.text}") — check the document.` });
  }
  const notes = [];
  let status = STATUS.OK;
  if (!fmt.ok) { status = STATUS.VERIFY; notes.push(fmt.note || 'Unexpected format.'); }
  if (fmt.fixed) { status = STATUS.VERIFY; if (fmt.note && fmt.ok) notes.push(fmt.note); }
  else if (fmt.ok && fmt.note) notes.push(fmt.note);
  if (conf < (f.verifyBelow ?? VERIFY_BELOW)) { status = STATUS.VERIFY; notes.push(`Low OCR confidence (${conf}%).`); }
  else if (f.okConf && conf < f.okConf && status === STATUS.OK) { status = STATUS.VERIFY; notes.push(`No fixed format — check each character (OCR ${conf}%).`); }
  const field = makeField(f, { value: fmt.value, raw: v.text, status, confidence: conf, note: notes.join(' ') });
  if (fmt.iso) field.iso = fmt.iso;
  return field;
}

const RANK = { [STATUS.OK]: 3, [STATUS.VERIFY]: 2, [STATUS.UNREADABLE]: 1, [STATUS.NOT_FOUND]: 0 };
// same letters/digits AND the same separators that change meaning ("7/8" ≠ "78", "1.5G" ≠ "1.5 G")
const sigVal = (v) => String(v).toUpperCase().replace(/[^A-Z0-9\/\-. ]/g, '').replace(/\.(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
const sameVal = (a, b) => normToken(a) === normToken(b) && sigVal(a) === sigVal(b);

/**
 * Combine the field lists of several independent readings of the same document (e.g. two
 * binarisations of each CR box). Agreement is required for OK: a value read the same way twice with
 * a valid format stays OK; if the readings differ, the better one is kept and marked [VERIFY].
 * A field that is NOT FOUND / N/A in every reading stays so. Nothing is invented.
 */
export function mergeReads(reads, { fallback = null } = {}) {
  const merged = reads.length === 1 ? reads[0] : mergeBoxReads(reads);
  if (!fallback) return merged;
  // the whole-page reading: only fills a field whose label no box reading found (never a blank box),
  // or settles a disagreement between the box readings; always [VERIFY]
  return merged.map((f, i) => {
    const p = fallback[i];
    if (!p || p.key !== f.key || !p.value || f.hidden || (p.status !== STATUS.OK && p.status !== STATUS.VERIFY)) return f;
    const keepGeo = (o) => { if (f._geo || p._geo) Object.defineProperty(o, '_geo', { value: f.value ? f._geo : p._geo, enumerable: false }); return o; };
    if (!f.value && (/^Label not found/.test(f.note || '') || f.status === STATUS.UNREADABLE)) {
      return keepGeo({ ...p, status: STATUS.VERIFY, note: [p.note, 'Read from the whole-page text (the box reading failed) — check it.'].filter(Boolean).join(' ') });
    }
    const pageSure = p.status === STATUS.OK && (p.confidence ?? 0) >= 85;
    if (f.value && pageSure && !sameVal(f.value, p.value)) {
      // a confident whole-page reading disagrees: never OK; an uncertain box value gives way to it
      // only the spacing differs ("1.5G" / "1.5 G"): OCR drops spaces far more often than it adds them
      const spaces = (v) => (String(v).match(/\s/g) || []).length;
      if (f.status === STATUS.OK && normToken(f.value) === normToken(p.value) && spaces(p.value) > spaces(f.value)) {
        return keepGeo({ ...p, status: STATUS.VERIFY, note: `Spacing differs between readings (box read "${f.value}") — check it.` });
      }
      if (f.status === STATUS.OK) return keepGeo({ ...f, status: STATUS.VERIFY, note: [f.note, `The whole-page reading gave "${p.value}" — check it.`].filter(Boolean).join(' ') });
      return keepGeo({ ...p, status: STATUS.VERIFY, note: `Box reading "${f.value}" was uncertain; the whole-page reading gave this — check it.` });
    }
    if (f.value && /Readings differ/.test(f.note || '')) {
      const alt = reads.map((r) => r[i]).find((x) => x && x.value && sameVal(x.value, p.value));
      if (alt && !sameVal(alt.value, f.value)) return keepGeo({ ...alt, status: STATUS.VERIFY, note: `Readings differ (also read as "${f.value}"); the whole-page reading agrees with this one — check it.` });
    }
    return f;
  });
}

function mergeBoxReads(reads) {
  return reads[0].map((f0, i) => {
    const all = reads.map((r) => r[i]).filter(Boolean);
    const withVal = all.filter((f) => f.value);
    if (!withVal.length) { const f = all.slice().sort((a, b) => RANK[b.status] - RANK[a.status] || (/^Blank/.test(b.note || '') ? 1 : 0) - (/^Blank/.test(a.note || '') ? 1 : 0))[0]; return f; }
    // one reading saw a blank box, the others only weak marks (stamp ink, specks): blank
    const blank = all.find((f) => !f.value && /^Blank/.test(f.note || ''));
    const weak = (f) => f.status !== STATUS.OK && ((f.confidence ?? 0) < 30 || String(f.value).replace(/[^A-Za-z0-9]/g, '').length <= 2);
    if (blank && withVal.every(weak)) {
      return { ...blank, note: `Blank: only faint marks were read (${withVal.map((f) => `"${f.value}"`).join(', ')}) — check the document.` };
    }
    withVal.sort((a, b) => RANK[b.status] - RANK[a.status] || (b.confidence ?? 0) - (a.confidence ?? 0));
    let top = withVal[0];
    // a reading that contains another one in full is more complete (e.g. a first letter cut off by a box edge)
    const longer = withVal.find((f) => f !== top && f.status !== STATUS.UNREADABLE && normToken(f.value).length > normToken(top.value).length && normToken(f.value).endsWith(normToken(top.value)));
    if (longer) top = { ...longer, status: STATUS.VERIFY };
    const agree = withVal.filter((f) => sameVal(f.value, top.value));
    const out = { ...top };
    if (top._geo) Object.defineProperty(out, '_geo', { value: top._geo, enumerable: false });
    if (agree.length >= 2) {
      // two readings agree with decent confidence: a low-confidence-only VERIFY becomes OK; format problems stay VERIFY
      const lowOnly = agree.every((f) => f.status === STATUS.OK || /^(Low OCR confidence|No fixed format)[^.]*\.$/.test(f.note || ''));
      if (top.status === STATUS.VERIFY && lowOnly && Math.min(...agree.map((f) => f.confidence ?? 0)) >= (top.okConf || 85)) { out.status = STATUS.OK; out.note = 'Two independent readings agree.'; }
    } else if (withVal.length >= 2 || (all.length >= 2 && top.status === STATUS.OK && all.some((f) => f !== top && f.status !== STATUS.NOT_FOUND))) {
      const others = withVal.filter((f) => !sameVal(f.value, top.value)).map((f) => `"${f.value}"`);
      if (out.status === STATUS.OK) out.status = STATUS.VERIFY;
      if (others.length) out.note = [out.note, `Readings differ (also read as ${others.join(', ')}) — check it.`].filter(Boolean).join(' ');
    }
    return out;
  });
}
