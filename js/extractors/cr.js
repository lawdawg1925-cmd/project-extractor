// LTO Certificate of Registration (CR) extractor.
// Handles both printed layouts:
//   old  – LTO Form No. 3 (grid: Denomination, No. of Cylinders, Body No., Shipping Wt., Net Capacity,
//          Telephone No.; CR No. printed at the top)
//   new  – LTO Form No. 3 (Revised December 2020) (Vehicle Type / Category, Make/Brand, Color,
//          Classification, Passenger Capacity, Year Rebuilt, Max Power, VIN, Remarks; CR No. at the bottom)
// The field list is the union of both forms in the form's own order. A field the detected layout does
// not print is hidden (it is not reported as "not found").
import { keywordScore, makeField, runExtractor } from './base.js';
import * as F from '../core/formats.js';
import { STATUS } from '../core/status.js';
import { normToken, levenshtein, cleanValue } from '../core/text.js';

const NOW = new Date().getFullYear();
const MV_RE = /\b\d{4}\s?-\s?\d{11}\b/;
const NA_RE = /^(N\s*\/\s*A|NA|N\.A\.?)$/i;

/** "N/A" printed in a box is a real value (kept as N/A, OK). */
const na = (fmt) => (s) => (NA_RE.test(cleanValue(s)) ? { ok: true, value: 'N/A', fixed: false, note: 'Printed as N/A on the CR.' } : fmt(s));
const res = (ok, value, fixed = false, note = '') => ({ ok, value, fixed, note });
/** Series/model: a bracket or bar stuck to a model number is almost always a letter I ("125]" → "125I"). */
function seriesText(raw) {
  const s = cleanValue(raw);
  const t = s.replace(/(?<=[A-Za-z0-9])[\]\[|](?=\s|$)/g, 'I');
  const r = F.text(t);
  return t !== s && r.ok ? { ...r, fixed: true, note: `Read as "${s}"; a stray bracket was taken as the letter I — check it.` } : r;
}

/** Value from a known list; a near-miss (1-2 letters off, e.g. MOTORCYGLE) is corrected and marked VERIFY. */
function known(list, what) {
  return (raw) => {
    const s = cleanValue(raw).toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
    if (!s) return res(false, s, false, '');
    if (list.includes(s)) return res(true, s);
    const t = normToken(s);
    let best = null, bd = 99;
    for (const k of list) { const d = levenshtein(t, normToken(k)); if (d < bd) { bd = d; best = k; } }
    if (best && bd <= Math.max(1, Math.floor(normToken(best).length / 6))) return res(true, best, true, `Read as "${s}", corrected to "${best}" — check it.`);
    return res(false, s, false, `Unusual ${what} — check it.`);
  };
}

const BODY_TYPES = ['MOTORCYCLE', 'SCOOTER', 'TRICYCLE', 'SEDAN', 'HATCHBACK', 'COUPE', 'CONVERTIBLE', 'WAGON', 'STATION WAGON', 'VAN', 'MINIVAN', 'MPV', 'SUV',
  'UTILITY VEHICLE', 'UTILITY VEHICLE PICK-UP', 'PICK-UP', 'PICKUP', 'JEEP', 'JEEPNEY', 'AUV', 'BUS', 'MINI BUS', 'TRUCK', 'DUMP TRUCK', 'TRACTOR', 'TRAILER',
  'CAB AND CHASSIS', 'CAB & CHASSIS', 'TANKER', 'AMBULANCE', 'FIRE TRUCK', 'MULTICAB', 'E-TRIKE', 'E-BIKE', 'SIDECAR', 'UNDERBONE', 'OFF-ROAD'];
const VEHICLE_TYPES = ['MOTORCYCLE', 'TRICYCLE', 'CAR', 'UTILITY VEHICLE', 'SPORTS UTILITY VEHICLE', 'SUV', 'TRUCK', 'BUS', 'TRAILER', 'TRUCK BUS', 'JEEPNEY',
  'VAN', 'PICK-UP', 'TRACTOR', 'MC', 'MC/TC', 'E-TRIKE', 'NON-CONVENTIONAL MC'];
const FUELS = ['GAS', 'GASOLINE', 'DIESEL', 'ELECTRIC', 'HYBRID', 'LPG', 'CNG', 'BIO-DIESEL', 'E-GAS', 'GAS/LPG', 'GAS-ELECTRIC', 'DIESEL-ELECTRIC'];
const CLASSES = ['PRIVATE', 'FOR HIRE', 'GOVERNMENT', 'EXEMPT', 'DIPLOMATIC', 'PUBLIC UTILITY'];
const DENOMS = ['MOTORCYCLE WITHOUT SIDE CAR', 'MOTORCYCLE WITH SIDE CAR', 'MOTORCYCLE', 'TRICYCLE', 'CAR', 'MC', 'UTILITY VEHICLE', 'TRUCK', 'BUS', 'TRAILER', 'JEEPNEY', 'SUV'];

function denomination(raw) {
  const s = cleanValue(raw).toUpperCase().replace(/\s+/g, ' ');
  if (!s) return res(false, s, false, '');
  const k = known(DENOMS, 'denomination')(s);
  if (k.ok) return k;
  // text overflowing the box's left edge is often cut on the photo ("CLE WITHOUT SIDE CAR")
  const ns = s.replace(/[^A-Z]/g, '');
  const full = DENOMS.find((d) => d.length > s.length && d.endsWith(s) && s.length >= 6) ||
    DENOMS.find((d) => { const nd = d.replace(/[^A-Z]/g, ''); return nd.length > ns.length && ns.length >= 8 && nd.endsWith(ns); });
  if (full) {
    // spaces lost by the OCR but every letter of the end of a known denomination is there: restore the spacing
    const tail = full.split('').reduceRight((acc, ch) => (acc.n < ns.length ? { t: ch + acc.t, n: acc.n + (/[A-Z]/.test(ch) ? 1 : 0) } : acc), { t: '', n: 0 }).t.trim();
    return res(true, tail, true, `The start of the text looks cut off on the photo (full text is probably "${full}") — check it.`);
  }
  return res(/[A-Z]{2,}/.test(s), s, false, /[A-Z]{2,}/.test(s) ? '' : 'Unusual denomination — check it.');
}

/** Engine / chassis numbers: no fixed format. A 17-character chassis follows VIN rules (no I/O/Q). */
function engineNo(raw) {
  const r = F.serial(raw);
  if (r.ok && /[OIQ]/.test(r.value) && /\d/.test(r.value)) return { ...r, note: [r.note, 'Contains O/I — on engine numbers these are often 0/1; check each character.'].filter(Boolean).join(' '), fixed: true };
  return r;
}
function chassisNo(raw) {
  const c = cleanValue(raw).toUpperCase().replace(/\s+/g, '');
  if (c.length === 17 && /^[A-Z0-9]{17}$/.test(c)) {
    const v = F.vin(c);
    if (v.fixed) return { ...v, note: 'Chassis No. has the 17-character VIN format, which never uses I/O/Q — corrected to 1/0. Check each character.' };
    return v;
  }
  return F.serial(raw);
}

const digitsOnly = (min, max, what) => (raw) => {
  const s = cleanValue(raw).toUpperCase().replace(/[\s\-]/g, '');
  const fx = s.replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  if (new RegExp(`^\\d{${min},${max}}$`).test(fx)) return res(true, fx, fx !== s, fx !== s ? 'Look-alike characters corrected (O→0, I→1…) — check it.' : '');
  return res(false, s, false, `${what} should be ${min === max ? min : `${min}–${max}`} digits — check it.`);
};
function amount(raw) {
  const s = cleanValue(raw).toUpperCase().replace(/^P(HP)?\s*/, (m) => (m.trim() ? 'PHP ' : ''));
  const core = s.replace(/^PHP\s*/, '').replace(/\s/g, '');
  if (/^\d{1,3}(,\d{3})*(\.\d{2})?$|^\d+(\.\d{2})?$/.test(core)) return res(true, s.startsWith('PHP') ? `PHP ${core}` : core);
  return res(false, s, false, 'Amount should look like 1,234.56 — check it.');
}
function personText(raw) {
  const s = cleanValue(raw).toUpperCase();
  if (/^[A-Z\u00D1][A-Z\u00D1 .,'\-]*$/.test(s) && /[A-Z]{2,}/.test(s)) return res(true, s);
  return res(false, s, false, 'Name contains unexpected characters — check it.');
}
function encumbered(raw) {
  const s = cleanValue(raw).toUpperCase();
  if (NA_RE.test(s) || /^NONE$/.test(s)) return res(true, NA_RE.test(s) ? 'N/A' : 'NONE');
  if (/[A-Z]{3,}/.test(s)) return res(true, s);
  return res(false, s, false, 'Only numbers/marks found in this box (no bank or company name) — check it.');
}
const num = (min, max, decimals = false) => (s) => F.number(s.replace(/\s*(CC|KGS?|KW)\.?$/i, ''), { min, max, decimals });

// forms: which layout prints the field ('old' | 'new'; absent = both)
const fields = [
  { key: 'mv_file_no', label: 'MV File No.', labels: ['MV File No.', 'MV File Number', { label: 'File No.', opts: { exact: true } }], refine: { keep: true, whitelist: '0123456789-' }, format: F.mvFile,
    fallback: (ocr) => { const m = ocr.text.match(MV_RE); if (!m) return null; const r = F.mvFile(m[0]); return r.ok ? { value: r.value, raw: m[0], conf: 0 } : null; } },
  { key: 'plate_no', label: 'Plate No.', labels: ['Plate No.', 'Plate Number'], refine: { keep: true, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -' }, format: na(F.plate) },
  // engine / chassis numbers have no fixed format and mix letters with digits (Z/2, S/5, B/8, O/0):
  // they are only OK when read with very high confidence
  { key: 'engine_no', label: 'Engine No.', okConf: 93, labels: ['Engine No.', 'Engine Number', 'Motor No.'], refine: { keep: true, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-', okConf: 93 }, format: engineNo },
  { key: 'chassis_no', label: 'Chassis No.', okConf: 93, labels: ['Chassis No.', 'Chassis Number', 'Serial No.'], refine: { keep: true, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-', okConf: 93 }, format: chassisNo },
  { key: 'vin', label: 'VIN', forms: ['new'], labels: [{ label: 'VIN', opts: { exact: true } }, 'Vehicle Identification Number', 'VIN No.'], format: na(F.vin) },
  { key: 'denomination', label: 'Denomination', forms: ['old'], labels: ['Denomination'], leftSlack: 4, format: denomination },
  { key: 'vehicle_type', label: 'Vehicle Type', forms: ['new'], labels: ['Vehicle Type'], format: na(known(VEHICLE_TYPES, 'vehicle type')) },
  { key: 'vehicle_category', label: 'Vehicle Category', forms: ['new'], labels: ['Vehicle Category'], refine: { keep: true, whitelist: 'LMNO1234567/' },
    format: na((s) => { const v = cleanValue(s).toUpperCase().replace(/\s/g, '').replace(/^([LMNO])[I|]$/, '$11'); return /^(L[1-7]|M[1-3]|N[1-3]|O[1-4])$/.test(v) ? res(true, v) : res(false, v, false, 'Vehicle category is usually L1–L7, M1–M3, N1–N3 or O1–O4.'); }) },
  { key: 'piston_displacement', label: 'Piston Displacement', labels: ['Piston Displacement', 'Piston Displ.', 'Displacement'], refine: { blank: true, keep: true, whitelist: '0123456789' }, format: na(num(40, 20000)) },
  { key: 'cylinders', label: 'No. of Cylinders', forms: ['old'], labels: ['No. of Cylinders', 'Number of Cylinders', 'Number of Cyl', 'No. of Cyl.'], refine: { blank: true, keep: true, whitelist: '0123456789' }, format: na(num(1, 16)) },
  { key: 'max_power', label: 'Max Power (kW)', forms: ['new'], labels: ['Max Power (kW)', 'Max Power'], format: na(num(1, 2000, true)) },
  { key: 'fuel', label: 'Fuel', labels: ['Type of Fuel', 'Fuel Type', { label: 'Fuel', opts: { exact: true } }], format: na(known(FUELS, 'fuel')) },
  { key: 'make', label: 'Make', labels: ['Make/Brand', { label: 'Make', opts: { exact: true } }, { label: 'Brand', opts: { exact: true } }], format: na(F.text) },
  { key: 'series', label: 'Series', labels: [{ label: 'Series', opts: { maxDist: 1 } }, { label: 'Model', opts: { exact: true } }], format: na(seriesText) },
  { key: 'body_type', label: 'Body Type', labels: ['Body Type', 'Type of Body'], format: na(known(BODY_TYPES, 'body type')) },
  { key: 'body_no', optional: true, alwaysShow: true, label: 'Body No.', forms: ['old'], labels: ['Body No.', 'Body Number'], format: na(F.text) },
  { key: 'color', label: 'Color', forms: ['new'], labels: [{ label: 'Color', opts: { exact: true } }, { label: 'Colour', opts: { exact: true } }], format: na(F.text) },
  { key: 'classification', label: 'Classification', forms: ['new'], labels: ['Classification'], format: na(known(CLASSES, 'classification')) },
  { key: 'passenger_capacity', label: 'Passenger Capacity', forms: ['new'], labels: ['Passenger Capacity'], refine: { blank: true, keep: true, whitelist: '0123456789' }, format: na(num(1, 120)) },
  { key: 'year_model', label: 'Year Model', labels: ['Year Model'], refine: { keep: true, whitelist: '0123456789' }, format: na(F.year) },
  { key: 'year_rebuilt', label: 'Year Rebuilt', forms: ['new'], labels: ['Year Rebuilt'], refine: { keep: true, whitelist: '0123456789' }, format: na(F.year) },
  { key: 'gross_wt', label: 'Gross Wt.', labels: ['Gross Wt.', 'Gross Weight'], refine: { blank: true, keep: true, whitelist: '0123456789' }, format: na(num(30, 60000)) },
  { key: 'net_wt', label: 'Net Wt.', labels: ['Net Wt.', 'Net Weight'], refine: { blank: true, keep: true, whitelist: '0123456789' }, format: na(num(20, 60000)) },
  { key: 'shipping_wt', optional: true, alwaysShow: true, label: 'Shipping Wt.', forms: ['old'], labels: ['Shipping Wt.', 'Shipping Weight'], refine: { blank: true, keep: true, whitelist: '0123456789' }, format: na(num(20, 60000)) },
  { key: 'net_capacity', label: 'Net Capacity', forms: ['old'], labels: ['Net Capacity'], format: na(F.text) },
  { key: 'owner_name', label: "Complete Owner's Name", labels: ["Complete Owner's Name", 'Complete Owners Name', "Owner's Name", 'Owner Name', 'Registered Owner', 'Name of Owner', { label: 'Owner', opts: { exact: true } }], format: personText },
  { key: 'telephone', optional: true, alwaysShow: true, label: 'Telephone No./Contact Details', forms: ['old'], labels: ['Telephone No./Contact Details', 'Telephone No.', 'Contact Details'], format: na(F.text) },
  { key: 'owner_address', label: 'Complete Address', labels: ['Complete Address', "Owner's Address", { label: 'Address', opts: { exact: true } }], multiline: true, maxLines: 2, format: na(F.address) },
  { key: 'encumbered_to', optional: true, alwaysShow: true, label: 'Encumbered To', labels: ['Encumbered To', 'Encumbered'], format: encumbered },
  { key: 'or_no', optional: true, alwaysShow: true, label: 'O.R. No.', group: 'Details of First Registration', labels: ['O.R. No.', 'OR No.', 'Official Receipt No.'], labelOpts: { maxDist: 1 }, refine: { keep: true, whitelist: '0123456789' }, format: digitsOnly(8, 20, 'O.R. No.') },
  { key: 'or_date', optional: true, alwaysShow: true, label: 'O.R. Date', group: 'Details of First Registration', labels: ['O.R. Date', 'OR Date'], labelOpts: { maxDist: 1 }, refine: { keep: true, whitelist: '0123456789/' }, format: (s) => F.date(s, { minYear: 1960, maxYear: NOW + 1 }) },
  { key: 'amount', optional: true, alwaysShow: true, label: 'Amount', group: 'Details of First Registration', labels: ['Amount', { label: 'Amt.', opts: { exact: true } }], format: amount },
  { key: 'remarks', optional: true, alwaysShow: true, label: 'Remarks', forms: ['new'], labels: ['Remarks'], multiline: true, maxLines: 2, format: na(F.text) },
  // ---- other (secondary) ----
  { key: 'cr_no', label: 'CR No.', section: 'extra', optional: true, labels: [{ label: 'CR No.', opts: { maxDist: 0 } }, 'CR Number', 'Certificate No.'], refine: { keep: true, whitelist: '0123456789' }, format: digitsOnly(7, 12, 'CR No.') },
  { key: 'date_registered', label: 'CR Date', section: 'extra', optional: true, labels: [{ label: 'Date', opts: { exact: true } }, { label: 'Date', opts: { maxDist: 1, lineStart: true } }, 'Date Issued', 'Date Registered', 'Date of Registration'], where: 'right', refine: { keep: true, whitelist: '0123456789/' }, format: (s) => F.date(s, { minYear: 1960, maxYear: NOW + 1 }) },
  { key: 'field_office', label: 'Field Office', section: 'extra', optional: true, labels: ['Field Office'], where: 'right', format: F.text },
  { key: 'office_code', label: 'Office Code', section: 'extra', optional: true, labels: ['Office Code'], where: 'right', refine: { keep: true, whitelist: '0123456789' }, format: digitsOnly(3, 6, 'Office code') },
];

// ---- text that must never become a value: legal footer, signature block, official receipt below the CR ----
const FOOTER = /this\s*is\s*(to|a)\s*cert|computer\s*generated|valid\s*only|unautho|erasure|alteration\s*hereon|invalidate|registrant|signature\s*\/?\s*date|chief\s*of\s*office|official\s*receipt|received\s*from|payment\s*details|breakdown\s*of\s*payment|scanned\s*with|camscanner/i;
const SIGN_LINE = /chief\s*of\s*office|signature|^\s*by\s*:?\s*$|\bBY:|\bOIC\b|\bLTO\s*DAS\b|atty\.?\s/i;
const CRNO_LINE = /\bC\s*R\s*[.,]?\s*N[o0]\b/i;
function ignoreWords(ocr) {
  const out = [];
  // everything from the first footer/signature line down is ignored (except a "CR No." line: the new
  // layout prints the CR number at the very bottom)
  let cut = Infinity;
  for (const ln of ocr.lines) {
    if (FOOTER.test(ln.text) || SIGN_LINE.test(ln.text)) {
      cut = Math.min(cut, Math.min(...ln.words.map((w) => w.bbox.y0)));
    }
  }
  for (const ln of ocr.lines) {
    const y = Math.min(...ln.words.map((w) => w.bbox.y0));
    if ((y >= cut - 2 && !CRNO_LINE.test(ln.text)) || FOOTER.test(ln.text) || SIGN_LINE.test(ln.text)) out.push(...ln.words);
  }
  return out;
}

/** Which printed layout is this? */
export function layoutOf(text) {
  const t = normToken(text);
  const has = (k) => t.includes(normToken(k));
  let nw = 0, od = 0;
  for (const k of ['Revised December 2020', 'Vehicle Category', 'Make/Brand', 'Type of Fuel', 'Passenger Capacity', 'Max Power', 'Year Rebuilt', 'Remarks', "Owner's Address", 'Gross Weight', 'Net Weight']) if (has(k)) nw++;
  for (const k of ['Denomination', 'No. of Cylinders', 'Shipping Wt', 'Net Capacity', 'Body No', 'Telephone No', 'Contact Details', 'Complete Address', 'Gross Wt', 'Net Wt']) if (has(k)) od++;
  if (nw >= 2 && nw > od) return 'new';
  if (od >= 2 && od > nw) return 'old';
  return null;
}

/**
 * The small "Complete Address (No., Street, City/Municipality, Province)" label is often unreadable
 * (it is printed in tiny type and the address is printed over it). On a box-by-box read, the address
 * is then taken from the box directly under the owner's name — always marked VERIFY.
 */
function addressFromBox(f, ocr) {
  const g = f.owner_name._geo;
  if (!g || !g.value || !ocr.words.some((w) => w.cell !== undefined)) return;
  const bx = (w) => w.obox || w.bbox;
  const cx = (b) => (b.x0 + b.x1) / 2, cy = (b) => (b.y0 + b.y1) / 2;
  const nameW = ocr.words.find((w) => w.cell !== undefined && cx(bx(w)) >= g.value.x0 - 2 && cx(bx(w)) <= g.value.x1 + 2 && cy(bx(w)) >= g.value.y0 - 2 && cy(bx(w)) <= g.value.y1 + 2);
  if (!nameW) return;
  const ignored = new Set(ignoreWords(ocr));
  const ok = (w) => w.cell !== undefined && /[A-Za-z0-9]/.test(w.text) && w.conf >= 15 && !ignored.has(w);
  const below = ocr.words.filter((w) => ok(w) && w.cell !== nameW.cell && bx(w).y0 > g.value.y1 && bx(w).x1 > g.value.x0 && bx(w).x0 < g.value.x1)
    .sort((a, b) => bx(a).y0 - bx(b).y0);
  if (!below.length) return;
  const cell = below[0].cell;
  const LABELISH = /^(\(?no\.?,?|street,?|city\/?|municipality,?|province\)?|complete|address|\(no)$/i;
  const ws = ocr.words.filter((w) => ok(w) && w.cell === cell && !LABELISH.test(w.text.replace(/[^A-Za-z().,\/]/g, '')) && w.conf >= 30);
  if (!ws.length) return;
  // reading order: rows by y, words by x
  ws.sort((a, b) => (Math.abs(cy(bx(a)) - cy(bx(b))) < (bx(a).y1 - bx(a).y0) * 0.6 ? bx(a).x0 - bx(b).x0 : bx(a).y0 - bx(b).y0));
  const text = cleanValue(ws.map((w) => w.text).join(' '));
  const r = F.address(text);
  if (!r.ok) return;
  const def = fields.find((d) => d.key === 'owner_address');
  f.owner_address = makeField(def, { value: r.value, raw: text, status: STATUS.VERIFY, confidence: Math.round(Math.min(...ws.map((w) => w.conf))),
    note: "Address label not readable: taken from the box under the owner's name — check it." });
}

// Revised (Dec. 2020) form: a fixed 4-column grid. When a label is too damaged to read, its box is
// found from the boxes of labels that were read in the same row and column.
const GRID_NEW = [ // left → right as printed
  ['plate_no', 'engine_no', 'chassis_no', 'vin'],
  ['mv_file_no', 'vehicle_type', 'vehicle_category', 'make'],
  ['passenger_capacity', 'color', 'fuel', 'classification'],
  ['body_type', 'series', 'gross_wt', 'net_wt'],
  ['year_model', 'year_rebuilt', 'piston_displacement', 'max_power'],
];
const labelMissing = (fl) => fl && fl.status === STATUS.NOT_FOUND && /^Label not found/.test(fl.note || '');
function cellGeometry(ocr) {
  const bx = (w) => w.obox || w.bbox, m = new Map();
  for (const w of ocr.words) {
    if (w.cell === undefined || !/[A-Za-z0-9]/.test(w.text)) continue;
    const b = bx(w), c = m.get(w.cell);
    if (!c) m.set(w.cell, { id: w.cell, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, words: [w] });
    else { c.x0 = Math.min(c.x0, b.x0); c.y0 = Math.min(c.y0, b.y0); c.x1 = Math.max(c.x1, b.x1); c.y1 = Math.max(c.y1, b.y1); c.words.push(w); }
  }
  for (const c of m.values()) { c.cx = (c.x0 + c.x1) / 2; c.cy = (c.y0 + c.y1) / 2; }
  return m;
}
/** the value line of a box whose label could not be read: the strongest text line below the top line */
function boxValue(c, ignored, def) {
  const bx = (w) => w.obox || w.bbox;
  // pieces of the field's own (damaged) label: "NO", "/IN" of "VIN" …
  const ltoks = def ? def.labels.flatMap((l) => (typeof l === 'string' ? l : l.label).split(/\s+/)).map(normToken).filter(Boolean) : [];
  const labelish = (w) => { const t = normToken(w.text); return t && t.length <= 3 && !/^\d+$/.test(t) && ltoks.some((l) => l.includes(t)); };
  const ws = c.words.filter((w) => !ignored.has(w) && !labelish(w)).sort((a, b) => bx(a).y0 - bx(b).y0);
  const rows = [];
  for (const w of ws) {
    const yc = (bx(w).y0 + bx(w).y1) / 2, h = bx(w).y1 - bx(w).y0;
    let r = rows.find((r) => Math.abs(yc - r.yc) < Math.max(h, r.h) * 0.5);
    if (!r) { r = { yc, h, words: [] }; rows.push(r); }
    r.words.push(w);
  }
  if (!rows.length) return null;
  const score = (r) => r.words.reduce((a, w) => a + w.text.replace(/[^A-Za-z0-9]/g, '').length * Math.max(5, w.conf), 0);
  // one line only: the damaged label and the value were read as one line — keep the clear words
  if (rows.length === 1) rows[0].words = rows[0].words.filter((w) => w.conf >= 40 && w.text.replace(/[^A-Za-z0-9]/g, '').length >= 2);
  const best = (rows.length > 1 ? rows.slice(1) : rows).sort((a, b) => score(b) - score(a))[0];
  if (!best.words.length) return null;
  best.words.sort((a, b) => bx(a).x0 - bx(b).x0);
  return { text: cleanValue(best.words.map((w) => w.text).join(' ')), conf: Math.round(Math.min(...best.words.map((w) => w.conf))) };
}
function gridRescue(f, ocr) {
  if (!ocr.words.some((w) => w.cell !== undefined)) return;
  const geo = cellGeometry(ocr), ignored = new Set(ignoreWords(ocr));
  const used = new Set(), rowY = [], colX = [];
  GRID_NEW.forEach((row, r) => row.forEach((k, c) => {
    const fl = f[k], id = fl && fl._geo && fl._geo.cell;
    if (id === undefined || labelMissing(fl) || !geo.has(id)) return;
    used.add(id); (rowY[r] = rowY[r] || []).push(geo.get(id).cy); (colX[c] = colX[c] || []).push(geo.get(id).cx);
  }));
  const med = (a) => a && a.length ? a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)] : null;
  const ry = rowY.map(med), cx = [0, 1, 2, 3].map((c) => med(colX[c]));
  const steps = (a) => { const d = []; for (let i = 1; i < a.length; i++) if (a[i] != null && a[i - 1] != null) d.push(a[i] - a[i - 1]); return med(d); };
  const rowPitch = Math.abs(steps(ry) || 0), colPitch = Math.abs(steps(cx) || 0);
  if (!rowPitch || !colPitch) return;
  GRID_NEW.forEach((row, r) => row.forEach((k, c) => {
    const fl = f[k];
    if (!labelMissing(fl)) return;
    const y = ry[r] ?? (ry.findIndex((v) => v != null) >= 0 ? ry[ry.findIndex((v) => v != null)] + (r - ry.findIndex((v) => v != null)) * rowPitch : null);
    const x = cx[c] ?? null;
    if (y == null || x == null) return;
    const cand = [...geo.values()].filter((g) => !used.has(g.id) && Math.abs(g.cy - y) < rowPitch * 0.45 && Math.abs(g.cx - x) < colPitch * 0.45)
      .sort((a, b) => Math.hypot(a.cx - x, a.cy - y) - Math.hypot(b.cx - x, b.cy - y))[0];
    if (!cand) return;
    const def0 = fields.find((d) => d.key === k);
    const v = boxValue(cand, ignored, def0);
    if (!v || !v.text) return;
    const def = fields.find((d) => d.key === k), fm = def.format(v.text);
    if (!fm.ok) return;
    used.add(cand.id);
    f[k] = makeField(def, { value: fm.value, raw: v.text, status: STATUS.VERIFY, confidence: v.conf,
      note: 'Label not readable: value taken from the box in this label\'s place on the form — check it.' });
  }));
  // owner's name: the box right above the address box
  if (labelMissing(f.owner_name) && f.owner_address._geo && f.owner_address._geo.cell !== undefined && geo.has(f.owner_address._geo.cell)) {
    const a = geo.get(f.owner_address._geo.cell);
    const above = [...geo.values()].filter((g) => g.id !== a.id && !used.has(g.id) && g.cy < a.y0 && g.x1 > a.x0 && g.x0 < a.x1 && a.y0 - g.cy < rowPitch * 1.6)
      .sort((p, q) => q.cy - p.cy)[0];
    if (above) {
      const ws = above.words.filter((w) => !ignored.has(w));
      const v = boxValue({ words: [{ text: '', conf: 0, bbox: { x0: 0, y0: above.y0 - 1000, x1: 1, y1: above.y0 - 990 } }, ...ws] }, ignored, null);
      const def = fields.find((d) => d.key === 'owner_name');
      if (v && v.text) {
        const fm = def.format(v.text);
        if (fm.ok) f.owner_name = makeField(def, { value: fm.value, raw: v.text, status: STATUS.VERIFY, confidence: v.conf,
          note: "Label not readable: taken from the box above the owner's address — check it." });
      }
    }
  }
}

function postProcess(f, ocr) {
  if (f.owner_address.status === STATUS.NOT_FOUND && f.owner_name.value) addressFromBox(f, ocr);
  const layout = layoutOf(ocr.text);
  if (layout === 'new') gridRescue(f, ocr);
  for (const d of fields) {
    // a field the detected layout does not print: hide it (not a missing field)
    if (layout && d.forms && !d.forms.includes(layout) && f[d.key].status === STATUS.NOT_FOUND) {
      f[d.key].hidden = true; f[d.key].note = 'Not on this form.';
    }
  }
  if (f.owner_name.value && /\d/.test(f.owner_name.value) && f.owner_name.status === STATUS.OK) {
    f.owner_name.status = STATUS.VERIFY; f.owner_name.note = 'Name contains digits — check it.';
  }
  for (const d of fields) f[d.key].layout = layout || undefined;
  // VIN vs chassis (new layout prints both)
  const ch = f.chassis_no, vin = f.vin;
  if (vin.value && vin.value !== 'N/A' && ch.value && vin.value !== ch.value && ch.value.length === 17) {
    vin.status = STATUS.VERIFY; vin.note = 'VIN differs from Chassis No. — check both.';
  }
}

export default {
  id: 'cr',
  useGrid: true,
  label: 'Certificate of Registration (CR)',
  sectionTitles: { main: 'VEHICLE INFORMATION', extra: 'OTHER' },
  detect(text) {
    return keywordScore(text, [
      { k: 'CERTIFICATE OF REGISTRATION', w: 5 }, { k: 'MV File', w: 2 }, { k: 'File No', w: 1 }, { k: 'Engine No', w: 2 }, { k: 'Chassis No', w: 2 },
      { k: 'Plate No', w: 2 }, { k: 'Piston Displacement', w: 2 }, { k: 'Gross W', w: 1 }, { k: 'Net W', w: 1 },
      { k: 'Series', w: 1 }, { k: 'Body Type', w: 1 }, { k: 'Year Model', w: 1 }, { k: 'Fuel', w: 1 }, { k: 'Denomination', w: 1 },
      { k: 'Encumbered', w: 1 }, { k: 'LTO Form', w: 1 }, { k: 'Cylinder', w: 1 }, { k: 'Net Capacity', w: 2 }, { k: 'Shipping W', w: 2 }, { k: 'Body No', w: 1 },
    ], [{ re: MV_RE, w: 2, name: 'MV-file pattern' }]);
  },
  fields,
  ignoreWords,
  stopLabels: ['REPUBLIC OF THE PHILIPPINES', 'DEPARTMENT OF TRANSPORTATION', 'LAND TRANSPORTATION OFFICE', 'CERTIFICATE OF REGISTRATION',
    'Details of First Registration', '(MM-DD-YYYY)', 'LTO Form No. 3', '(For electric vehicle)', '(For Rebuilt MVs)', '(New/Used Imported CBU)', '(No., Street, City/Municipality, Province)'],
  critical: {
    mv_file_no: 'MV File No. could not be read. Retake the photo closer to the top part of the CR.',
    engine_no: 'Engine number could not be read clearly — check it against the CR.',
    chassis_no: 'Chassis number could not be read clearly — check it against the CR.',
    owner_name: "Owner's name could not be read — check that the lower part of the CR is in the photo.",
  },
  cutoffMessage: 'CR appears partially cut off or covered. Please upload a photo of the complete document.',
  postProcess,
  messages(f) {
    const l = f.mv_file_no && f.mv_file_no.layout;
    return l ? [{ level: 'info', text: l === 'new' ? 'New CR layout (LTO Form No. 3, revised Dec. 2020).' : 'Old CR layout (LTO Form No. 3).' }] : [];
  },
  extract(ocr) { return runExtractor(this, ocr); },
};
