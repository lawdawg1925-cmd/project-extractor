// Unit tests: extractors on hand-written OCR text fixtures (no OCR involved) + format validators.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import license from '../app/js/extractors/license.js';
import cr from '../app/js/extractors/cr.js';
import * as registry from '../app/js/extractors/registry.js';
import * as F from '../app/js/core/formats.js';
import { fromPlainText } from '../app/js/core/layout.js';
import { toText, toCSV, toJSON } from '../app/js/core/output.js';
import { mergeReads } from '../app/js/extractors/base.js';

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
eq('cr vin NF', r.vin.status, 'NOT FOUND'); eq('cr vin hidden (old layout)', r.vin.hidden, true);
eq('cr make', r.make.value, 'TOYOTA'); eq('cr series', r.series.value, 'COROLLA ALTIS'); eq('cr body', r.body_type.value, 'SEDAN');
eq('cr year fixed', r.year_model.value, '2019'); eq('cr year VERIFY', r.year_model.status, 'VERIFY');
eq('cr color', r.color.value, 'SILVER METALLIC'); eq('cr fuel', r.fuel.value, 'GAS'); eq('cr denomination', r.denomination.value, 'CAR');
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
eq('text header', txt.startsWith('VEHICLE INFORMATION\n\nMV File No.: 1305-00000445566\nPlate No.: ABC 1234 [VERIFY]'), true);
eq('text skips hidden', /\nVIN:|Max Power/.test(txt), false);
eq('csv rows', toCSV(res).trim().split('\r\n').length, 2);

// --- ruled CR fixtures (fictitious data; "|" = box border, "+---+" = horizontal rule)
{
  const rr = (f) => Object.fromEntries(cr.extract(load(f)).fields.map((x) => [x.key, x]));
  const o = rr('cr_old_ruled.txt');
  eq('old layout detected', o.mv_file_no.layout, 'old');
  eq('old mv', o.mv_file_no.value, '1310-00000123123'); eq('old mv OK', o.mv_file_no.status, 'OK');
  eq('old blank plate NF', o.plate_no.status, 'NOT FOUND'); eq('old blank plate note', /^Blank/.test(o.plate_no.note), true);
  eq('old engine', o.engine_no.value, 'KF31E9876543'); eq('old chassis', o.chassis_no.value, 'MH1KF3110KK654321');
  eq('old denomination', o.denomination.value, 'MOTORCYCLE WITHOUT SIDE CAR'); eq('old cyl', o.cylinders.value, '1');
  eq('old body type fixed', o.body_type.value, 'MOTORCYCLE'); eq('old body type VERIFY', o.body_type.status, 'VERIFY');
  eq('old body no blank', o.body_no.status, 'NOT FOUND'); eq('old year', o.year_model.value, '2019');
  eq('old gross', o.gross_wt.value, '230'); eq('old shipping', o.shipping_wt.value, '105'); eq('old net cap', o.net_capacity.value, '125');
  eq('old owner (not the receipt payer)', o.owner_name.value, 'SANTOS, MARIA CLARA L.');
  eq('old address', o.owner_address.value, '45 MABINI ST., SAN ROQUE, LEGAZPI CITY, ALBAY');
  eq('old encumbered blank', o.encumbered_to.status, 'NOT FOUND');
  eq('old OR no (not the receipt no.)', o.or_no.value, '1234567890123'); eq('old OR date', o.or_date.value, 'March 15, 2019');
  eq('old amount (not the receipt amount)', o.amount.value, '1,250.00');
  eq('old CR no numeric', o.cr_no.value, '123456789'); eq('old CR date', o.date_registered.value, 'March 15, 2019');
  eq('old office code not from receipt', o.office_code.value, '');
  eq('old new-only fields hidden', ['vin', 'vehicle_type', 'vehicle_category', 'max_power', 'color', 'classification', 'passenger_capacity', 'year_rebuilt', 'remarks'].every((k) => o[k].hidden), true);
  const allOld = Object.values(o).map((x) => x.value).join(' | ');
  eq('old signatory never copied', /DELA PAZ|CHIEF|REYES|9988776655|0999|9,999/i.test(allOld), false);
  eq('VALIDONLYWHENSIGNED never CR No.', /VALID/i.test(o.cr_no.value), false);

  const n = rr('cr_new_ruled.txt');
  eq('new layout detected', n.mv_file_no.layout, 'new');
  eq('new plate', n.plate_no.value, 'NBC 4321'); eq('new mv', n.mv_file_no.value, '0412-00000765432');
  eq('new engine from box position', n.engine_no.value, '2NR7654321'); eq('new engine VERIFY', n.engine_no.status, 'VERIFY');
  eq('new chassis', n.chassis_no.value, 'PA1BB3HE0P1234567');
  eq('new VIN N/A kept', n.vin.value, 'N/A'); eq('new VIN N/A OK', n.vin.status, 'OK');
  eq('new vehicle type', n.vehicle_type.value, 'CAR'); eq('new category', n.vehicle_category.value, 'M1'); eq('new make', n.make.value, 'TOYOTA');
  eq('new capacity', n.passenger_capacity.value, '5'); eq('new color', n.color.value, 'PEARL WHITE'); eq('new fuel', n.fuel.value, 'GASOLINE');
  eq('new class', n.classification.value, 'PRIVATE'); eq('new body', n.body_type.value, 'SEDAN'); eq('new series', n.series.value, 'VIOS 1.3 XLE');
  eq('new gross', n.gross_wt.value, '1550'); eq('new net', n.net_wt.value, '1075'); eq('new year', n.year_model.value, '2023');
  eq('new rebuilt N/A', n.year_rebuilt.value, 'N/A'); eq('new piston', n.piston_displacement.value, '1329'); eq('new power N/A', n.max_power.value, 'N/A');
  eq('new owner', n.owner_name.value, 'DELA CRUZ, ROSA M.'); eq('new address', n.owner_address.value, '12 RIZAL AVE., POBLACION, SAN PABLO CITY, LAGUNA');
  eq('new encumbered N/A', n.encumbered_to.value, 'N/A'); eq('new OR', n.or_no.value, '000000301234567'); eq('new amount', n.amount.value, 'PHP 3,210.50');
  eq('new remarks blank', n.remarks.status, 'NOT FOUND');
  eq('new CR no at bottom', n.cr_no.value, '0012345678'); eq('new field office', n.field_office.value, 'SAN PABLO DISTRICT OFFICE');
  eq('new office code', n.office_code.value, '0412'); eq('new CR date', n.date_registered.value, 'June 30, 2023');
  eq('new old-only fields hidden', ['denomination', 'cylinders', 'body_no', 'shipping_wt', 'net_capacity', 'telephone'].every((k) => n[k].hidden), true);
  eq('new signatory never copied', /LOPEZ|CHIEF/i.test(Object.values(n).map((x) => x.value).join(' ')), false);

  // exports: hidden fields left out, group heading present
  const resN = { docType: 'cr', sectionTitles: cr.sectionTitles, fields: cr.extract(load('cr_new_ruled.txt')).fields };
  const tn = toText(resN);
  eq('text group heading', tn.includes('\nDetails of First Registration\nO.R. No.: 000000301234567'), true);
  eq('text no hidden', /Denomination|Shipping Wt/.test(tn), false);
  eq('text Other section', /\n\nOTHER\n\nCR No\.: 0012345678/.test(tn), true);
  const csv = toCSV(resN);
  eq('csv no hidden', /Denomination/.test(csv), false); eq('csv group label', csv.includes('O.R. No. (Details of First Registration)'), true);
  const js = JSON.parse(toJSON(resN));
  eq('json no hidden', 'denomination' in js.fields, false); eq('json layout', js.form_layout, 'LTO Form No. 3 (Revised December 2020)');
  eq('json group', js.fields.or_no.group, 'Details of First Registration');
}
eq('denomination spaces lost', cr.fields.find((x) => x.key === 'denomination').format('LEWITHOUTSIDECAR').value, 'LE WITHOUT SIDE CAR');
eq('year range', cr.fields.find((x) => x.key === 'year_model').format('1949').ok, false);
eq('cylinders range', cr.fields.find((x) => x.key === 'cylinders').format('40').ok, false);
eq('fuel fix VERIFY', cr.fields.find((x) => x.key === 'fuel').format('DIESFL').fixed, true);
{
  const sf = cr.fields.find((x) => x.key === 'series').format;
  eq('series bracket → I (VERIFY)', sf('CLICK 125]').value + '|' + sf('CLICK 125]').fixed, 'CLICK 125I|true');
  eq('series clean untouched', sf('VIOS 1.5 G CVT').fixed, false);
  // whole-page reading with more spaces wins over a box reading that lost a space; never OK
  const mk = (v, c) => ({ key: 'series', label: 'Series', value: v, raw: v, status: 'OK', confidence: c, note: '' });
  const m = mergeReads([[mk('VIOS 1.5G CVT', 90)], [mk('VIOS 1.5G CVT', 90)]], { fallback: [mk('VIOS 1.5 G CVT', 92)] });
  eq('spacing: page value kept as VERIFY', m[0].value + '|' + m[0].status, 'VIOS 1.5 G CVT|VERIFY');
}

console.log(`\nUnit tests: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
