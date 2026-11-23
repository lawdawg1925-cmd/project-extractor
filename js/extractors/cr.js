// LTO Certificate of Registration (CR) extractor.
import { keywordScore, makeField, runExtractor } from './base.js';
import * as F from '../core/formats.js';
import { STATUS } from '../core/status.js';

const NOW = new Date().getFullYear();
const MV_RE = /\b\d{4}\s?-\s?\d{11}\b/;

const fields = [
  // ---- main block (same order as the encoding sample) ----
  { key: 'plate_no', label: 'Plate No.', labels: ['Plate No.', 'Plate Number'], refine: { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -' }, format: F.plate },
  { key: 'mv_file_no', label: 'MV File No.', labels: ['MV File No.', 'MV File Number', 'File No.'], refine: { whitelist: '0123456789-' }, format: F.mvFile,
    fallback: (ocr) => { const m = ocr.text.match(MV_RE); if (!m) return null; const r = F.mvFile(m[0]); return r.ok ? { value: r.value, raw: m[0], conf: 0 } : null; } },
  { key: 'engine_no', label: 'Engine No.', labels: ['Engine No.', 'Engine Number', 'Motor No.'], format: F.serial },
  { key: 'chassis_no', label: 'Chassis No.', labels: ['Chassis No.', 'Chassis Number', 'Serial No.'], format: F.serial },
  { key: 'vin', label: 'VIN', labels: ['VIN', 'Vehicle Identification Number', 'VIN No.'], labelOpts: { exact: true }, where: 'auto', format: F.vin, optional: true, alwaysShow: true },
  { key: 'make', label: 'Make', labels: ['Make', 'Make/Brand', 'Brand'], labelOpts: { exact: true }, format: F.text },
  { key: 'series', label: 'Model / Series', labels: ['Series', 'Model'], labelOpts: { exact: true }, format: F.text },
  { key: 'year_model', label: 'Year Model', labels: ['Year Model', 'Year'], refine: { whitelist: '0123456789' }, format: F.year },
  { key: 'vehicle_type', label: 'Vehicle Type', labels: ['Denomination', 'Vehicle Type'], format: F.text },
  { key: 'body_type', label: 'Body Type', labels: ['Body Type', 'Type of Body'], refine: { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ -/' }, format: F.text },
  { key: 'color', label: 'Color', labels: ['Color', 'Colour'], labelOpts: { exact: true }, format: F.text },
  { key: 'fuel', label: 'Fuel', labels: ['Fuel', 'Type of Fuel', 'Fuel Type'], format: F.text },
  { key: 'owner_name', label: 'Registered Owner', labels: ["Owner's Name", 'Owner Name', 'Registered Owner', 'Name of Owner', 'Owner'], format: F.text },
  { key: 'owner_address', label: 'Address', labels: ['Address', "Owner's Address"], multiline: true, maxLines: 2, format: F.text },
  // ---- additional details ----
  { key: 'cr_no', label: 'CR No.', section: 'extra', labels: ['CR No.', 'CR Number', 'Certificate No.'], where: 'auto',
    format: (s) => { const v = s.toUpperCase().replace(/\s/g, ''); return /^[0-9A-Z\-]{6,14}$/.test(v) ? { ok: true, value: v } : { ok: false, value: v, note: 'Unexpected CR number format.' }; } },
  { key: 'date_registered', label: 'CR Date', section: 'extra', labels: [{ label: 'Date', opts: { maxDist: 1, lineStart: true } }, 'Date Registered', 'Date of Registration', 'Date Issued'], where: 'auto', refine: { whitelist: '0123456789/' }, format: (s) => F.date(s, { minYear: 1960, maxYear: NOW + 1 }) },
  { key: 'piston_displacement', label: 'Piston Displacement', section: 'extra', labels: ['Piston Displacement', 'Piston Displ.', 'Displacement'], refine: { whitelist: '0123456789' }, format: (s) => F.number(s.replace(/\s*CC$/i, ''), { min: 40, max: 20000 }) },
  { key: 'cylinders', label: 'No. of Cylinders', section: 'extra', labels: ['Number of Cylinders', 'No. of Cylinders', 'Number of Cyl', 'No. of Cyl.', 'Cylinders'], refine: { whitelist: '0123456789' }, format: (s) => F.number(s, { min: 1, max: 16 }) },
  { key: 'gross_wt', label: 'Gross Wt.', section: 'extra', labels: ['Gross Wt.', 'Gross Weight'], refine: { whitelist: '0123456789' }, format: (s) => F.number(s, { min: 50, max: 60000 }) },
  { key: 'net_wt', label: 'Net Wt.', section: 'extra', labels: ['Net Wt.', 'Net Weight'], refine: { whitelist: '0123456789' }, format: (s) => F.number(s, { min: 30, max: 60000 }) },
  { key: 'net_capacity', label: 'Net Capacity', section: 'extra', labels: ['Net Capacity'], format: F.text },
  { key: 'classification', label: 'Classification', section: 'extra', labels: ['Classification'], format: F.text },
];

function postProcess(f) {
  // VIN: only from an explicit VIN label. If absent, hint when the chassis number is VIN-shaped.
  const ch = f.chassis_no;
  if (f.vin.status === STATUS.NOT_FOUND) {
    const r = ch.value ? F.vin(ch.value) : null;
    f.vin.note = r && r.ok && !r.fixed
      ? `No separate VIN on this CR. The Chassis No. (${ch.value}) has the 17-character VIN format — use it as VIN only if your form allows.`
      : 'No VIN label on this CR.';
  } else if (ch.value && f.vin.value && ch.value !== f.vin.value && ch.value.length === 17) {
    f.vin.status = STATUS.VERIFY; f.vin.note = 'VIN differs from Chassis No. — check both.';
  }
  if (f.owner_name.value && /\d/.test(f.owner_name.value) && f.owner_name.status === STATUS.OK) {
    f.owner_name.status = STATUS.VERIFY; f.owner_name.note = 'Name contains digits — check it.';
  }
}

export default {
  id: 'cr',
  label: 'Certificate of Registration (CR)',
  sectionTitles: { main: 'VEHICLE INFORMATION', extra: 'ADDITIONAL DETAILS' },
  detect(text) {
    return keywordScore(text, [
      { k: 'CERTIFICATE OF REGISTRATION', w: 5 }, { k: 'MV File', w: 3 }, { k: 'Engine No', w: 2 }, { k: 'Chassis No', w: 2 },
      { k: 'Plate No', w: 2 }, { k: 'Piston Displacement', w: 2 }, { k: 'Gross Wt', w: 1 }, { k: 'Net Capacity', w: 1 },
      { k: 'Series', w: 1 }, { k: 'Body Type', w: 1 }, { k: 'Year Model', w: 1 }, { k: 'Fuel', w: 1 }, { k: 'Denomination', w: 1 },
      { k: 'Number of Cylinders', w: 1 },
    ], [{ re: MV_RE, w: 2, name: 'MV-file pattern' }]);
  },
  fields,
  stopLabels: ['Body No.', 'Shipping Wt.', 'REPUBLIC OF THE PHILIPPINES', 'DEPARTMENT OF TRANSPORTATION', 'LAND TRANSPORTATION OFFICE', 'CERTIFICATE OF REGISTRATION'],
  critical: {
    plate_no: 'Plate number could not be read. Retake the photo with better lighting and the CR flat.',
    mv_file_no: 'MV File No. could not be read. Retake the photo closer to the top part of the CR.',
    engine_no: 'Engine number could not be read clearly — check it against the CR.',
    chassis_no: 'Chassis number could not be read clearly — check it against the CR.',
    owner_name: 'Registered owner could not be read — check that the bottom of the CR is in the photo.',
  },
  cutoffMessage: 'CR appears partially cut off or covered. Please upload a photo of the complete document.',
  postProcess,
  extract(ocr) { return runExtractor(this, ocr); },
};
