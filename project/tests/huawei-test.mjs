// Low-end Android / Huawei robustness test of the real web app (synthetic samples only).
// Mobile emulation (Huawei Browser user agent, small screen, 2 GB deviceMemory), then:
//  - very large camera photos (4000×3000, 8000×6000, and a 4000×3000 photo stored sideways with EXIF
//    orientation 6) must load at a safe size, the right way up, and extract;
//  - the OCR engine without WebAssembly SIMD (plain build), and with a SIMD build that fails to load
//    (automatic fallback to the plain build);
//  - a browser without WebAssembly, and a missing engine file, must show "Scan failed: …" + retry
//    instead of freezing;
//  - a page reload while the camera was open must explain what happened.
// Usage: node tests/huawei-test.mjs   (needs Google Chrome; CHROME_PATH to override)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { Jimp } from 'jimp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'grx-hw-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gz': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };
let mode = 'normal';
const served = [];
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html');
  const p = path.join(APP, rel);
  if (req.headers['sec-fetch-dest'] !== 'empty') served.push(rel); // not the service worker's offline copy
  if (mode === 'brokensimd' && /tesseract-core-simd-lstm\.wasm\.js$/.test(p)) { res.writeHead(404); return res.end(); }
  if (mode === 'noworker' && /worker\.min\.js$/.test(p)) { res.writeHead(404); return res.end(); }
  if (!p.startsWith(APP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  if (mode === 'nosimd' && /worker\.min\.js$/.test(p)) {
    // this device "has no SIMD": the engine's feature test fails, so it loads its plain build
    res.end('WebAssembly.validate = function () { return false; };\n' + fs.readFileSync(p, 'utf8')); return;
  }
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (Linux; Android 10; HUAWEI Y7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/14.0.5.302 Mobile Safari/537.36';

// ---- synthetic big photos from the synthetic license sample ----
function exifOrientation(jpeg, o) {
  // APP1 "Exif" segment with one IFD entry: Orientation (0x0112) = o, inserted right after SOI
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}
async function bigPhoto(name, w, h, { orient = 1 } = {}) {
  const src = await Jimp.read(path.join(ROOT, 'samples', 'license_clean.png'));
  const bg = new Jimp({ width: w, height: h, color: 0x3a3a3aff });
  const cw = Math.round(w * 0.8), ch = Math.round(cw * src.bitmap.height / src.bitmap.width);
  src.resize({ w: cw, h: ch });
  bg.composite(src, Math.round((w - cw) / 2), Math.round((h - ch) / 2));
  if (orient === 6) bg.rotate(90); // stored sideways (jimp rotates counter-clockwise); EXIF 6 turns it back
  let buf = await bg.getBuffer('image/jpeg', { quality: 85 });
  if (orient !== 1) buf = exifOrientation(buf, orient);
  const f = path.join(TMP, name); fs.writeFileSync(f, buf); return f;
}

let ok = true;
const results = [];
async function run(name, { file, setup, expect, waitMs = 240000, cpu = 1 }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setBypassServiceWorker(true); // every engine file comes from the test server (its build can be checked)
  served.length = 0;
  await page.setViewport({ width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent(UA);
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 }); });
  if (setup) await page.evaluateOnNewDocument(setup);
  if (cpu > 1) { const s = await page.createCDPSession(); await s.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load' });
  const t0 = Date.now();
  let out = {};
  try {
    out = await expect(page, file, waitMs);
  } catch (e) { out = { fail: String(e.message || e).slice(0, 200) }; }
  out.sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (errors.length) out.pageErrors = errors.slice(0, 3);
  const pass = !out.fail && !errors.length;
  if (!pass) ok = false;
  results.push({ name, pass, ...out });
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(out));
  await ctx.close();
}

const errorText = (page) => page.$eval('#scanError', (el) => (el.classList.contains('hidden') ? '' : el.innerText));
async function extractOk(page, file, waitMs) {
  await (await page.$('#inFile')).uploadFile(file);
  await page.waitForFunction(() => !document.getElementById('btnExtract').disabled || !document.getElementById('scanError').classList.contains('hidden'), { timeout: 60000 });
  const loadErr = await errorText(page);
  if (loadErr) return { fail: 'load error: ' + loadErr };
  const used = await page.evaluate(() => { const o = window.__PE.state.original; return o ? `${o.width}x${o.height}` : ''; });
  if (Math.max(...used.split('x').map(Number)) > 3000) return { fail: 'photo kept too large: ' + used };
  await page.click('#btnExtract');
  await page.waitForFunction(() => !document.getElementById('step5').classList.contains('hidden') || !document.getElementById('scanError').classList.contains('hidden'), { timeout: waitMs });
  const err = await errorText(page);
  if (err) return { fail: 'scan error: ' + err, used };
  const lic = await page.$eval('#f_license_no', (e) => e.value).catch(() => '');
  const name = await page.$eval('#f_full_name', (e) => e.value).catch(() => '');
  const diag = await page.evaluate(async () => (await import('./js/core/ocr-browser.js')).engineInfo);
  // which engine build the worker really loaded
  const core = served.filter((u) => /tesseract-core/.test(u)).map((u) => (/simd/.test(u) ? 'simd' : 'plain')).pop();
  if (process.env.DEBUG) console.log(served.filter((u) => /tesseract-core|worker\.min/.test(u)));
  const fields = await page.evaluate(() => window.__PE.state.result.fields.filter((f) => f.value).length);
  return { used, lic, name, fields, engine: diag.core, loaded: core, simd: diag.simd, ...(lic === LIC ? {} : { fail: 'license number not read' }) };
}
async function expectError(re) {
  return async (page, file, waitMs) => {
    await (await page.$('#inFile')).uploadFile(file);
    await page.waitForFunction(() => !document.getElementById('btnExtract').disabled, { timeout: 60000 });
    await page.click('#btnExtract');
    await page.waitForFunction(() => !document.getElementById('scanError').classList.contains('hidden'), { timeout: waitMs });
    const t = await errorText(page);
    const retry = await page.$eval('#btnRetry', (b) => !b.hidden);
    return re.test(t) && retry ? { shown: t.split('\n')[0] } : { fail: 'unexpected error text: ' + t };
  };
}

const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples', 'expected.json'), 'utf8'));
const LIC = expected['license_clean.png'].fields.license_no;
const f4k = await bigPhoto('photo-4000x3000.jpg', 4000, 3000);
const f8k = await bigPhoto('photo-8000x6000.jpg', 8000, 6000);
const fRot = await bigPhoto('photo-4000x3000-exif6.jpg', 4000, 3000, { orient: 6 });
const small = path.join(ROOT, 'samples', 'license_clean.png');

await run('4000x3000 photo (12 MP)', { file: f4k, expect: extractOk });
await run('8000x6000 photo (48 MP)', { file: f8k, expect: extractOk });
await run('4000x3000 photo stored sideways (EXIF orientation 6)', { file: fRot, expect: async (page, file, w) => { const r = await extractOk(page, file, w); if (!r.fail && !/x/.test(r.used)) r.fail = 'no size'; const [a, b] = (r.used || '0x0').split('x').map(Number); if (!r.fail && a < b) r.fail = 'orientation not applied (' + r.used + ')'; return r; } });
mode = 'nosimd';
served.length = 0;
await run('engine without WebAssembly SIMD (plain build)', { file: small, expect: async (p, f, w) => { const r = await extractOk(p, f, w); if (!r.fail && r.loaded !== 'plain') r.fail = 'plain build not used: ' + r.loaded; return r; } });
mode = 'brokensimd'; served.length = 0;
await run('SIMD engine file fails to load → automatic plain fallback', { file: small, expect: async (p, f, w) => { const r = await extractOk(p, f, w); if (!r.fail && !/fallback/.test(r.engine || '')) r.fail = 'fallback not used: ' + r.engine; return r; } });
mode = 'noworker';
await run('engine file missing → "Scan failed" + retry', { file: small, expect: await expectError(/Scan failed/), waitMs: 200000 });
mode = 'normal';
await run('browser without WebAssembly → "Scan failed" + retry', { file: small, setup: () => { delete window.WebAssembly; }, expect: await expectError(/Scan failed: .*WebAssembly/) });
await run('page reloaded while the camera was open → explained', { file: small, setup: () => { if (!sessionStorage.getItem('done')) { sessionStorage.setItem('grxCamera', String(Date.now())); sessionStorage.setItem('done', '1'); } },
  expect: async (page) => { await page.waitForFunction(() => !document.getElementById('scanError').classList.contains('hidden'), { timeout: 5000 }); const t = await errorText(page); return /camera was open/.test(t) ? { shown: t.split('\n')[0].slice(0, 80) } : { fail: t }; } });
await run('out of memory inside the engine → "Scan failed" + retry reads a smaller copy', { file: f4k,
  setup: () => {
    // the engine's first reading fails like a phone that ran out of memory
    let T; window.__oom = 1;
    Object.defineProperty(window, 'Tesseract', { configurable: true, get: () => T, set: (v) => {
      const cw = v.createWorker;
      v.createWorker = async (...a) => { const w = await cw(...a); const rec = w.recognize.bind(w); w.recognize = (...b) => (window.__oom-- > 0 ? Promise.reject('RuntimeError: Aborted(OOM)') : rec(...b)); return w; };
      T = v; } });
  },
  expect: async (page, file, waitMs) => {
    const first = await expectError(/Scan failed: the phone ran out of memory/);
    const r1 = await first(page, file, waitMs);
    if (r1.fail) return r1;
    await page.click('#btnRetry');
    await page.waitForFunction(() => !document.getElementById('step5').classList.contains('hidden') || !document.getElementById('scanError').classList.contains('hidden'), { timeout: waitMs });
    const err = await errorText(page); if (err) return { fail: 'retry failed: ' + err };
    const lic = await page.$eval('#f_license_no', (e) => e.value);
    return { shown: r1.shown, retry: lic, ...(lic === LIC ? {} : { fail: 'retry did not read the license number' }) };
  } });
await run('weak phone (CPU ×4 slower), 12 MP license photo', { file: f4k, cpu: 4, expect: extractOk, waitMs: 400000 });
await run('weak phone (CPU ×4 slower), CR photo', { file: path.join(ROOT, 'samples', 'cr_photo_skew.jpg'), cpu: 4, waitMs: 600000, expect: async (page, file, waitMs) => {
  await (await page.$('#inFile')).uploadFile(file);
  await page.waitForFunction(() => !document.getElementById('btnExtract').disabled, { timeout: 60000 });
  const t = Date.now(); await page.click('#btnExtract');
  await page.waitForFunction(() => !document.getElementById('step5').classList.contains('hidden') || !document.getElementById('scanError').classList.contains('hidden'), { timeout: waitMs });
  const err = await errorText(page); if (err) return { fail: err };
  const plate = await page.$eval('#f_plate_no', (e) => e.value).catch(() => '');
  return { plate, scanSec: ((Date.now() - t) / 1000).toFixed(1), ...(plate === expected['cr_photo_skew.jpg'].fields.plate_no ? {} : { fail: 'plate not read' }) };
} });

await browser.close(); server.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(ok ? 'HUAWEI/LOW-END TEST PASS' : 'HUAWEI/LOW-END TEST FAIL');
process.exitCode = ok ? 0 : 1;
