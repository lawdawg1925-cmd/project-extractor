// Card-layout reading for printed ID cards (e.g. the LTO driver's license).
// On a busy security background (guilloche pattern, holograms, seal watermark) the whole-card OCR
// often loses the small printed labels, so a value is not found even though it is clearly printed.
// The card layout is fixed, so the labels that WERE read tell where every field sits:
//   1. match the labels read on the page to their printed position on the card template,
//   2. fit a scale + offset (x and y) — the fit must agree with the card's shape (ID-1, 85.6 × 54 mm)
//      and every label used must lie where the template says (no fit → nothing happens),
//   3. cut out each missing / uncertain value area and read it as one line with a character whitelist.
// A value read this way must pass the field's format check, and is ALWAYS marked VERIFY.
import { findLabel } from './layout.js';
import { readRegion } from './refine.js';
import { STATUS } from './status.js';

const sameVal = (a, b) => String(a || '').replace(/[^A-Za-z0-9+]/g, '').toUpperCase() === String(b || '').replace(/[^A-Za-z0-9+]/g, '').toUpperCase();

/** Fit card-template positions (fractions) to label hits (pixels). Returns {ax,bx,ay,by,n,err} or null. */
export function fitCard(template, ocrs, { width, height, aspect = 0.63 } = {}) {
  // candidate hits per anchor (every reading of the same image)
  const cands = [];
  for (const [key, a] of Object.entries(template.anchors)) {
    for (const ocr of ocrs) for (const lab of a.labels) for (const h of findLabel(ocr, lab, { maxDist: a.maxDist ?? 1 })) {
      const b = h.bbox;
      if (b.y1 - b.y0 > height * 0.08) continue; // a "label" spanning several lines is a misread
      cands.push({ key, tx: a.x, ty: a.y, x: b.x0, y: (b.y0 + b.y1) / 2 });
    }
  }
  if (cands.length < 3) return null;
  const solve = (pts) => {
    const lin = (u, v) => { const n = u.length, mu = u.reduce((s, x) => s + x, 0) / n, mv = v.reduce((s, x) => s + x, 0) / n;
      let suu = 0, suv = 0; for (let i = 0; i < n; i++) { suu += (u[i] - mu) ** 2; suv += (u[i] - mu) * (v[i] - mv); }
      if (suu < 1e-4) return null; const a = suv / suu; return { a, b: mv - a * mu }; };
    const X = lin(pts.map((p) => p.tx), pts.map((p) => p.x)), Y = lin(pts.map((p) => p.ty), pts.map((p) => p.y));
    return X && Y ? { ax: X.a, bx: X.b, ay: Y.a, by: Y.b } : null;
  };
  const resid = (m, p) => Math.max(Math.abs((p.x - m.bx) / m.ax - p.tx), Math.abs((p.y - m.by) / m.ay - p.ty));
  // try every model built from the readings: start from the whole-image guess, keep the nearest hit
  // per anchor, refit, drop the worst outlier while any is off by more than 2 % of the card
  let best = null;
  const starts = [{ ax: width, bx: 0, ay: height, by: 0 }];
  for (const m0 of starts) {
    let m = m0;
    for (let iter = 0; iter < 6 && m; iter++) {
      const per = new Map();
      for (const c of cands) { const r = resid(m, c); if (r > (iter === 0 ? 0.09 : 0.04)) continue; const o = per.get(c.key); if (!o || r < o.r) per.set(c.key, { ...c, r }); }
      let pts = [...per.values()];
      if (pts.length < 3) { m = null; break; }
      let fit = solve(pts);
      while (fit && pts.length > 3) {
        const worst = pts.reduce((w, p) => (resid(fit, p) > resid(fit, w) ? p : w));
        if (resid(fit, worst) <= 0.02) break;
        pts = pts.filter((p) => p !== worst); fit = solve(pts);
      }
      if (!fit) { m = null; break; }
      fit.n = pts.length; fit.err = Math.max(...pts.map((p) => resid(fit, p))); fit.keys = pts.map((p) => p.key);
      fit.rows = new Set(pts.map((p) => p.ty.toFixed(2))).size;
      m = fit;
    }
    if (!m || m.err > 0.02 || m.n < 3 || m.rows < 2) continue;
    // the fitted card must have the shape of an ID card and a sensible size
    const ratio = m.ay / m.ax;
    if (Math.abs(ratio - aspect) > 0.09 || m.ax < width * 0.35 || m.ax > width * 1.3) continue;
    if (!best || m.n > best.n || (m.n === best.n && m.err < best.err)) best = m;
  }
  return best;
}

/** Word-by-word consensus of several readings of one line. Returns { text, n (weakest word support), conf } or null. */
export function voteWords(reads) {
  const toks = reads.map((r) => String(r.fmt.value).split(/\s+/).filter(Boolean));
  const lens = new Map(); toks.forEach((t, i) => lens.set(t.length, [...(lens.get(t.length) || []), i]));
  const [, idx] = [...lens.entries()].sort((a, b) => b[1].length - a[1].length || Math.max(...b[1].map((i) => reads[i].conf)) - Math.max(...a[1].map((i) => reads[i].conf)))[0];
  if (idx.length < 2) return null;
  const support = (w) => toks.filter((t) => t.includes(w)).length;
  const out = []; let n = Infinity;
  for (let p = 0; p < toks[idx[0]].length; p++) {
    const c = idx.map((i) => ({ w: toks[i][p], s: support(toks[i][p]), conf: reads[i].conf })).sort((a, b) => b.s - a.s || b.conf - a.conf)[0];
    out.push(c.w); n = Math.min(n, c.s);
  }
  return { text: out.join(' '), n, conf: Math.max(...idx.map((i) => reads[i].conf)) };
}

/**
 * Re-read missing / uncertain fields from their position on the card.
 * fields: merged fields (mutated); defs: extractor field definitions; template: ex.cardTemplate.
 * Returns the number of fields changed.
 */
export async function readCardZones(fields, defs, template, img, ocrs, recognize, { onProgress = () => {} } = {}) {
  const m = fitCard(template, ocrs, { width: img.width, height: img.height, aspect: template.aspect });
  if (globalThis.GRX_DEBUG_ZONES) console.log('card fit', m && { ...m, ax: Math.round(m.ax), ay: Math.round(m.ay) });
  if (!m) return 0;
  let changed = 0;
  const zoneKeys = Object.keys(template.zones).filter((k) => {
    const f = fields.find((x) => x.key === k);
    return f && !f.hidden && f.status !== STATUS.OK;
  });
  if (zoneKeys.length) onProgress({ stage: 'refine', text: 'Reading fields by their place on the card…' });
  for (const key of zoneKeys) {
    const f = fields.find((x) => x.key === key), def = defs.find((d) => d.key === key), z = template.zones[key];
    const a = template.anchors[z.anchor];
    const r = { x: m.ax * (a.x + z.x0) + m.bx, y: m.ay * (a.y + z.y0) + m.by, w: m.ax * (z.x1 - z.x0), h: m.ay * (z.y1 - z.y0) };
    if (r.x < -r.w * 0.2 || r.y < -r.h * 0.2 || r.x + r.w > img.width * 1.05 || r.y + r.h > img.height * 1.05) continue;
    const zdef = { ...def, refine: { whitelist: z.whitelist ?? (def.refine && def.refine.whitelist) }, format: (s) => {
      // prep may repair the raw line using the rest of the card (returns a string, or { text, note })
      const pr = z.prep ? z.prep(s, fields) : s, t = typeof pr === 'string' ? pr : pr.text;
      const fm = (z.format || def.format)(t);
      return pr.note && fm.ok ? { ...fm, fixed: true, note: [fm.note, pr.note].filter(Boolean).join(' ') } : fm; } };
    const reads = await readRegion(img, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, zdef, recognize, { psm: z.psm || '7', grayFlat: true });
    if (globalThis.GRX_DEBUG_ZONES) console.log('zone', key, reads.map((x) => `${x.name}:${x.text}(${Math.round(x.conf)})${x.fmt.ok ? '' : '✗'}`).join(' '));
    let good = reads.filter((x) => x.fmt.ok && x.fmt.value);
    // readings the field's own check finds implausible (e.g. a "Q" not followed by "U" in a Filipino
    // name: usually a mark of the seal or hologram) are dropped when a plausible reading exists
    if (z.suspect && good.some((x) => !z.suspect(x.fmt.value))) good = good.filter((x) => !z.suspect(x.fmt.value));
    if (!good.length) continue;
    // the value most variants agree on (then the most confident)
    const groups = new Map();
    for (const g of good) { const k = String(g.fmt.value); const o = groups.get(k) || { v: g.fmt, n: 0, conf: 0, min: 100, fixed: false }; o.n++; o.conf = Math.max(o.conf, g.conf); o.min = Math.min(o.min, g.conf); o.fixed = o.fixed || g.fmt.fixed; groups.set(k, o); }
    let top = [...groups.values()].sort((p, q) => q.n - p.n || q.conf - p.conf)[0];
    // several words (name, address): vote word by word — a word counts as supported by every variant
    // that read it, so one bad letter in one variant does not sink the whole line
    if (z.vote && good.length >= 2 && (top.n < 2 || top.min < (z.minConf ?? 45))) {
      const v = voteWords(good);
      if (v && v.n >= top.n) { const fm = zdef.format(v.text); if (fm.ok) top = { v: fm, n: v.n, conf: v.conf, min: v.conf }; }
    }
    const rivals = [...groups.values()].filter((g) => String(g.v.value) !== String(top.v.value));
    // strong = most variants agree (strict formats: three agreeing variants are enough even at a low
    // Tesseract score), or one clear reading that a cross-check on the card confirms
    const strong = (top.n >= 2 && top.min >= (z.minConf ?? 45)) || (top.n >= 3 && z.strict && top.min >= 10) ||
      (top.n >= 2 && z.strict && !rivals.length && top.conf >= 30) ||
      (top.conf >= 80 && !rivals.length) || (z.confirm && top.conf >= 60 && z.confirm(top.v, fields));
    if (!strong) continue;
    const before = f.value;
    const curOk = !!(before && def.format && def.format(before).ok);
    const empty = !before || f.status === STATUS.NOT_FOUND || f.status === STATUS.UNREADABLE || !curOk;
    if (!empty) {
      if (sameVal(before, top.v.value)) continue;
      // an uncertain page reading is replaced only by a clearly better close reading
      // (or the page reading is the same line with some words missing)
      const words = (x) => String(x).toUpperCase().split(/\s+/).filter((w) => /[A-Z0-9]/.test(w));
      const tb = words(before), tv = words(top.v.value);
      const shorter = tb.length < tv.length && tb.every((w) => tv.includes(w));
      // the page reading fails a check the close reading passes (implausible letters, birthday rule)
      const fixesPage = (z.suspect && z.suspect(before) && !z.suspect(top.v.value)) ||
        (z.confirm && z.confirm(top.v, fields) && !z.confirm(def.format(before), fields));
      if (!fixesPage && !(top.n >= 2 && top.min >= 50 && (top.min > (f.confidence ?? 0) || shorter))) {
        f.note = [f.note, `A close re-read of its place on the card gave "${top.v.value}" — check it.`].filter(Boolean).join(' ');
        continue;
      }
    }
    const alt = rivals.map((g) => g.v.value).filter((v) => !sameVal(v, top.v.value));
    Object.assign(f, { value: top.v.value, raw: top.v.value, status: STATUS.VERIFY, confidence: Math.round(top.min),
      note: (empty ? 'Label or value not legible on the page reading: read from its place on the card layout' : `Read again from its place on the card layout (page reading: "${before}")`) +
        (alt.length ? ` (also read as ${alt.map((v) => `"${v}"`).join(', ')})` : '') + (top.v.note ? ` ${top.v.note}` : '') + ' — check it.' });
    if (top.v.iso) f.iso = top.v.iso;
    changed++;
  }
  return changed;
}
