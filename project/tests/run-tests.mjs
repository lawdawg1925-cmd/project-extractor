// End-to-end test: synthetic sample images → full pipeline (same modules as the web app) → compare to expected.json.
// Usage: node tests/run-tests.mjs [filter]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRecognizer, loadImage } from './node-ocr.mjs';
import { extractDocument } from '../app/js/core/pipeline.js';
import { STATUS } from '../app/js/core/status.js';
import * as F from '../app/js/core/formats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/expected.json'), 'utf8'));
const filter = process.argv[2] || '';
const DATE_KEYS = new Set(['date_of_birth', 'expiration_date', 'date_registered']);
const norm = (k, v) => {
  if (v == null) return null;
  if (DATE_KEYS.has(k)) { const d = F.date(v); return d.ok ? d.value : v; }
  if (k === 'mv_file_no') return F.mvFile(v).value;
  return String(v).toUpperCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
};

const { recognize, terminate } = await makeRecognizer();
const summary = [];
let silentTotal = 0;
for (const [file, exp] of Object.entries(expected)) {
  if (filter && !file.includes(filter)) continue;
  const img = await loadImage(path.join(ROOT, 'samples', file));
  const r = await extractDocument(img, { recognize, docType: 'auto' });
  const byKey = Object.fromEntries((r.fields || []).map((f) => [f.key, f]));
  let total = 0, correctOk = 0, correctVerify = 0, flagged = 0, silent = 0, missing = 0, nfOk = 0, nfTotal = 0;
  const problems = [];
  for (const [k, ev] of Object.entries(exp.fields)) {
    const f = byKey[k];
    if (ev == null) {
      nfTotal++;
      if (!f || !f.value || f.status === STATUS.NOT_FOUND) nfOk++;
      else if (f.status === STATUS.OK) { silent++; problems.push(`  ✗ ${k}: expected NOT FOUND, got OK "${f.value}"`); }
      else { nfOk++; problems.push(`  ~ ${k}: expected NOT FOUND, got ${f.status} "${f.value}" (flagged)`); }
      continue;
    }
    total++;
    if (!f || !f.value) { missing++; problems.push(`  - ${k}: expected "${ev}", got ${f ? f.status : 'none'}`); continue; }
    const same = norm(k, f.value) === norm(k, ev);
    if (same && (f.status === STATUS.OK)) correctOk++;
    else if (same) { correctVerify++; problems.push(`  ~ ${k}: correct "${f.value}" but ${f.status} (${f.note})`); }
    else if (f.status === STATUS.OK) { silent++; problems.push(`  ✗ ${k}: expected "${ev}", got OK "${f.value}"  ← SILENT ERROR`); }
    else { flagged++; problems.push(`  ! ${k}: expected "${ev}", got ${f.status} "${f.value}" (flagged)`); }
  }
  silentTotal += silent;
  const acc = total ? (100 * (correctOk + correctVerify) / total) : 0;
  const row = { file, kind: exp.kind, detected: r.docType, typeOk: r.docType === exp.type, rot: r.rotation, mode: r.mode, conf: r.meanConf,
    accuracy: `${correctOk + correctVerify}/${total} (${acc.toFixed(0)}%)`, okCorrect: correctOk, verifyCorrect: correctVerify, flaggedWrong: flagged,
    silentErrors: silent, missing, notFoundRespected: `${nfOk}/${nfTotal}`, sec: (r.ms / 1000).toFixed(1) };
  summary.push(row);
  console.log(`\n=== ${file} [${exp.kind}] → ${r.docType} (rot ${r.rotation}°, ${r.mode}, conf ${r.meanConf}, ${row.sec}s) accuracy ${row.accuracy}, silent errors ${silent}`);
  problems.forEach((p) => console.log(p));
  (r.messages || []).forEach((m) => console.log(`  [msg:${m.level}] ${m.text}`));
}
await terminate();
console.log('\nSUMMARY');
console.table(summary.map(({ file, detected, typeOk, accuracy, verifyCorrect, flaggedWrong, silentErrors, missing, notFoundRespected, sec }) =>
  ({ file, detected, typeOk, accuracy, verifyCorrect, flaggedWrong, silentErrors, missing, notFoundRespected, sec })));
fs.writeFileSync(path.join(ROOT, 'tests/last-results.json'), JSON.stringify(summary, null, 2));
console.log(silentTotal === 0 ? 'PASS: no silent errors (every wrong/missing value was flagged).' : `FAIL: ${silentTotal} silent error(s).`);
process.exitCode = silentTotal === 0 && summary.every((s) => s.typeOk) ? 0 : 1;
