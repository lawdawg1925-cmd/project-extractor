// Card-layout re-reading (licenses), photo-header parsing and engine error messages.
// Hand-made OCR words / bytes only (fictitious data, no real documents, no OCR engine).
import license from '../app/js/extractors/license.js';
import { fitCard, readCardZones, voteWords } from '../app/js/core/zones.js';
import { parseImageInfo } from '../app/js/core/imageload.js';
import { explainEngineError } from '../app/js/core/ocr-browser.js';
import { fromPlainText } from '../app/js/core/layout.js';
import { STATUS } from '../app/js/core/status.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
const T = license.cardTemplate;

// OCR words for the printed labels of a card placed at (bx, by) with size (ax × ay) pixels
function cardOcr({ ax, bx, ay, by, keys = Object.keys(T.anchors) }) {
  const lines = keys.map((k, i) => {
    const a = T.anchors[k], lab = a.labels[0], x0 = bx + a.x * ax, yc = by + a.y * ay, h = ay * 0.028;
    let x = x0; const words = lab.split(' ').map((t) => { const w = { text: t, conf: 90, bbox: { x0: x, y0: yc - h / 2, x1: x + t.length * ax * 0.009, y1: yc + h / 2 } }; x = w.bbox.x1 + ax * 0.006; return w; });
    return { text: lab, words, idx: i };
  });
  return { lines, words: lines.flatMap((l) => l.words), text: lines.map((l) => l.text).join('\n'), meanConf: 90 };
}

{
  const m = fitCard(T, [cardOcr({ ax: 1900, bx: 40, ay: 1197, by: 30 })], { width: 2000, height: 1260, aspect: T.aspect });
  eq('card fit found', !!m, true);
  eq('card fit uses many labels', m && m.n >= 10, true);
  eq('card fit scale x', m && Math.abs(m.ax - 1900) < 5, true);
  eq('card fit offset y', m && Math.abs(m.by - 30) < 5, true);
  // a card that is not the shape of an ID card (squeezed) is not used
  eq('wrong card shape → no fit', fitCard(T, [cardOcr({ ax: 1900, bx: 40, ay: 600, by: 30 })], { width: 2000, height: 1260, aspect: T.aspect }), null);
  // two labels are not enough to place the card
  eq('two labels → no fit', fitCard(T, [cardOcr({ ax: 1900, bx: 40, ay: 1197, by: 30, keys: ['address', 'sex'] })], { width: 2000, height: 1260, aspect: T.aspect }), null);
  // a misplaced label (another document's layout) is dropped as an outlier, the fit still holds
  const o = cardOcr({ ax: 1900, bx: 40, ay: 1197, by: 30 });
  o.lines[0].words.forEach((w) => { w.bbox.y0 += 300; w.bbox.y1 += 300; });
  const m2 = fitCard(T, [o], { width: 2000, height: 1260, aspect: T.aspect });
  eq('outlier label dropped', m2 && !m2.keys.includes('full_name') && Math.abs(m2.ax - 1900) < 5, true);
}

// zone re-reading with a stand-in OCR: answers depend on the character whitelist of the field
{
  const img = { width: 2000, height: 1260, data: new Uint8ClampedArray(2000 * 1260 * 4).fill(255) };
  const ocr = cardOcr({ ax: 1900, bx: 40, ay: 1197, by: 30 });
  const fields = license.fields.map((d) => ({ key: d.key, label: d.label, value: '', status: STATUS.NOT_FOUND, note: 'Label not found on the image.', confidence: null }));
  const set = (k, v, st, c = 95) => Object.assign(fields.find((f) => f.key === k), { value: v, status: st, confidence: c, note: '' });
  set('license_no', 'D12-34-567890', STATUS.OK);
  set('full_name', 'DELA CRUZ, JUAN SANTOSQ', STATUS.VERIFY, 30);
  let calls = 0, n = 0;
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00D1';
  const answers = {
    [L + ' ']: () => ['BLACK', 'BLACK', 'BLACK', 'BLACK'],                                // eye colour
    [L]: () => ['PHL', 'PHL', 'PNL', 'PHL'],                                                 // nationality
    [L + ",.-' "]: () => ['DELA CRUZ, JUAN SANTOS', 'DELA CRUZ, JUAN SANTOSQ', 'DELA CRUZ, JUAN SANTQS', 'DELA CRUZ, JUAN SANTOS'],
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789': () => ['E12', 'E12', 'E12', 'E12'],             // agency code (low confidence)
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,/ ': () => ['QX', 'ZZ7', 'K', 'W1'],               // conditions: junk only
  };
  const lowConf = new Set(['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']);
  const recognize = async (im, { whitelist }) => {
    calls++;
    const list = answers[whitelist] ? answers[whitelist]() : [];
    const t = list[n++ % 4] || '';
    const conf = lowConf.has(whitelist) ? 20 : 88;
    return { text: t, confidence: conf, words: t ? t.split(' ').map((w) => ({ text: w, confidence: conf, symbols: [] })) : [] };
  };
  const changed = await readCardZones(fields, license.fields, T, img, [ocr], recognize);
  const f = (k) => fields.find((x) => x.key === k);
  eq('zones changed fields', changed >= 4, true);
  eq('eye colour read from its place', f('eye_color').value, 'BLACK');
  eq('eye colour is VERIFY', f('eye_color').status, STATUS.VERIFY);
  eq('nationality by majority', f('nationality').value, 'PHL');
  eq('agency code: 3+ agreeing strict reads', f('agency_code').value, 'E12');
  eq('name: word-by-word vote fixes one bad letter', f('full_name').value, 'DELA CRUZ, JUAN SANTOS');
  eq('name stays VERIFY', f('full_name').status, STATUS.VERIFY);
  eq('junk reads → conditions stays NOT FOUND', f('conditions').status, STATUS.NOT_FOUND);
  eq('an OK field is not re-read or changed', f('license_no').value, 'D12-34-567890');
  eq('nothing became OK', fields.filter((x) => x.status === STATUS.OK).length, 1);
  eq('no fit → nothing read', await readCardZones(fields.map((x) => ({ ...x, value: '', status: STATUS.NOT_FOUND })), license.fields, T, img, [cardOcr({ ax: 1900, bx: 40, ay: 1197, by: 30, keys: ['sex'] })], recognize), 0);
}

{
  const v = voteWords([{ fmt: { value: 'DELA CRUZ, JUAN SANTOS' }, conf: 86 }, { fmt: { value: 'DELA CRUZ, JUAN SANTOSQ' }, conf: 9 }, { fmt: { value: 'DELA CRUZ, JUAN SANTQS' }, conf: 90 }, { fmt: { value: 'DELA CRUZ, JUAN SANTOS' }, conf: 57 }]);
  eq('vote: supported words win', v && v.text, 'DELA CRUZ, JUAN SANTOS');
  eq('vote: support counted', v && v.n, 2);
  eq('vote: no majority for a word → weak', voteWords([{ fmt: { value: 'A B' }, conf: 80 }, { fmt: { value: 'A C' }, conf: 80 }]).n, 1);
  // DL codes with the small commas lost
  const dl = T.zones.dl_codes.format;
  eq('DL codes without commas split', dl('AA1,BB1,B2').value, 'A, A1, B, B1, B2');
  eq('DL codes split ok', dl('AA1,BB1,B2').ok, true);
  eq('DL codes junk rejected', dl('AXB').ok, false);
}

// the LTO signatory's printed name is never a value (new cards: Edgar C. Galvante; older: Atty. Vigor D. Mendoza II)
for (const sig of ['EDGAR C. GALVANTE', 'ATTY. VIGOR D. MENDOZA II']) {
  const txt = ['DRIVER\'S LICENSE', 'Last Name, First Name, Middle Name', 'DELA CRUZ, JUAN SANTOS', 'Nationality  Sex  Date of Birth', 'PHL  M  1990/01/15',
    'Address', '123 RIZAL ST NAGA CITY', 'License No.   Expiration Date   Agency Code', 'D12-34-567890   2031/01/15   D12', 'Blood Type   Eyes Color', 'O+   BLACK',
    'DL Codes      Conditions', `A,B           NONE ${sig}`, 'Signature of Licensee           Assistant Secretary'].join('\n');
  const r = Object.fromEntries(license.extract(fromPlainText(txt)).fields.map((x) => [x.key, x]));
  eq(`conditions without signatory (${sig.split(' ')[0]})`, r.conditions.value, 'NONE');
  eq(`signatory not even read into a note (${sig.split(' ')[0]})`, /GALVANTE|MENDOZA/.test(r.conditions.note || ''), false);
  eq(`no field holds the signatory (${sig.split(' ')[0]})`, Object.values(r).some((x) => /GALVANTE|MENDOZA|EDGAR|VIGOR/.test(String(x.value))), false);
}

// photo headers: size + EXIF orientation read without decoding the photo
{
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
  const app1 = [...Buffer.from('Exif\0\0', 'binary'), ...tiff];
  const sof = [0xff, 0xc0, 0, 17, 8, 3000 >> 8, 3000 & 255, 4000 >> 8, 4000 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, ...sof, 0xff, 0xd9]);
  const i = parseImageInfo(jpg);
  eq('jpeg width', i && i.w, 4000); eq('jpeg height', i && i.h, 3000); eq('jpeg orientation', i && i.orientation, 6);
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(png.buffer).setUint32(16, 8000); new DataView(png.buffer).setUint32(20, 6000);
  const p = parseImageInfo(png);
  eq('png size', p && `${p.w}x${p.h}`, '8000x6000');
  eq('not an image', parseImageInfo(new Uint8Array([1, 2, 3, 4, 5])), null);
}

// engine errors in plain words
eq('out of memory explained', explainEngineError(new Error('RuntimeError: Aborted(OOM)')), 'the phone ran out of memory while reading the photo');
eq('wasm memory explained', explainEngineError('RuntimeError: memory access out of bounds'), 'the phone ran out of memory while reading the photo');
eq('empty error explained', /engine files could not be loaded/.test(explainEngineError(undefined)), true);
eq('timeout kept', explainEngineError(new Error('The text-recognition engine stopped responding.')), 'The text-recognition engine stopped responding');

console.log(`\nCard layout / photo loading tests: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
