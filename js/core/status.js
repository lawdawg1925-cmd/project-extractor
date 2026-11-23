// Field status values used everywhere (UI chips, output markers, tests).
export const STATUS = Object.freeze({
  OK: 'OK',
  VERIFY: 'VERIFY',
  UNREADABLE: 'NOT READABLE',
  NOT_FOUND: 'NOT FOUND',
  EDITED: 'EDITED',
});

/** Confidence (0-100, Tesseract word confidence) below which a value must be verified. */
export const VERIFY_BELOW = 80;
/** Confidence below which a value that also fails its format is treated as unreadable. */
export const UNREADABLE_BELOW = 45;

/** Marker appended in copy/export output. OK/EDITED have no marker. */
export function marker(status) {
  if (status === STATUS.VERIFY) return '[VERIFY]';
  if (status === STATUS.UNREADABLE) return '[NOT READABLE]';
  if (status === STATUS.NOT_FOUND) return '[NOT FOUND]';
  return '';
}
