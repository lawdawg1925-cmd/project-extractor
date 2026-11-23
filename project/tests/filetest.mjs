// Checks whether the app works when index.html is opened directly (file://) without the launcher.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + path.join(ROOT, 'app/index.html'));
await new Promise((r) => setTimeout(r, 1500));
const appLoaded = await page.evaluate(() => !!window.__PE);
let extracted = false;
if (appLoaded) {
  await (await page.$('#inFile')).uploadFile(path.join(ROOT, 'samples/license_clean.png'));
  await new Promise((r) => setTimeout(r, 1500));
  await page.click('#btnExtract');
  extracted = await page.waitForSelector('#step5:not(.hidden)', { timeout: 30000 }).then(() => true).catch(() => false);
}
console.log(JSON.stringify({ appLoaded, extracted, errors: errs.slice(0, 4) }, null, 1));
await browser.close();
