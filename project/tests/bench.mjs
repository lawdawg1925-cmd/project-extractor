// Field-recall benchmark for original + simulated low-end-camera photos.
// node tests/bench.mjs TRUTH.json ORIG_DIR DEGRADED_DIR OUT.json [shard/total] [filter]
// TRUTH: { "file.jpg": { type, fields: { key: value|null } } } (value "~TEXT" = suffix match, for cut-off text)
// Each field is scored: ok (correct, OK) | verify (correct, VERIFY) | flagged (wrong, VERIFY) |
// WRONG (wrong value shown as OK = confident error) | miss (no value). Expected-null fields: falsePos if OK.
import fs from 'node:fs';
import path from 'node:path';
import { makeRecognizer } from './node-ocr.mjs';
import { Jimp } from 'jimp';
import { extractDocument } from '../app/js/core/pipeline.js';
import * as F from '../app/js/core/formats.js';

const [truthPath, origDir, degDir, outPath, shard = '0/1', filter = ''] = process.argv.slice(2);
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
const DATE_KEYS = new Set(['date_of_birth', 'expiration_date', 'date_registered', 'or_date']);
const alnum = (s) => String(s).toUpperCase().replace(/[^A-Z0-9/+]/g, '');
const norm = (k, v) => {
  if (DATE_KEYS.has(k)) { const d = F.date(v); return d.ok ? d.value : alnum(v); }
  if (k === 'mv_file_no') return alnum(F.mvFile(v).value || v);
  if (k === 'amount') return String(v).replace(/[^0-9.]/g, '');
  return alnum(v);
};
const same = (k, got, exp) => exp.startsWith('~') ? alnum(got).endsWith(alnum(exp.slice(1))) : norm(k, got) === norm(k, exp);
// same input limit as the app (app.js MAX_SIDE): very large photos are scaled to 3000 px first
async function loadImage(file) {
  const j = await Jimp.read(file);
  const f = Math.min(1, 3000 / Math.max(j.bitmap.width, j.bitmap.height));
  if (f < 1) j.resize({ w: Math.round(j.bitmap.width * f), h: Math.round(j.bitmap.height * f) });
  return { width: j.bitmap.width, height: j.bitmap.height, data: new Uint8ClampedArray(j.bitmap.data) };
}
const PROFILES = (process.env.PROFILES || 'orig,lowA,lowB,lowC,lowD').split(',');
const jobs = [];
for (const [file, t] of Object.entries(truth)) {
  const base = file.replace(/\.[^.]+$/, '');
  jobs.push({ file, img: path.join(origDir, file), profile: 'orig', t });
  for (const p of ['lowA', 'lowB', 'lowC', 'lowD']) jobs.push({ file, img: path.join(degDir, `${base}__${p}.jpg`), profile: p, t });
}
const [si, sn] = shard.split('/').map(Number);
const mine = jobs.filter((j) => PROFILES.includes(j.profile)).filter((j, i) => i % sn === si && (!filter || j.img.includes(filter)) && fs.existsSync(j.img));
const { recognize, terminate } = await makeRecognizer();
const out = [];
for (const j of mine) {
  const img = await loadImage(j.img);
  const r = await extractDocument(img, { recognize, docType: 'auto' });
  const by = Object.fromEntries((r.fields || []).map((f) => [f.key, f]));
  const res = {};
  for (const [k, ev] of Object.entries(j.t.fields)) {
    const f = by[k]; const has = f && f.value && f.status !== 'NOT FOUND' && f.status !== 'NOT READABLE';
    if (ev == null) { res[k] = has && f.status === 'OK' && !/^N\/?A$/i.test(f.value) ? 'falsePos' : 'nullOk'; continue; }
    if (!has) { res[k] = 'miss'; continue; }
    const ok = same(k, f.value, ev);
    res[k] = ok ? (f.status === 'OK' ? 'ok' : 'verify') : (f.status === 'OK' ? 'WRONG' : 'flagged');
    if (!ok) res[k] += ` [${f.value}]`;
  }
  out.push({ file: j.file, profile: j.profile, docType: r.docType, typeOk: r.docType === j.t.type, sec: +(r.ms / 1000).toFixed(1), res });
  console.log(j.file, j.profile, r.docType, (r.ms / 1000).toFixed(1) + 's');
}
await terminate();
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
