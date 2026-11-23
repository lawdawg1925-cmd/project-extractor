// Browser OCR adapter: Tesseract.js running fully on this device (WebAssembly).
// All engine files are loaded from ./vendor — nothing is downloaded from the internet
// and no image ever leaves the device.
let worker = null;
let progressCb = () => {};
let curMode = '3|';

export async function getRecognizer(onProgress) {
  progressCb = onProgress || (() => {});
  if (!worker) {
    if (!window.Tesseract) throw new Error('OCR engine not loaded (vendor/tesseract/tesseract.min.js missing).');
    const base = new URL('./vendor/', document.baseURI).href;
    worker = await window.Tesseract.createWorker('eng', 1, {
      workerPath: base + 'tesseract/worker.min.js',
      corePath: base + 'core/',
      langPath: base + 'lang',
      gzip: true,
      cacheMethod: 'none',      // do not store anything in the browser's IndexedDB
      workerBlobURL: false,
      logger: (m) => { if (m.status === 'recognizing text') progressCb(m.progress); },
    });
    await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', user_defined_dpi: '300' });
  }
  // opts: { psm:'7', whitelist:'0123456789-' } for targeted single-line re-reads
  return async (imageData, opts = {}) => {
    const key = `${opts.psm || '3'}|${opts.whitelist || ''}`;
    if (key !== curMode) { await worker.setParameters({ tessedit_pageseg_mode: opts.psm || '3', tessedit_char_whitelist: opts.whitelist || '' }); curMode = key; }
    const c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    c.getContext('2d').putImageData(new ImageData(imageData.data, imageData.width, imageData.height), 0, 0);
    const { data } = await worker.recognize(c, {}, { text: true, blocks: true });
    c.width = c.height = 0; // free memory
    return data;
  };
}

/** Stop the OCR engine and drop everything it holds in memory. */
export async function shutdown() {
  curMode = '3|';
  if (worker) { const w = worker; worker = null; try { await w.terminate(); } catch (e) { /* ignore */ } }
}
