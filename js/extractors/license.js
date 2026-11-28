// Philippine LTO Driver's License extractor (new PVC cards 2017+ and older cards).
import { keywordScore, makeField, runExtractor } from './base.js';
import * as F from '../core/formats.js';
import { STATUS } from '../core/status.js';
import { normToken } from '../core/text.js';

const NOW = new Date().getFullYear();
const LICNO_RE = /\b[A-Z0-9]\d{2}\s?-\s?\d{2}\s?-\s?\d{6}\b/;

// New LTO card (2017+ design, also the Dec 2020 / 2023 prints): where each printed label sits on the
// card (x = left edge of the label, y = its centre, as fractions of the card width / height) and where
// its value is printed relative to that label. Used only to re-read values the page reading missed;
// such values are always VERIFY (see core/zones.js).
const L1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00D1';
const EYES = /^(BLACK|BROWN|DARK BROWN|LIGHT BROWN|BLUE|GRAY|GREY|GREEN|HAZEL|AMBER)$/;
// DL codes printed "A,A1,B,B1,B2" with the small commas lost ("AA1,BB1,B2"): split a run of letters /
// digits into valid codes only when there is exactly one way to do it
const DLC = ['A', 'A1', 'B', 'B1', 'B2', 'BE', 'C', 'CE', 'D'];
function splitCodes(raw) {
  return String(raw).toUpperCase().split(/([,;.\s]+)/).map((tok) => {
    if (!/^[A-E0-9]{2,}$/.test(tok) || DLC.includes(tok)) return tok;
    const ways = (s) => { if (!s) return [[]]; const out = []; for (const c of DLC) if (s.startsWith(c)) for (const r of ways(s.slice(c.length))) out.push([c, ...r]); return out.slice(0, 2); };
    const w = ways(tok);
    return w.length === 1 ? w[0].join(',') : tok;
  }).join('');
}
const cardTemplate = {
  aspect: 0.63,
  anchors: {
    full_name: { x: 0.347, y: 0.292, labels: ['Last Name, First Name, Middle Name'], maxDist: 4 },
    nationality: { x: 0.350, y: 0.400, labels: ['Nationality'], maxDist: 2 },
    sex: { x: 0.484, y: 0.398, labels: ['Sex'], maxDist: 0 },
    date_of_birth: { x: 0.552, y: 0.396, labels: ['Date of Birth'], maxDist: 2 },
    weight: { x: 0.735, y: 0.393, labels: ['Weight (kg)'], maxDist: 2 },
    height: { x: 0.858, y: 0.397, labels: ['Height(m)'], maxDist: 2 },
    address: { x: 0.352, y: 0.496, labels: ['Address'], maxDist: 1 },
    license_no: { x: 0.351, y: 0.636, labels: ['License No.'], maxDist: 2 },
    expiration_date: { x: 0.585, y: 0.638, labels: ['Expiration Date'], maxDist: 3 },
    agency_code: { x: 0.776, y: 0.640, labels: ['Agency Code'], maxDist: 2 },
    blood_type: { x: 0.350, y: 0.727, labels: ['Blood Type'], maxDist: 2 },
    eye_color: { x: 0.517, y: 0.727, labels: ['Eyes Color'], maxDist: 2 },
    dl_codes: { x: 0.351, y: 0.823, labels: ['DL Codes'], maxDist: 1 },
    conditions: { x: 0.512, y: 0.828, labels: ['Conditions'], maxDist: 2 },
  },
  // value boxes: offsets from the anchor (fractions of the card)
  zones: {
    full_name: { anchor: 'full_name', x0: -0.02, x1: 0.46, y0: 0.015, y1: 0.075, whitelist: L1 + ",.-' ", minConf: 55, vote: true },
    nationality: { anchor: 'nationality', x0: -0.015, x1: 0.085, y0: 0.015, y1: 0.072, whitelist: L1, format: (s) => (/^[A-Z]{3}$/.test(s.trim()) ? { ok: true, value: s.trim() } : { ok: false, value: s }) },
    sex: { anchor: 'sex', x0: -0.02, x1: 0.05, y0: 0.015, y1: 0.072 },
    date_of_birth: { anchor: 'date_of_birth', x0: -0.015, x1: 0.17, y0: 0.015, y1: 0.072, strict: true },
    weight: { anchor: 'weight', x0: 0, x1: 0.095, y0: 0.015, y1: 0.072, format: (s) => (/^\d{2,3}(\.\d)?$/.test(s.trim()) ? F.number(s, { decimals: true, min: 20, max: 250 }) : { ok: false, value: s }) },
    height: { anchor: 'height', x0: 0.012, x1: 0.09, y0: 0.015, y1: 0.072, format: (s) => (/^[12]\.\d{1,2}$/.test(s.trim()) ? F.number(s, { decimals: true, min: 0.9, max: 2.5 }) : { ok: false, value: s }) },
    address: { anchor: 'address', x0: -0.015, x1: 0.56, y0: 0.015, y1: 0.125, psm: '6', whitelist: L1 + "0123456789 .,-#/'", minConf: 55, vote: true },
    license_no: { anchor: 'license_no', x0: -0.015, x1: 0.22, y0: 0.015, y1: 0.075, strict: true },
    // licenses expire on the holder's birthday: a single clear reading whose month/day matches the
    // birth date is accepted (VERIFY)
    expiration_date: { anchor: 'expiration_date', x0: -0.02, x1: 0.17, y0: 0.015, y1: 0.075, strict: true,
      confirm: (v, fl) => { const d = fl.find((x) => x.key === 'date_of_birth'); return !!(d && d.iso && v.iso && d.iso.slice(5) === v.iso.slice(5)); } },
    agency_code: { anchor: 'agency_code', x0: 0, x1: 0.11, y0: 0.015, y1: 0.075, strict: true },
    blood_type: { anchor: 'blood_type', x0: -0.01, x1: 0.10, y0: 0.015, y1: 0.072, strict: true },
    eye_color: { anchor: 'eye_color', x0: -0.02, x1: 0.12, y0: 0.015, y1: 0.072, whitelist: L1 + ' ', format: (s) => { const v = s.trim().replace(/\s+/g, ' '); return EYES.test(v) ? { ok: true, value: v } : { ok: false, value: v }; } },
    dl_codes: { anchor: 'dl_codes', x0: -0.045, x1: 0.15, y0: 0.015, y1: 0.072, strict: true, format: (s) => F.dlCodes(splitCodes(s)) },
    conditions: { anchor: 'conditions', x0: -0.02, x1: 0.11, y0: 0.015, y1: 0.072 },
  },
};

const fields = [
  // ---- main block (same order as the encoding sample) ----
  { key: 'license_no', label: 'License No.', labels: ['License No.', 'License Number', "Driver's License No.", 'Lic. No.'], refine: { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' }, format: F.licenseNo,
    fallback: (ocr) => { const m = ocr.text.toUpperCase().match(LICNO_RE); if (!m) return null; const r = F.licenseNo(m[0]); return r.ok ? { value: r.value, raw: m[0], conf: 0 } : null; } },
  { key: 'full_name', label: 'Name', labels: ['Last Name, First Name, Middle Name', 'Last Name First Name Middle Name', 'Last Name, First Name, M.I.'], format: F.personName },
  { key: 'date_of_birth', label: 'Date of Birth', labels: ['Date of Birth', 'Birth Date', 'Birthdate'], refine: { whitelist: '0123456789/' }, format: (s) => F.date(s, { minYear: 1900, maxYear: NOW - 10 }) },
  { key: 'address', label: 'Address', labels: ['Address'], multiline: true, maxLines: 3, format: F.address },
  { key: 'classification', label: 'Classification' }, // derived from header text
  { key: 'restrictions', label: 'Restrictions', labels: ['Restrictions', 'Restriction'], format: F.restrictions, optional: true },
  { key: 'dl_codes', label: 'DL Codes', labels: ['DL Codes', 'DL Code', 'DL Codes:', { label: 'DL', opts: { exact: true } }], refine: { whitelist: 'ABCDEMT12, ' }, format: F.dlCodes, optional: true,
    // codes may sit right of / below the label or in a small grid; rescue by pattern near the label
    near: { re: /^(A1?|B[12E]?|CE?|D)(\s*[,.;]\s*(A1?|B[12E]?|CE?|D)){0,8}$/, prep: (t) => t.toUpperCase().replace(/[lI|!]/g, '1').replace(/\s+/g, ' '), maxDist: 8 } },
  { key: 'conditions', label: 'Conditions', labels: ['Conditions', 'Condition'], refine: { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,/ ', w: 6, h: 1.8 }, format: F.conditions, clean: cutSignature },
  { key: 'expiration_date', label: 'Expiration', labels: ['Expiration Date', 'Expiry Date', 'Valid Until'], refine: { whitelist: '0123456789/' }, format: (s) => F.date(s, { minYear: 1995, maxYear: NOW + 12 }) },
  // ---- additional details ----
  { key: 'last_name', label: 'Last Name', section: 'extra' },
  { key: 'first_name', label: 'First Name', section: 'extra' },
  { key: 'middle_name', label: 'Middle Name', section: 'extra' },
  { key: 'nationality', label: 'Nationality', section: 'extra', labels: ['Nationality'],
    format: (s) => { const v = s.toUpperCase().trim(); return /^([A-Z]{3}|FILIPINO)$/.test(v) ? { ok: true, value: v } : { ok: false, value: v, note: 'Expected a 3-letter code (e.g. PHL).' }; } },
  { key: 'sex', label: 'Sex', section: 'extra', labels: ['Sex'], labelOpts: { exact: true }, verifyBelow: 60, refine: { whitelist: 'MF' }, format: F.sex },
  { key: 'weight', label: 'Weight (kg)', section: 'extra', labels: ['Weight (kg)', 'Weight'], refine: { whitelist: '0123456789.' }, format: (s) => F.number(s, { decimals: true, min: 20, max: 250 }) },
  { key: 'height', label: 'Height (m)', section: 'extra', labels: ['Height(m)', 'Height'], refine: { whitelist: '0123456789.' }, format: (s) => F.number(s.replace(/\s*M$/i, ''), { decimals: true, min: 0.9, max: 2.5 }) },
  { key: 'agency_code', label: 'Agency Code', section: 'extra', labels: ['Agency Code'], refine: { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }, format: F.agencyCode },
  { key: 'blood_type', label: 'Blood Type', section: 'extra', labels: ['Blood Type'], refine: { whitelist: 'ABO+-' }, format: F.bloodType },
  { key: 'eye_color', label: 'Eye Color', section: 'extra', labels: ['Eyes Color', 'Eye Color'], format: F.text },
];

// The LTO official's printed name / signature block (e.g. "ATTY. ... Assistant Secretary") must never
// become part of a field value.
const SIG_START = /^(ATTY\.?|ATTY|ATTORNEY|ASSISTANT|ASST\.?|SECRETARY|CHIEF|DIRECTOR|SIGNATURE|LTO|EDGAR|GALVANTE|VIGOR|MENDOZA)$/i;
// printed names of the LTO signatories (older cards: Atty. Vigor D. Mendoza II; newer: Edgar C. Galvante)
const SIGNATORY = /\b(GALVANTE|EDGAR\s*C\.?\s*G|VIGOR\s*D?\.?\s*MENDOZA)/i;
function ignoreWords(ocr) {
  const out = [];
  const bottom = Math.max(1, ...ocr.words.map((w) => w.bbox.y1));
  for (const ln of ocr.lines) {
    const flat = ln.words.map((w) => w.text).join(' ');
    if (/assistant\s*secretary|signature\s*of|lto\s*chief|officer[- ]in[- ]charge/i.test(flat)) { out.push(...ln.words); continue; }
    const i = ln.words.findIndex((w) => /^ATTY\.?,?$/i.test(w.text.replace(/[^A-Za-z.,]/g, '')));
    if (i >= 0) { out.push(...ln.words.slice(i)); continue; }
    // the signatory's printed name (on its own line above "Assistant Secretary")
    const m = flat.match(SIGNATORY);
    if (m && Math.min(...ln.words.map((w) => w.bbox.y0)) > bottom * 0.6) { const k = ln.words.findIndex((w) => /EDGAR|GALVANTE|VIGOR|MENDOZA/i.test(w.text)); if (k >= 0) out.push(...ln.words.slice(Math.max(0, k - (/GALVANTE/i.test(ln.words[k].text) && k > 0 && /^C\.?$/i.test(ln.words[k - 1].text) ? 2 : 0)))); }
  }
  return out;
}
function cutSignature(v) {
  const i = v.words.findIndex((w) => SIG_START.test(w.text.replace(/[^A-Za-z.]/g, '')));
  if (i < 0) return v;
  const ws = v.words.slice(0, i);
  if (!ws.length) return null;
  const confs = ws.map((w) => w.conf);
  return { ...v, words: ws, text: ws.map((w) => w.text).join(' ').trim(), conf: confs.reduce((a, b) => a + b, 0) / confs.length, minConf: Math.min(...confs) };
}

function splitName(f) {
  // Name split: printed as "LAST, FIRST MIDDLE"
  const name = f.full_name;
  const inherit = (key, value, extraNote = '', forceVerify = false) => {
    const def = fields.find((x) => x.key === key);
    if (!value) { f[key] = makeField(def, { note: name.status === STATUS.NOT_FOUND ? 'Name not found.' : 'Could not split the name.' , status: name.status === STATUS.NOT_FOUND ? STATUS.NOT_FOUND : STATUS.VERIFY }); return; }
    f[key] = makeField(def, { value, raw: name.raw, confidence: name.confidence,
      status: forceVerify && name.status === STATUS.OK ? STATUS.VERIFY : name.status, note: extraNote || 'Taken from Name.' });
  };
  if (name.value && name.value.includes(',')) {
    const [last, rest = ''] = name.value.split(',').map((s) => s.trim());
    const parts = rest.split(/\s+/).filter(Boolean);
    inherit('last_name', last);
    if (parts.length <= 1) { inherit('first_name', parts[0] || ''); f.middle_name = makeField(fields.find((x) => x.key === 'middle_name'), { note: 'No middle name printed.' }); }
    else if (parts.length === 2) { inherit('first_name', parts[0]); inherit('middle_name', parts[1]); }
    else {
      const amb = 'Split automatically: first name(s) vs. middle name is ambiguous — check.';
      inherit('first_name', parts.slice(0, -1).join(' '), amb, true);
      inherit('middle_name', parts[parts.length - 1], amb, true);
    }
  } else {
    for (const k of ['last_name', 'first_name', 'middle_name']) inherit(k, '');
    if (name.value) { name.note = (name.note ? name.note + ' ' : '') + 'Expected "LAST, FIRST MIDDLE" — check.'; if (name.status === STATUS.OK) name.status = STATUS.VERIFY; }
  }

}

function postProcess(f, ocr) {
  // the next row's label ("License No.") misread and glued to the end of a multi-line address
  if (f.address && f.address.value) {
    const cut = String(f.address.value).replace(/[\s,]+[A-Z0-9]{0,2}C[EF]N[S5]E\s*N[O0]\b.*$/i, '');
    if (cut !== f.address.value && cut.length >= 8) {
      Object.assign(f.address, { value: cut, status: STATUS.VERIFY, note: [f.address.note, 'A misread label was removed from the end of the address — check it.'].filter(Boolean).join(' ') });
    }
  }
  splitName(f);

  // Classification from the card title (older cards print it; new cards may not)
  const flat = ocr.lines.map((l) => normToken(l.text));
  const def = fields.find((x) => x.key === 'classification');
  let cls = null;
  if (flat.some((t) => /nonpro(f|t)essional/.test(t))) cls = 'NON-PROFESSIONAL';
  else if (flat.some((t) => /professional/.test(t))) cls = 'PROFESSIONAL';
  else if (flat.some((t) => /studentpermit/.test(t))) cls = 'STUDENT PERMIT';
  else if (flat.some((t) => /conductor/.test(t))) cls = "CONDUCTOR'S LICENSE";
  f.classification = cls ? makeField(def, { value: cls, raw: cls, status: STATUS.OK, note: 'From the card title.' })
    : makeField(def, { note: 'Not printed on this card (new-style cards show DL Codes instead). Fill in manually if your form needs it.' });

  // Restrictions vs DL Codes: one of them is normally absent
  if (f.restrictions.status === STATUS.NOT_FOUND && f.dl_codes.status !== STATUS.NOT_FOUND) f.restrictions.note = 'New-style card: see DL Codes.';
  if (f.dl_codes.status === STATUS.NOT_FOUND && f.restrictions.status !== STATUS.NOT_FOUND) f.dl_codes.note = 'Old-style card: see Restrictions.';

  // Weight / Height labels are tiny and often lost on photos. They are printed on the same row as
  // Sex and Date of Birth ("M  1990/01/15  70  1.64"), so when the label was not read, take the
  // number(s) right after the birth date on that row — always flagged VERIFY.
  const bd = f.date_of_birth.iso && f.date_of_birth.iso.replace(/-/g, '');
  if (bd && (f.weight.status === STATUS.NOT_FOUND || f.height.status === STATUS.NOT_FOUND)) {
    for (const ln of ocr.lines) {
      const toks = ln.words.map((w) => ({ w, t: w.text.replace(/[^0-9./-]/g, '') }));
      const i = toks.findIndex((x) => x.t.replace(/\D/g, '') === bd);
      if (i < 0) continue;
      const rest = toks.slice(i + 1).filter((x) => x.t);
      const note = 'Label not legible: read from the Sex / Date of Birth row by position — check.';
      let j = 0;
      if (rest[j] && /^\d{2,3}(\.\d)?$/.test(rest[j].t) && +rest[j].t >= 20 && +rest[j].t <= 250) {
        if (f.weight.status === STATUS.NOT_FOUND) f.weight = makeField(fields.find((x) => x.key === 'weight'), { value: rest[j].t, raw: rest[j].w.text, confidence: Math.round(rest[j].w.conf), status: STATUS.VERIFY, note });
        j++;
      }
      if (rest[j] && /^[12]\.\d{2}$/.test(rest[j].t) && f.height.status === STATUS.NOT_FOUND)
        f.height = makeField(fields.find((x) => x.key === 'height'), { value: rest[j].t, raw: rest[j].w.text, confidence: Math.round(rest[j].w.conf), status: STATUS.VERIFY, note });
      break;
    }
  }

  // Cross-check: LTO licenses expire on the holder's birthday
  const dob = f.date_of_birth.iso, exp = f.expiration_date.iso;
  if (dob && exp && dob.slice(5) !== exp.slice(5)) {
    f.expiration_date.note = (f.expiration_date.note ? f.expiration_date.note + ' ' : '') + 'Month/day differs from the birthday (licenses normally expire on the birthday) — double-check both dates.';
    if (f.expiration_date.status === STATUS.OK) f.expiration_date.status = STATUS.VERIFY;
  }
}

function messages(f) {
  const out = [];
  const exp = f.expiration_date.iso;
  if (exp && f.expiration_date.status !== STATUS.NOT_FOUND) {
    const today = new Date().toISOString().slice(0, 10);
    if (exp < today) out.push({ level: 'warn', text: `License appears EXPIRED (expiration: ${f.expiration_date.value}).` });
  }
  return out;
}

export default {
  id: 'license',
  label: "Driver's License",
  sectionTitles: { main: 'LICENSE INFORMATION', extra: 'ADDITIONAL DETAILS' },
  detect(text) {
    return keywordScore(text, [
      { k: "DRIVER'S LICENSE", w: 4 }, { k: 'DRIVERS LICENSE', w: 0 }, { k: 'License No', w: 2 }, { k: 'Expiration Date', w: 2 },
      { k: 'Agency Code', w: 2 }, { k: 'DL Codes', w: 1 }, { k: 'Conditions', w: 1 }, { k: 'Blood Type', w: 2 },
      { k: 'Eyes Color', w: 1 }, { k: 'Nationality', w: 1 }, { k: 'Date of Birth', w: 1 }, { k: 'Restrictions', w: 1 },
      { k: 'Weight', w: 1 }, { k: 'Height', w: 1 },
    ], [{ re: LICNO_RE, w: 3, name: 'license-number pattern' }]);
  },
  fields,
  cardTemplate,
  ignoreWords,
  afterZones(f) { splitName(f); },
  stopLabels: ['Signature of Licensee', 'Assistant Secretary', 'LTO Chief', 'REPUBLIC OF THE PHILIPPINES', 'DEPARTMENT OF TRANSPORTATION', 'LAND TRANSPORTATION OFFICE',
    "DRIVER'S LICENSE", "NON-PROFESSIONAL DRIVER'S LICENSE", "PROFESSIONAL DRIVER'S LICENSE"],
  critical: {
    license_no: 'License number could not be read. Retake the photo with better lighting, card flat and in focus.',
    full_name: 'Name could not be read. Retake the photo closer to the card, avoiding glare.',
    date_of_birth: 'Date of birth could not be read clearly — check it against the card.',
    expiration_date: 'Expiration date could not be read clearly — check it against the card.',
  },
  cutoffMessage: 'Part of the license may be cut off or covered. Upload a photo showing the whole card.',
  postProcess,
  messages,
  extract(ocr) { return runExtractor(this, ocr); },
};
