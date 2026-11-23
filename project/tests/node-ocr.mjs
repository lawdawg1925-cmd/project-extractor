// Node adapter: same pipeline as the browser, OCR via tesseract.js in Node using the
// vendored language file (app/vendor/lang) so tests also run offline.
import { createWorker } from 'tesseract.js';
import { Jimp } from 'jimp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function makeRecognizer() {
  const worker = await createWorker('eng', 1, { langPath: path.join(ROOT, 'app/vendor/lang'), cacheMethod: 'none', gzip: true });
  await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', user_defined_dpi: '300' });
  let cur = '3|';
  // opts: { psm:'7', whitelist:'0123456789-' } for targeted single-line re-reads
  const recognize = async (img, opts = {}) => {
    const key = `${opts.psm || '3'}|${opts.whitelist || ''}`;
    if (key !== cur) { await worker.setParameters({ tessedit_pageseg_mode: opts.psm || '3', tessedit_char_whitelist: opts.whitelist || '' }); cur = key; }
    const j = new Jimp({ width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) });
    const png = await j.getBuffer('image/png');
    const { data } = await worker.recognize(png, {}, { text: true, blocks: true });
    return data;
  };
  return { recognize, terminate: () => worker.terminate() };
}

export async function loadImage(file) {
  const j = await Jimp.read(file);
  return { width: j.bitmap.width, height: j.bitmap.height, data: new Uint8ClampedArray(j.bitmap.data) };
}
