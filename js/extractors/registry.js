// Extractor registry. To add a new document type, create a file that exports an extractor
// object (see license.js) and add one line to the list below.
import license from './license.js';
import cr from './cr.js';

const EXTRACTORS = [license, cr];

export function list() { return EXTRACTORS.slice(); }
export function get(id) { return EXTRACTORS.find((e) => e.id === id) || null; }
export function register(ex) { if (!get(ex.id)) EXTRACTORS.push(ex); }

/** Rank all extractors for the OCR text. Returns [{id,label,score,hits}] best first. */
export function detect(text) {
  return EXTRACTORS.map((e) => ({ id: e.id, label: e.label, ...e.detect(text) })).sort((a, b) => b.score - a.score);
}

/** Minimum detection score to accept a document type automatically. */
export const MIN_DETECT_SCORE = 0.2;
