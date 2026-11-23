// The full extraction pipeline, independent of browser/Node:
// preprocess → OCR (with rotation retry) → detect document type → map fields → validate.
import { preprocess, rotate90 } from './image.js';
import { normalizeOcr, horizontalRatio } from './layout.js';
import { detectDocument, warpQuad, isFullImage } from './quad.js';
import { buildMessages } from './validate.js';
import { refineFields } from './refine.js';
import * as registry from '../extractors/registry.js';

/**
 * @param {object} image  ImageData-like {width,height,data}
 * @param {object} opts   { recognize: async (imageData) => tesseractData, docType: 'auto'|'license'|'cr', onProgress }
 */
export async function extractDocument(image, { recognize, docType = 'auto', onProgress = () => {}, corners } = {}) {
  const t0 = Date.now();
  // Document boundary + perspective correction. corners: undefined = auto-detect, null = use whole image,
  // [TL,TR,BR,BL] = use these (e.g. adjusted by the user on the preview).
  let quad = null;
  if (corners === undefined) {
    onProgress({ stage: 'detect', text: 'Finding the document edges…' });
    const q = detectDocument(image);
    if (q && q.confidence >= 0.6) quad = q.corners;
  } else if (corners) quad = corners;
  if (quad && !isFullImage(quad, image.width, image.height)) {
    image = warpQuad(image, quad);
  } else quad = null;
  const straightened = !!quad;
  const attempts = [];
  const run = async (rot, mode, label) => {
    onProgress({ stage: 'ocr', text: label });
    const img = preprocess(rot ? rotate90(image, rot) : image, { mode });
    const data = await recognize(img);
    const ocr = normalizeOcr(data);
    const det = registry.detect(ocr.text);
    const wantScore = docType === 'auto' ? det[0].score : (det.find((d) => d.id === docType) || { score: 0 }).score;
    // Tesseract can read sideways text but then the word boxes are sideways too, which breaks the
    // label/column mapping — so an upright layout (words wider than tall) is required.
    const upright = horizontalRatio(ocr);
    const quality = (ocr.meanConf * Math.min(1, ocr.words.length / 15) + 60 * wantScore) * (upright >= 0.6 ? 1 : 0.3);
    const a = { rot, mode, ocr, det, quality, img, upright };
    attempts.push(a);
    return a;
  };
  const good = (a) => a.upright >= 0.6 && a.ocr.meanConf >= 75 && (docType === 'auto' ? a.det[0].score : a.det.find((d) => d.id === docType).score) >= 0.35;

  let best = await run(0, 'standard', 'Reading text…');
  if (!good(best)) {
    for (const rot of [1, 3, 2]) {
      const a = await run(rot, 'standard', `Trying rotation ${rot * 90}°…`);
      if (a.quality > best.quality) best = a;
      if (good(best)) break;
    }
  }
  if (best.ocr.meanConf < 70) {
    const a = await run(best.rot, 'enhanced', 'Enhancing a difficult photo…');
    if (a.quality > best.quality) best = a;
  }

  onProgress({ stage: 'map', text: 'Organizing fields…' });
  const det = best.det;
  let id = docType;
  if (docType === 'auto') id = det[0].score >= registry.MIN_DETECT_SCORE ? det[0].id : 'unknown';
  const base = { detection: det, rawText: best.ocr.text, meanConf: Math.round(best.ocr.meanConf), rotation: best.rot * 90, mode: best.mode,
    attempts: attempts.length, ms: Date.now() - t0, processedImage: best.img, straightened };
  if (id === 'unknown') {
    return { ...base, docType: 'unknown', docLabel: 'Unknown / unsupported document', fields: [],
      messages: [{ level: 'error', text: 'Document type not recognized. Choose "Driver\'s License" or "CR" in Step 2 and extract again, or retake the photo so the whole document is visible.' }] };
  }
  const ex = registry.get(id);
  const { fields } = ex.extract(best.ocr);
  onProgress({ stage: 'refine', text: 'Double-checking uncertain numbers…' });
  const refined = await refineFields(fields, ex.fields, best.img, recognize);
  if (ex.postRefine) ex.postRefine(Object.fromEntries(fields.map((f) => [f.key, f])));
  const result = { ...base, docType: id, docLabel: ex.label, sectionTitles: ex.sectionTitles, fields, refined, ms: Date.now() - t0 };
  if (docType !== 'auto' && det[0].id !== id && det[0].score > 0.35) {
    result.mismatch = `This looks more like a ${det[0].label}. Check the document type in Step 2.`;
  }
  result.messages = buildMessages(result, ex);
  if (result.mismatch) result.messages.unshift({ level: 'warn', text: result.mismatch });
  return result;
}
