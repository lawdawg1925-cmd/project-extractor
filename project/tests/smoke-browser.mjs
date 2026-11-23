// Headless browser smoke test of the real web app (desktop + Pixel-size mobile viewport),
// served by a local static server, with network requests to other hosts BLOCKED (proves offline / no upload).
// Usage: node tests/smoke-browser.mjs   (needs Google Chrome/Chromium; set CHROME_PATH if not at /usr/bin/google-chrome)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gz': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(APP, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(APP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const external = [];
let ok = true;

async function runCase({ name, viewport, sample, shot, mobile, cornersShot }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  if (mobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', (r) => { const u = new URL(r.url()); if (['http:', 'https:'].includes(u.protocol) && u.host !== `localhost:${port}`) { external.push(r.url()); r.abort(); } else r.continue(); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load' });
  // camera input attributes (Android Chrome / iPhone Safari open the rear camera with these)
  const cam = await page.$eval('#inCamera', (el) => ({ accept: el.accept, capture: el.getAttribute('capture') }));
  const input = await page.$('#inFile');
  await input.uploadFile(path.join(ROOT, 'samples', sample));
  await page.waitForFunction(() => !document.getElementById('btnExtract').disabled, { timeout: 20000 });
  let quadInfo = '';
  if (cornersShot) {
    // corner handles: auto outline shown; drag one handle a bit and back (exercises manual adjustment)
    await page.evaluate(() => { document.querySelector('.top').style.position = 'static'; document.getElementById('previewWrap').scrollIntoView(); });
    await new Promise((r) => setTimeout(r, 400));
    const handles = await page.$$('.quad-handle');
    const status = await page.$eval('#quadStatus', (e) => e.textContent);
    if (handles.length === 4) {
      const b = await handles[0].boundingBox();
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 15, cy + 10, { steps: 4 }); await page.mouse.move(cx, cy, { steps: 4 }); await page.mouse.up();
    }
    const status2 = await page.$eval('#quadStatus', (e) => e.textContent);
    quadInfo = ` | handles ${handles.length} | ${status} → after drag ${status2}`;
    if (handles.length !== 4) ok = false;
    await page.evaluate(() => { document.querySelector('.top').style.position = 'static'; document.getElementById('previewWrap').scrollIntoView(); });
    await (await page.$('#step1')).screenshot({ path: path.join(ROOT, cornersShot) });
  }
  const t0 = Date.now();
  await page.click('#btnExtract');
  await page.waitForSelector('#step5:not(.hidden)', { timeout: 180000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const fields = await page.$$eval('.field', (rows) => rows.map((r) => ({ label: r.querySelector('label').textContent, value: r.querySelector('input,textarea').value, status: r.querySelector('.chip').textContent })));
  const docType = await page.$eval('#docType', (e) => e.textContent);
  // edit one field → becomes EDITED and output updates
  const first = await page.$('.field input');
  await first.click({ clickCount: 3 });
  await first.type('EDITED-TEST');
  const outHas = await page.$eval('#outText', (t) => t.value.includes('EDITED-TEST'));
  await page.evaluate(() => { document.querySelector('.field input').value = ''; });
  await page.reload({ waitUntil: 'load' });
  // re-run without the edit so the screenshot shows a real result
  await (await page.$('#inFile')).uploadFile(path.join(ROOT, 'samples', sample));
  await page.waitForFunction(() => !document.getElementById('btnExtract').disabled);
  await new Promise((r) => setTimeout(r, 200));
  await page.click('#btnExtract');
  await page.waitForSelector('#step5:not(.hidden)', { timeout: 180000 });
  await page.evaluate(() => { document.querySelector('.top').style.position = 'static'; const d = document.getElementById('straightWrap'); if (!d.hidden) d.open = true; document.getElementById('step4').scrollIntoView(); });
  await new Promise((r) => setTimeout(r, 300));
  const el = await page.$('#step4');
  await el.screenshot({ path: path.join(ROOT, shot) });
  const outText = await page.$eval('#outText', (t) => t.value);
  // Clear / Delete wipes everything
  await page.click('#btnClear');
  await new Promise((r) => setTimeout(r, 800));
  const cleared = await page.evaluate(() => !window.__PE.state.original && !window.__PE.state.result && document.querySelectorAll('.field').length === 0 && document.getElementById('outText').value === '');
  console.log(`\n[${name}] ${sample}: ${docType} | ${fields.length} fields | ${secs}s | camera input accept=${cam.accept} capture=${cam.capture} | edit→output ${outHas} | clear wiped ${cleared} | errors ${errors.length}${quadInfo}`);
  console.log(outText.split('\n').slice(0, 16).map((l) => '   ' + l).join('\n'));
  if (!fields.length || !outHas || !cleared || errors.length) { ok = false; console.log('  errors:', errors); }
  await page.close();
}

await runCase({ name: 'desktop 1366x900', viewport: { width: 1366, height: 900 }, sample: 'license_clean.png', shot: 'screenshots-review.png' });
await runCase({ name: 'Android Pixel 7 (412x915)', viewport: { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, sample: 'cr_photo_skew.jpg', shot: 'screenshots-review-mobile-cr.png', mobile: true });
await runCase({ name: 'Android Pixel 7 (412x915) perspective', viewport: { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, sample: 'license_perspective_glare_clutter.jpg', shot: 'screenshots-review-mobile.png', cornersShot: 'screenshots-corners-mobile.png', mobile: true });
await browser.close();
server.close();
console.log(`\nExternal (non-local) requests attempted: ${external.length}${external.length ? ' → ' + external.join(', ') : ''}`);
console.log(ok && !external.length ? 'SMOKE TEST PASS' : 'SMOKE TEST FAIL');
process.exitCode = ok && !external.length ? 0 : 1;
