// Low-end camera support: photo quality check, photo restoration, rule-gap closing and the CR
// box-layout fallback. Synthetic images / hand-made OCR words only (no real documents, no OCR engine).
import cr, { matchLayout } from '../app/js/extractors/cr.js';
import { docQuality, restorePhoto, photoQuality } from '../app/js/core/image.js';
import { analyzeTable } from '../app/js/core/table.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };

// ---------- synthetic "document" images
function page(w, h, { paper = 240, ink = 30 } = {}) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = paper; d[i * 4 + 3] = 255; }
  const img = { width: w, height: h, data: d };
  // rows of "letters": small dark blocks with gaps, like printed text
  const lh = Math.max(4, Math.round(h / 40));
  for (let y = lh * 2; y < h - lh * 2; y += lh * 3) for (let x = Math.round(w * 0.05); x < w * 0.95; x += Math.round(lh * 0.9)) {
    if ((x / lh | 0) % 7 === 6) continue; // word gap
    for (let yy = y; yy < y + lh; yy++) for (let xx = x; xx < x + Math.round(lh * 0.55); xx++) { const i = (yy * w + xx) * 4; d[i] = d[i + 1] = d[i + 2] = ink; }
  }
  return img;
}
function boxBlur(img, r) {
  const { width: w, height: h, data: s } = img, o = new Uint8ClampedArray(s);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0, n = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); a += s[(yy * w + xx) * 4]; n++; }
    const i = (y * w + x) * 4; o[i] = o[i + 1] = o[i + 2] = a / n;
  }
  return { width: w, height: h, data: o };
}

{
  const sharp = page(2000, 1400);
  const q = docQuality(sharp);
  eq('sharp, bright, large photo is not low quality', q.low, false);
  const dim = page(2000, 1400, { paper: 110, ink: 15 });
  eq('dim photo detected', docQuality(dim).dim, true);
  eq('small photo detected', docQuality(page(900, 630)).small, true);
  eq('blurry photo detected', docQuality(boxBlur(sharp, 6)).blurry, true);
  // restoration: dim paper becomes light, ink stays dark, nothing is drawn in
  const r = restorePhoto(dim);
  const rq = photoQuality(r);
  eq('restored paper is bright', rq.paper >= 200, true);
  eq('restored ink stays dark', rq.ink <= 90, true);
  const small = restorePhoto(page(800, 560));
  eq('small photo is upscaled for reading', Math.max(small.width, small.height) >= 1600, true);
  // a blank page stays blank (restoration never adds text)
  const blank = restorePhoto(page(1200, 800, { paper: 120, ink: 120 }));
  eq('blank page stays blank', photoQuality(blank).contrast < 30, true);
}

// ---------- ruled table with gaps at every crossing (blurry photo) → boxes still separated
{
  const W = 1600, H = 1000, d = new Uint8ClampedArray(W * H * 4).fill(245);
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  const dark = (x, y) => { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 40; };
  const rowsY = [0, 200, 400, 600, 800, 999], colsX = [0, 400, 800, 1200, 1599], gapPx = 14, t = 3;
  for (const y of rowsY) for (let x = 0; x < W; x++) { if (colsX.some((cx) => Math.abs(cx - x) < gapPx && cx > 0 && cx < W - 1)) continue; for (let k = 0; k < t; k++) dark(x, Math.min(H - 1, Math.max(0, y + k - 1))); }
  for (const x of colsX) for (let y = 0; y < H; y++) { if (rowsY.some((ry) => Math.abs(ry - y) < gapPx && ry > 0 && ry < H - 1)) continue; for (let k = 0; k < t; k++) dark(Math.min(W - 1, Math.max(0, x + k - 1)), y); }
  const tbl = analyzeTable({ width: W, height: H, data: d });
  eq('gapped grid: 5 rows × 4 boxes found', tbl.cells.length, 20);
}

// ---------- CR box-layout fallback (labels unreadable)
function fakeCells(values, garbleLabels = true) {
  // new (Dec 2020) layout: 5 rows × 4 boxes, then owner / address / encumbered / first registration rows
  const W = 2600, rowH = 150, cells = [], lines = [];
  let id = 0;
  const rows = [
    ['plate_no', 'engine_no', 'chassis_no', 'vin'], ['mv_file_no', 'vehicle_type', 'vehicle_category', 'make'],
    ['passenger_capacity', 'color', 'fuel', 'classification'], ['body_type', 'series', 'gross_wt', 'net_wt'],
    ['year_model', 'year_rebuilt', 'piston_displacement', 'max_power'], ['owner_name'], ['owner_address'], ['encumbered_to'],
    ['details', 'or_no', 'or_date', 'amount'],
  ];
  rows.forEach((row, r) => row.forEach((key, c) => {
    const n = row.length, x0 = Math.round((c / n) * W) + 6, x1 = Math.round(((c + 1) / n) * W) - 6, y0 = 160 + r * rowH, y1 = y0 + rowH - 10;
    cells.push({ id, x0, y0, x1, y1 });
    // the tiny label line: unreadable garbage
    lines.push({ words: [{ text: garbleLabels ? 'xq' : key.toUpperCase(), confidence: 20, bbox: { x0: x0 + 8, y0: y0 + 6, x1: x0 + 60, y1: y0 + 24 }, cell: id }] });
    const v = values[key];
    if (v) lines.push({ words: v.split(' ').map((t, k) => ({ text: t, confidence: 88, bbox: { x0: x0 + 120 + k * 160, y0: y0 + 60, x1: x0 + 260 + k * 160, y1: y0 + 100 }, cell: id })) });
    id++;
  }));
  return { cells, data: { lines, text: lines.map((l) => l.words.map((w) => w.text).join(' ')).join('\n') }, W };
}
const VALUES = { plate_no: 'ABC1234', mv_file_no: '0517-00000123456', vehicle_type: 'UTILITY VEHICLE', vehicle_category: 'M1', make: 'TOYOTA',
  passenger_capacity: '7', color: 'WHITE', fuel: 'DIESEL', classification: 'PRIVATE', body_type: 'SUV', series: 'FORTUNER', gross_wt: '2500', net_wt: '1900',
  year_model: '2019', year_rebuilt: 'N/A', piston_displacement: '2393', owner_name: 'DELA CRUZ, JUAN SANTOS', or_no: '123456789012345', or_date: '01/15/2019', amount: '1,234.56' };
const { normalizeOcr } = await import('../app/js/core/layout.js');
{
  const f = fakeCells(VALUES);
  const o = normalizeOcr(f.data); o.cells = f.cells; o.tableWidth = f.W;
  const m = matchLayout(o);
  eq('layout matched from box positions', m && m.layout, 'new');
  const o2 = normalizeOcr(f.data); o2.cells = f.cells; o2.tableWidth = f.W;
  const r = Object.fromEntries(cr.extract(o2).fields.map((x) => [x.key, x]));
  eq('fuel by position', r.fuel.value, 'DIESEL');
  eq('fuel by position is VERIFY', r.fuel.status, 'VERIFY');
  eq('year by position', r.year_model.value, '2019');
  eq('make by position', r.make.value, 'TOYOTA');
  eq('MV file by position', r.mv_file_no.value, '0517-00000123456');
  eq('no value from layout is OK', Object.values(r).filter((x) => /box position/.test(x.note || '') && x.status === 'OK').length, 0);
  eq('empty box stays empty', r.max_power.value, '');
}
{
  // same boxes but nothing that looks like CR values → no layout match (no guessing)
  const junk = Object.fromEntries(Object.keys(VALUES).map((k) => [k, 'ZQX WVK']));
  const f = fakeCells(junk);
  const o = normalizeOcr(f.data); o.cells = f.cells; o.tableWidth = f.W;
  eq('random text in boxes: no layout match', matchLayout(o), null);
  // too few boxes → no match
  const g = fakeCells(VALUES);
  const o3 = normalizeOcr(g.data); o3.cells = g.cells.slice(0, 5); o3.tableWidth = g.W;
  eq('too few boxes: no layout match', matchLayout(o3), null);
}

// ---------- license: a misread "License No." label glued to the address is cut off (and flagged)
{
  const license = (await import('../app/js/extractors/license.js')).default;
  const { fromPlainText } = await import('../app/js/core/layout.js');
  const a = license.extract(fromPlainText("DRIVER'S LICENSE\nAddress\n123 MAGSAYSAY AVENUE, NAGA CITY\nCAMARINES SUR UCENSE NO.\nE12-79-001234")).fields.find((x) => x.key === 'address');
  eq('address: misread label removed', a.value, '123 MAGSAYSAY AVENUE, NAGA CITY CAMARINES SUR');
  eq('address: flagged VERIFY', a.status, 'VERIFY');
}

console.log(`\nLow-end camera tests: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
