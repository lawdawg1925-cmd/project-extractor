// Unit tests: extractors on hand-written OCR text fixtures (no OCR involved) + format validators.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import license from '../app/js/extractors/license.js';
import cr from '../app/js/extractors/cr.js';
import * as registry from '../app/js/extractors/registry.js';
import * as F from '../app/js/core/formats.js';
import { fromPlainText } from '../app/js/core/layout.js';
import { toText, toCSV } from '../app/js/core/output.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
const load = (f) => fromPlainText(fs.readFileSync(path.join(DIR, f), 'utf8'));
const run = (ex, f) => Object.fromEntries(ex.extract(load(f)).fields.map((x) => [x.key, x]));

// --- detection
for (const [f, want] of [['license_new_card.txt', 'license'], ['license_old_ocr_errors.txt', 'license'], ['cr_grid.txt', 'cr'], ['cr_label_colon.txt', 'cr']]) {
  eq(`detect ${f}`, registry.detect(load(f).text)[0].id, want);
}
eq('detect unknown', registry.detect('BARANGAY CLEARANCE\nThis is to certify').every((d) => d.score < registry.MIN_DETECT_SCORE), true);

// --- new license
let r = run(license, 'license_new_card.txt');
eq('lic license_no', r.license_no.value, 'E12-79-001234'); eq('lic license_no status', r.license_no.status, 'OK');
eq('lic name', r.full_name.value, 'GARCIA, PEDRO MANALO');
eq('lic first', r.first_name.value, 'PEDRO'); eq('lic middle', r.middle_name.value, 'MANALO'); eq('lic last', r.last_name.value, 'GARCIA');
eq('lic dob', r.date_of_birth.value, 'May 30, 1979'); eq('lic exp', r.expiration_date.value, 'May 30, 2029');
eq('lic sex', r.sex.value, 'M'); eq('lic weight', r.weight.value, '78'); eq('lic height', r.height.value, '1.75');
eq('lic address', r.address.value, 'BLK 4 LOT 9 SAN FELIPE, NAGA CITY, CAMARINES SUR');
eq('lic dl codes', r.dl_codes.value, 'A, B, B1, B2'); eq('lic restrictions NF', r.restrictions.status, 'NOT FOUND');
eq('lic classification NF', r.classification.status, 'NOT FOUND'); eq('lic conditions', r.conditions.value, 'NONE');
eq('lic blood', r.blood_type.value, 'B+'); eq('lic eyes', r.eye_color.value, 'BLACK'); eq('lic agency', r.agency_code.value, 'E12');

// --- old license with OCR look-alikes → corrected but VERIFY
r = run(license, 'license_old_ocr_errors.txt');
eq('old license_no fixed', r.license_no.value, 'D08-15-007766'); eq('old license_no VERIFY', r.license_no.status, 'VERIFY');
eq('old dob fixed', r.date_of_birth.value, 'November 3, 1992'); eq('old dob VERIFY', r.date_of_birth.status, 'VERIFY');
eq('old blood fixed', r.blood_type.value, 'O+'); eq('old blood VERIFY', r.blood_type.status, 'VERIFY');
eq('old restrictions', r.restrictions.value, '1, 2, 3'); eq('old classification', r.classification.value, 'PROFESSIONAL');
eq('old middle NF', r.middle_name.status, 'NOT FOUND'); eq('old first', r.first_name.value, 'ANA');

// --- missing license number → NOT FOUND (never invented) + actionable message
r = run(license, 'license_missing_number.txt');
eq('missing license_no', r.license_no.status, 'NOT FOUND'); eq('missing license_no value', r.license_no.value, '');
eq('missing weight', r.weight.status, 'NOT FOUND');

// --- CR grid with OCR errors
r = run(cr, 'cr_grid.txt');
eq('cr mv', r.mv_file_no.value, '1305-00000445566'); eq('cr mv OK', r.mv_file_no.status, 'OK');
eq('cr plate fixed', r.plate_no.value, 'ABC 1234'); eq('cr plate VERIFY', r.plate_no.status, 'VERIFY');
eq('cr engine', r.engine_no.value, '1NZ987654'); eq('cr chassis', r.chassis_no.value, 'JTDBT923X01234567');
eq('cr vin NF', r.vin.status, 'NOT FOUND'); eq('cr vin note', /17-character VIN/.test(r.vin.note), true);
eq('cr make', r.make.value, 'TOYOTA'); eq('cr series', r.series.value, 'COROLLA ALTIS'); eq('cr body', r.body_type.value, 'SEDAN');
eq('cr year fixed', r.year_model.value, '2019'); eq('cr year VERIFY', r.year_model.status, 'VERIFY');
eq('cr color', r.color.value, 'SILVER METALLIC'); eq('cr fuel', r.fuel.value, 'GAS'); eq('cr type', r.vehicle_type.value, 'CAR');
eq('cr owner', r.owner_name.value, 'NAGA TRADING CORPORATION'); eq('cr address', r.owner_address.value, 'PANGANIBAN DRIVE, NAGA CITY, CAMARINES SUR');
eq('cr crno', r.cr_no.value, '556677889'); eq('cr date', r.date_registered.value, 'August 1, 2022');
eq('cr piston', r.piston_displacement.value, '1497'); eq('cr cyl', r.cylinders.value, '4'); eq('cr gross', r.gross_wt.value, '1650');
eq('cr net', r.net_wt.value, '1240'); eq('cr capacity', r.net_capacity.value, '5 PERSONS'); eq('cr class', r.classification.value, 'PRIVATE');

// --- CR "Label: value" layout
r = run(cr, 'cr_label_colon.txt');
eq('colon mv', r.mv_file_no.value, '0517-00000778899'); eq('colon plate', r.plate_no.value, '123 ABC');
eq('colon engine', r.engine_no.value, 'KF12E1234567'); eq('colon make', r.make.value, 'YAMAHA'); eq('colon series', r.series.value, 'MIO SPORTY');
eq('colon year', r.year_model.value, '2021'); eq('colon owner', r.owner_name.value, 'CRUZ, ELENA');
eq('colon address NF', r.owner_address.status, 'NOT FOUND'); eq('colon gross NF', r.gross_wt.status, 'NOT FOUND');

// --- real-card regressions (new-style LTO layout, photo slightly tilted)
{
  const ocr = load('license_lto_newstyle_tilted.txt');
  // simulate a tilted photo: each word drops 5% of its x position (right side of a row sinks ~1 line height)
  for (const w of ocr.words) { const dy = Math.round(w.bbox.x0 * 0.05); w.bbox.y0 += dy; w.bbox.y1 += dy; }
  const t = Object.fromEntries(license.extract(ocr).fields.map((x) => [x.key, x]));
  eq('tilt address not the DOB row', t.address.value, '1520 MAGSAYSAY AVE. CONCEPCION GRANDE NAGA CITY');
  eq('tilt dob', t.date_of_birth.value, 'April 17, 1983'); eq('tilt sex', t.sex.value, 'M');
  eq('tilt weight', t.weight.value, '78'); eq('tilt height', t.height.value, '1.64');
  eq('tilt license_no', t.license_no.value, 'E07-15-123987'); eq('tilt exp', t.expiration_date.value, 'April 17, 2033');
  eq('tilt dl codes', t.dl_codes.value, 'A, A1, B, B1, B2'); eq('tilt dl codes status', t.dl_codes.status, 'OK');
  eq('tilt conditions (no signatory)', t.conditions.value, 'NONE'); eq('tilt conditions status', t.conditions.status, 'OK');
  eq('tilt name', t.full_name.value, 'MERCADO, LUIS ANDRES'); eq('tilt agency', t.agency_code.value, 'E07');
  eq('tilt blood', t.blood_type.value, 'O+'); eq('tilt eyes', t.eye_color.value, 'BLACK');
  const all = license.extract(ocr).fields.map((x) => x.value).join(' | ');
  eq('signatory never copied', /FICTICIO|ATTY|SECRETARY/i.test(all), false);
}
eq('address rejects DOB row', F.address('M 1983/04/17 70').ok, false);
eq('address ok', F.address('2146 RIZAL ST. NAGA CITY').ok, true);
eq('agency O→0', F.agencyCode('DO7').value, 'D07');
eq('agency fixed flagged', F.agencyCode('DO7').fixed, true);
eq('agency clean', F.agencyCode('D12').fixed, false);
eq('blood doubled O', F.bloodType('OO+').value, 'O+');
eq('text trailing dot', F.text('SEDAN.').value, 'SEDAN');
eq('text keeps JR.', F.text('DELA CRUZ JR.').value, 'DELA CRUZ JR.');
eq('conditions NONE + junk', F.conditions('NONE ATTY /RAMON/T.').value, 'NONE');
eq('dl codes no spaces', F.dlCodes('A,A1,B,B1,B2').value, 'A, A1, B, B1, B2');

// --- validators
eq('plate car', F.plate('ABC1234').value, 'ABC 1234'); eq('plate mc', F.plate('123 ABC').value, '123 ABC');
eq('plate old mc', F.plate('1234 AB').value, '1234 AB'); eq('plate bad', F.plate('HELLO WORLD').ok, false);
eq('plate fix', F.plate('A8C 1234').fixed, true);
eq('lic ok', F.licenseNo('N01-12-123456').ok, true); eq('lic bad', F.licenseNo('12345').ok, false);
eq('mv 15', F.mvFile('051700000123456').value, '0517-00000123456'); eq('mv short', F.mvFile('12345').ok, false);
eq('vin ok', F.vin('MR2B29F30K1234567').ok, true); eq('vin IOQ fixed', F.vin('MR2B29F3OK1234567').fixed, true);
eq('date ymd', F.date('1990/01/15').value, 'January 15, 1990'); eq('date mdy', F.date('01/15/1990').value, 'January 15, 1990');
eq('date text', F.date('15-JAN-1990').value, 'January 15, 1990'); eq('date invalid', F.date('1990/13/45').ok, false);
eq('dl codes', F.dlCodes('A, Al, B').value, 'A, A1, B');

// --- output format
const res = { docType: 'cr', sectionTitles: cr.sectionTitles, fields: cr.extract(load('cr_grid.txt')).fields };
const txt = toText(res);
eq('text header', txt.startsWith('VEHICLE INFORMATION\n\nPlate No.: ABC 1234 [VERIFY]\nMV File No.: 1305-00000445566'), true);
eq('csv rows', toCSV(res).trim().split('\r\n').length, 2);

console.log(`\nUnit tests: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
