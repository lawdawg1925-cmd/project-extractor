// Browser OCR adapter: Tesseract.js running fully on this device (WebAssembly).
// All engine files are loaded from ./vendor — nothing is downloaded from the internet
// and no image ever leaves the device.
// Phones with little memory / older browsers (e.g. Huawei Browser, old Android WebView): the engine
// start and every reading have a time limit, a failed start is retried with the plain (non-SIMD)
// engine, and every failure ends in a clear error instead of a frozen screen.
let worker = null;
let progressCb = () => {};
let curMode = '3|';
export const engineInfo = { simd: null, core: '', starts: 0, lastError: '' };
const INIT_MS = 90000, READ_MS = 150000;

/** WebAssembly SIMD support (same test module as wasm-feature-detect, used by Tesseract.js). */
export function simdSupported() {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; }
}

function timeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

/** Plain-language reason for an engine error (memory problems are the usual cause on small phones). */
export function explainEngineError(e) {
  const m = String((e && e.message) || e || '').replace(/^(undefined|null|\[object \w+\])$/, '');
  if (!m) return 'the engine files could not be loaded (open the app once with internet so it is stored for offline use, then try again)';
  if (/memory|OOM|alloc|Aborted|out of bounds|RangeError/i.test(m)) return 'the phone ran out of memory while reading the photo';
  if (/stopped responding|did not start|could not start|timed? ?out/i.test(m)) return m.replace(/\.$/, '');
  if (/WebAssembly|wasm|CompileError|LinkError/i.test(m)) return 'this browser could not run the text-recognition engine (WebAssembly)';
  if (/fetch|network|load|importScripts|NetworkError/i.test(m)) return 'the text-recognition engine files could not be loaded (open the app once with internet so it can be stored offline)';
  return (m || 'unknown error').replace(/\.$/, '');
}

async function start(corePath) {
  if (!window.Tesseract) throw new Error('OCR engine not loaded (vendor/tesseract/tesseract.min.js missing).');
  const base = new URL('./vendor/', document.baseURI).href;
  engineInfo.starts++;
  const w = await timeout(window.Tesseract.createWorker('eng', 1, {
    workerPath: base + 'tesseract/worker.min.js',
    corePath: base + corePath,
    langPath: base + 'lang',
    gzip: true,
    cacheMethod: 'none',      // do not store anything in the browser's IndexedDB
    workerBlobURL: false,
    logger: (m) => { if (m.status === 'recognizing text') progressCb(m.progress); },
    errorHandler: (err) => { engineInfo.lastError = String(err); },
  }), INIT_MS, 'The text-recognition engine did not start in time.');
  await w.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', user_defined_dpi: '300' });
  return w;
}

export async function getRecognizer(onProgress) {
  progressCb = onProgress || (() => {});
  if (!worker) {
    if (typeof WebAssembly !== 'object') throw new Error('This browser cannot run the text-recognition engine (WebAssembly is missing or switched off). Update the browser, or open the app in Google Chrome.');
    if (typeof Worker === 'undefined') throw new Error('This browser cannot run background tasks (Web Workers). Update the browser, or open the app in Google Chrome.');
    engineInfo.simd = simdSupported();
    curMode = '3|';
    try {
      // the engine picks its SIMD or plain build itself
      worker = await start('core/'); engineInfo.core = engineInfo.simd ? 'simd' : 'plain';
    } catch (e1) {
      // some phones report SIMD but fail to run it, or run out of memory on the first start:
      // try once more with the plain build
      engineInfo.lastError = String((e1 && e1.message) || e1);
      try { worker = await start('core/tesseract-core-lstm.wasm.js'); engineInfo.core = 'plain (fallback)'; }
      catch (e2) { worker = null; throw new Error('The text-recognition engine could not start (' + explainEngineError(e2 && (e2.message || String(e2)) ? e2 : engineInfo.lastError) + ')'); }
    }
  }
  // opts: { psm:'7', whitelist:'0123456789-' } for targeted single-line re-reads
  return async (imageData, opts = {}) => {
    if (!worker) throw new Error('The text-recognition engine was stopped.');
    const key = `${opts.psm || '3'}|${opts.whitelist || ''}`;
    if (key !== curMode) { await worker.setParameters({ tessedit_pageseg_mode: opts.psm || '3', tessedit_char_whitelist: opts.whitelist || '' }); curMode = key; }
    const c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    const g = c.getContext('2d');
    if (!g) throw new Error('The phone ran out of memory (no drawing memory left).');
    g.putImageData(new ImageData(imageData.data, imageData.width, imageData.height), 0, 0);
    try {
      const { data } = await timeout(worker.recognize(c, {}, { text: true, blocks: true }), READ_MS, 'The text-recognition engine stopped responding.');
      return data;
    } catch (e) {
      // a stuck or crashed engine is thrown away; the next try starts a fresh one
      await shutdown();
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      c.width = c.height = 0; // free memory
    }
  };
}

/** Stop the OCR engine and drop everything it holds in memory. */
export async function shutdown() {
  curMode = '3|';
  if (worker) { const w = worker; worker = null; try { await timeout(w.terminate(), 5000, 'terminate'); } catch (e) { /* ignore */ } }
}
