// Output formatters: section text (for copy/paste into forms/reports), CSV, JSON.
import { marker, STATUS } from './status.js';

export function fieldText(f) {
  if (f.status === STATUS.NOT_FOUND || f.status === STATUS.UNREADABLE) return f.value ? `${f.value} ${marker(f.status)}` : marker(f.status);
  const m = marker(f.status);
  return m ? `${f.value} ${m}` : f.value;
}

/** Section-formatted text, e.g. "LICENSE INFORMATION\n\nLicense No.: D12-34-567890 …" */
export function toText(result, { includeExtra = true } = {}) {
  const t = result.sectionTitles || { main: 'INFORMATION', extra: 'ADDITIONAL DETAILS' };
  const main = result.fields.filter((f) => f.section === 'main' && !(f.optional && !f.alwaysShow && f.status === STATUS.NOT_FOUND));
  const extra = result.fields.filter((f) => f.section === 'extra' && f.status !== STATUS.NOT_FOUND);
  let s = `${t.main}\n\n` + main.map((f) => `${f.label}: ${fieldText(f)}`).join('\n');
  if (includeExtra && extra.length) s += `\n\n${t.extra}\n\n` + extra.map((f) => `${f.label}: ${fieldText(f)}`).join('\n');
  return s + '\n';
}

const csvCell = (v) => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

/** One header row + one value row (all fields, markers kept). */
export function toCSV(result) {
  const fs = result.fields;
  return '\uFEFF' + [fs.map((f) => csvCell(f.label)).join(','), fs.map((f) => csvCell(fieldText(f))).join(',')].join('\r\n') + '\r\n';
}

export function toJSON(result) {
  return JSON.stringify({
    document_type: result.docType,
    extracted_at: new Date().toISOString(),
    tool: 'GRX Scan (prototype) — TLEU, NCPO',
    fields: Object.fromEntries(result.fields.map((f) => [f.key, { label: f.label, value: f.value, status: f.status, confidence: f.confidence, note: f.note || undefined }])),
  }, null, 2);
}
