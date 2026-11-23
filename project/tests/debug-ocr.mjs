// Debug helper: print OCR lines with boxes for one sample.  node tests/debug-ocr.mjs samples/cr_clean.png [rot]
import { makeRecognizer, loadImage } from './node-ocr.mjs';
import { preprocess, rotate90 } from '../app/js/core/image.js';
import { normalizeOcr } from '../app/js/core/layout.js';
const { recognize, terminate } = await makeRecognizer();
let img = await loadImage(process.argv[2]);
if (process.argv[3]) img = rotate90(img, +process.argv[3]);
const o = normalizeOcr(await recognize(preprocess(img)));
for (const l of o.lines) console.log(l.words.map((w) => `${w.text}@${w.bbox.x0},${w.bbox.y0}-${w.bbox.x1},${w.bbox.y1}(${Math.round(w.conf)})`).join('  '));
console.log('meanConf', o.meanConf);
await terminate();
