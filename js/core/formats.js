// Format validators / normalizers for strict-format fields.
// Each returns { ok, value, fixed, note, display? }.
//  ok    – value matches the expected format (after optional fixes)
//  fixed – OCR look-alike characters were corrected (O→0, I→1 …) → caller must mark [VERIFY]
// Look-alike fixes are applied ONLY where the format makes the intended character certain
// (e.g. a digit-only position), never to free text such as names or engine numbers.
import { cleanValue } from './text.js';

const TO_DIGIT = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', '|': '1', '!': '1', T: '1', J: '1', Z: '2', S: '5', B: '8', G: '6', A: '4', E: '8' };
const TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 8: 'B', 7: 'T' };

function fixDigits(s) {
  let fixed = false;
  const out = [...s].map((ch) => { if (/\d/.test(ch)) return ch; const d = TO_DIGIT[ch.toUpperCase()]; if (d) { fixed = true; return d; } return ch; }).join('');
  return { out, fixed };
}
function fixLetters(s) {
  let fixed = false;
  const out = [...s].map((ch) => { if (/[A-Z]/.test(ch)) return ch; const l = TO_LETTER[ch]; if (l) { fixed = true; return l; } return ch; }).join('');
  return { out, fixed };
}
const res = (ok, value, fixed = false, note = '') => ({ ok, value, fixed, note });

/** LTO driver's license number, e.g. D12-34-567890 (letter, 2 digits - 2 digits - 6 digits). */
export function licenseNo(raw) {
  const s = cleanValue(raw).toUpperCase().replace(/[\s.,_:]/g, '').replace(/[—–~]/g, '-');
  if (/^[A-Z]\d{2}-\d{2}-\d{6}$/.test(s)) return res(true, s);
  const compact = s.replace(/-/g, '');
  if (compact.length === 11) {
    const a = fixLetters(compact[0]);
    const b = fixDigits(compact.slice(1));
    const v = `${a.out}${b.out.slice(0, 2)}-${b.out.slice(2, 4)}-${b.out.slice(4)}`;
    if (/^[A-Z]\d{2}-\d{2}-\d{6}$/.test(v)) {
      const fixed = a.fixed || b.fixed;
      return res(true, v, fixed, fixed ? 'Look-alike characters corrected (e.g. O→0, I→1) — check against the card.' : (s.includes('-') ? '' : 'Dashes added to standard format.'));
    }
  }
  const pre = s.match(/^([A-Z0-9]\d{2}-\d{2}-\d{6})(.+)$/);
  if (pre) { const r = licenseNo(pre[1]); if (r.ok) return res(true, r.value, true, `Extra characters after the number were removed ("${pre[2]}") — check against the card.`); }
  return res(false, s, false, 'Does not match LTO license number format (e.g. A12-34-567890).');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map((m) => m.slice(0, 3).toUpperCase());

/**
 * Dates: accepts YYYY/MM/DD, YYYY-MM-DD, MM/DD/YYYY, DD-MON-YYYY, "January 15, 1990".
 * Returns value "January 15, 1990" and iso "1990-01-15".
 */
export function date(raw, { minYear = 1900, maxYear = new Date().getFullYear() + 15 } = {}) {
  const s0 = cleanValue(raw).toUpperCase();
  let fixed = false;
  // textual month
  let m = s0.match(/([A-Z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{4})/) || null;
  let y, mo, d;
  if (m && MON3.includes(m[1].slice(0, 3))) { mo = MON3.indexOf(m[1].slice(0, 3)) + 1; d = +m[2]; y = +m[3]; }
  if (!y) { m = s0.match(/(\d{1,2})[\s\-\/]*([A-Z]{3,9})[\s\-\/.]*(\d{4})/); if (m && MON3.includes(m[2].slice(0, 3))) { d = +m[1]; mo = MON3.indexOf(m[2].slice(0, 3)) + 1; y = +m[3]; } }
  if (!y) {
    const f = fixDigits(s0.replace(/[^0-9A-Z\/\-. ]/g, '').replace(/\s+/g, ''));
    const t = f.out;
    m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; fixed = f.fixed; }
    else if ((m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) { mo = +m[1]; d = +m[2]; y = +m[3]; fixed = f.fixed; }
    else if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; fixed = true; }
  }
  let trimmed = false;
  if (!y) {
    const m2 = s0.match(/^(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\s+\S.*$/);
    if (m2) { const r = date(m2[1], { minYear, maxYear }); if (r.ok) { r.fixed = true; r.note = 'Extra characters next to the date were removed — check it.'; return r; } }
    return res(false, cleanValue(raw), false, 'Date format not recognized.');
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const valid = mo >= 1 && mo <= 12 && d >= 1 && dt.getUTCDate() === d && y >= minYear && y <= maxYear;
  if (!valid) return res(false, cleanValue(raw), fixed, 'Date looks invalid — check it.');
  const r = res(true, `${MONTHS[mo - 1]} ${d}, ${y}`, fixed, fixed ? 'Look-alike characters corrected in date — check against the document.' : '');
  r.iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return r;
}

/** Philippine plate number (cars ABC 1234 / ABC 123, motorcycles 123 ABC / 1234 AB / AB 12345, temporary 1234-1234567). */
const PLATE_PATTERNS = [
  { re: /^([A-Z]{3})(\d{3,4})$/, shape: 'LLLD', fmt: (m) => `${m[1]} ${m[2]}` },
  { re: /^(\d{3})([A-Z]{3})$/, shape: 'DDDL', fmt: (m) => `${m[1]} ${m[2]}` },
  { re: /^(\d{4})([A-Z]{2})$/, shape: 'DDDDLL', fmt: (m) => `${m[1]} ${m[2]}` },
  { re: /^([A-Z]{2})(\d{4,5})$/, shape: 'LLD', fmt: (m) => `${m[1]} ${m[2]}` },
];
export function plate(raw) {
  const s = cleanValue(raw).toUpperCase();
  if (/^\d{4}-\d{5,8}$/.test(s.replace(/\s/g, ''))) return res(true, s.replace(/\s/g, ''), false, 'Temporary / conduction number format.');
  const c = s.replace(/[\s\-.]/g, '');
  for (const p of PLATE_PATTERNS) { const m = c.match(p.re); if (m) return res(true, p.fmt(m)); }
  // try look-alike fixes using the split between the letter group and the digit group
  const shapes = [
    [3, 4, 'L'], [3, 3, 'L'], [3, 3, 'D'], [2, 4, 'L'], [4, 2, 'D'], [2, 5, 'L'],
  ];
  for (const [a, b, first] of shapes) {
    if (c.length !== a + b) continue;
    const p1 = c.slice(0, a), p2 = c.slice(a);
    const f1 = first === 'L' ? fixLetters(p1) : fixDigits(p1);
    const f2 = first === 'L' ? fixDigits(p2) : fixLetters(p2);
    const v = f1.out + f2.out;
    for (const p of PLATE_PATTERNS) {
      const m = v.match(p.re);
      if (m && (f1.fixed || f2.fixed)) return res(true, p.fmt(m), true, 'Look-alike characters corrected in plate — check against the document.');
    }
  }
  return res(false, s, false, 'Does not look like a standard PH plate number.');
}

/** MV File Number: usually 15 digits written 0000-00000000000. */
export function mvFile(raw) {
  const s = cleanValue(raw).toUpperCase().replace(/\s/g, '');
  const f = fixDigits(s.replace(/-/g, ''));
  const digits = f.out;
  if (/^\d{15}$/.test(digits)) {
    return res(true, `${digits.slice(0, 4)}-${digits.slice(4)}`, f.fixed, f.fixed ? 'Look-alike characters corrected (O→0, I→1…) — check against the CR.' : '');
  }
  if (/^\d{10,17}$/.test(digits)) return res(false, s, f.fixed, `Unusual MV File No. length (${digits.length} digits; usually 15) — check it.`);
  return res(false, s, false, 'MV File No. should contain digits only (usually 15).');
}

/** VIN: 17 chars, letters I/O/Q never used. */
export function vin(raw) {
  const s = cleanValue(raw).toUpperCase().replace(/[\s\-]/g, '');
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return res(true, s);
  if (s.length === 17 && /^[A-Z0-9]{17}$/.test(s)) {
    const v = s.replace(/I/g, '1').replace(/[OQ]/g, '0');
    return res(true, v, true, 'VIN cannot contain I, O or Q — corrected to 1/0. Check against the CR.');
  }
  return res(false, s, false, 'VIN should be 17 letters/digits.');
}

/** Engine / chassis numbers: free alphanumeric, no look-alike fixes (no fixed format). */
export function serial(raw) {
  const s = cleanValue(raw).toUpperCase();
  const c = s.replace(/\s+/g, '');
  if (!/^[A-Z0-9\-\/]{4,25}$/.test(c)) return res(false, s, false, 'Unexpected characters — check it.');
  let note = '';
  if (c !== s) note = 'Spaces removed — confirm there are no spaces on the document.';
  if (c.length === 17 && /[IOQ]/.test(c)) note = 'Looks like a 17-character VIN but contains I/O/Q (VINs use 1/0) — check each character.';
  return { ok: !note.startsWith('Looks'), value: c, fixed: false, note };
}

export function year(raw) {
  const s = cleanValue(raw).toUpperCase().replace(/\s/g, '');
  const f = fixDigits(s);
  const max = new Date().getFullYear() + 1;
  if (/^\d{4}$/.test(f.out) && +f.out >= 1950 && +f.out <= max) return res(true, f.out, f.fixed, f.fixed ? 'Look-alike characters corrected.' : '');
  return res(false, s, false, 'Year model should be a 4-digit year.');
}

export function number(raw, { decimals = false, min = 0, max = 1e9, unit = '' } = {}) {
  const s = cleanValue(raw).toUpperCase();
  const core = s.replace(new RegExp(`\\s*(${unit || 'KG'})\\.?$`, 'i'), '').replace(/,/g, '');
  const re = decimals ? /^\d+(\.\d+)?$/ : /^\d+$/;
  if (re.test(core) && +core >= min && +core <= max) return res(true, core);
  return res(false, s, false, 'Expected a number — check it.');
}

export function sex(raw) {
  const s = cleanValue(raw).toUpperCase();
  if (/^(M|F|MALE|FEMALE)$/.test(s)) return res(true, s[0]);
  return res(false, s, false, 'Sex should be M or F.');
}

export function bloodType(raw) {
  let s = cleanValue(raw).toUpperCase().replace(/\s/g, '');
  let fixed = false;
  if (/^0[+\-]?$/.test(s)) { s = 'O' + s.slice(1); fixed = true; }
  if (/^[O0]{2}[+\-]$/.test(s)) { s = 'O' + s.slice(2); fixed = true; } // "Oo+" / "OO+": doubled O
  if (/^(A|B|AB|O)[+\-]?$/.test(s)) return res(true, s, fixed, fixed ? 'Read as "0", corrected to blood type "O".' : '');
  return res(false, s, false, 'Blood type should be A, B, AB or O (+/−).');
}

/** LTO agency/district code: a letter + 2 digits (e.g. D12, E01). Look-alikes in the digit part are corrected (VERIFY). */
export function agencyCode(raw) {
  const v = cleanValue(raw).toUpperCase().replace(/\s/g, '');
  if (/^[A-Z]\d{2}$/.test(v)) return res(true, v);
  const m = v.match(/^([A-Z0-9])([0-9OQDILS|]{2})$/);
  if (m) {
    const first = m[1].replace('0', 'O').replace('1', 'I').replace('8', 'B').replace('5', 'S');
    const digits = m[2].replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5');
    if (/^[A-Z]$/.test(first)) return res(true, first + digits, true, `Look-alike characters corrected ("${v}" → "${first + digits}").`);
  }
  return res(false, v, false, 'Agency code is usually a letter + 2 digits (e.g. D12).');
}

/** Address: must be mostly words — rejects values that are really another row (e.g. "M 1983/04/17 70"). */
export function address(raw) {
  const s = cleanValue(raw).toUpperCase();
  const compact = s.replace(/\s/g, '');
  const letters = (compact.match(/[A-Z\u00D1]/g) || []).length;
  if (/\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b|\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}\b/.test(s)) return res(false, s, false, 'Looks like a date/number row, not an address — check it.');
  if (!/[A-Z\u00D1]{3,}/.test(s) || letters / Math.max(1, compact.length) < 0.5) return res(false, s, false, 'Does not look like an address — check it.');
  return res(true, s);
}

/** Conditions on LTO licenses: NONE, or codes A-E / 1-5 (optionally with a description). */
export function conditions(raw) {
  const s = cleanValue(raw).toUpperCase();
  if (/^NONE$/.test(s)) return res(true, 'NONE');
  if (/^NONE\b/.test(s)) return res(true, 'NONE', true, `Extra text after "NONE" was removed ("${s.slice(4).trim()}") — check it.`);
  if (/^[A-E1-5](\s*[,\/]\s*[A-E1-5])*(\s*[-:.]\s*[A-Z][A-Z ,.\/()\-]*)?$/.test(s)) return res(true, s);
  if (/^(AT|MT)$/.test(s)) return res(true, s);
  return res(false, s, false, 'Unusual Conditions value — check it.');
}

/** DL codes on new LTO cards: A, A1, B, B1, B2, C, D, BE, CE (comma separated). */
const DL = ['A', 'A1', 'B', 'B1', 'B2', 'C', 'D', 'BE', 'CE', 'AT', 'MT'];
export function dlCodes(raw) {
  const s = cleanValue(raw).toUpperCase();
  if (/^NONE$/.test(s)) return res(true, 'NONE');
  const parts = s.replace(/\(([AM]T)\)/g, ' $1').split(/[,;.\s]+/).filter(Boolean);
  let fixed = false;
  const out = parts.map((p) => {
    if (DL.includes(p)) return p;
    const q = p.replace(/[IL|!]/g, '1').replace(/^8/, 'B');
    if (DL.includes(q)) { fixed = true; return q; }
    return p;
  });
  const ok = out.length > 0 && out.every((p) => DL.includes(p));
  return res(ok, out.join(', '), fixed, !ok ? 'Unrecognized DL code — valid codes: ' + DL.join(', ') : (fixed ? 'Look-alike characters corrected (e.g. Al→A1).' : ''));
}

/** Restrictions (old cards): digits 1-8 comma separated, or NONE. */
export function restrictions(raw) {
  const s = cleanValue(raw).toUpperCase();
  if (/^NONE$/.test(s)) return res(true, s);
  const f = fixDigits(s.replace(/\s/g, ''));
  if (/^[1-8](,[1-8])*$/.test(f.out)) return res(true, f.out.split(',').join(', '), f.fixed, f.fixed ? 'Look-alike characters corrected.' : '');
  return res(false, s, false, 'Restrictions are usually codes 1-8 (comma separated).');
}

/** Person name as printed "LAST, FIRST MIDDLE". Letters only. */
export function personName(raw) {
  const s = cleanValue(raw).toUpperCase().replace(/\s*,\s*/g, ', ');
  if (/^[A-Z\u00D1][A-Z\u00D1 .'\-]*(, [A-Z\u00D1][A-Z\u00D1 .'\-]*)?$/.test(s)) return res(true, s);
  return res(false, s, false, 'Name contains unexpected characters (digits/symbols) — check it.');
}

/** Generic text: uppercase letters/digits and common punctuation. */
const KEEP_DOT = /\b(JR|SR|INC|CO|CORP|ST|AVE|BRGY|STO|STA|MA|DR|ENGR|ATTY)\.$/i;
export function text(raw) {
  let s = cleanValue(raw);
  // stray trailing period from OCR noise ("SEDAN." → "SEDAN"), but keep real abbreviations ("JR.")
  if (/[A-Za-z0-9]\.$/.test(s) && !KEEP_DOT.test(s)) s = s.slice(0, -1);
  if (!s) return res(false, s, false, '');
  return res(true, s);
}
