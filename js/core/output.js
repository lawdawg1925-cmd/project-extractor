// Output formatters: section text (for copy/paste into forms/reports), CSV, JSON.
import { marker, STATUS } from './status.js';

export function fieldText(f) {
  if (f.status === STATUS.NOT_FOUND || f.status === STATUS.UNREADABLE) return f.value ? `${f.value} ${marker(f.status)}` : marker(f.status);
  const m = marker(f.status);
  return m ? `${f.value} ${m}` : f.value;
}

const shown = (result) => result.fields.filter((f) => !f.hidden); // fields not printed on the detected form layout are left out

/** label lines of one section, with a sub-heading before each group ("Details of First Registration") */
function sectionLines(fs) {
  const out = []; let group = null;
  for (const f of fs) {
    if ((f.group || null) !== group) { group = f.group || null; if (group) out.push(`\n${group}`); }
    out.push(`${f.label}: ${fieldText(f)}`);
  }
  return out.join('\n');
}

/** Section-formatted text, e.g. "LICENSE INFORMATION\n\nLicense No.: D12-34-567890 …" */
export function toText(result, { includeExtra = true } = {}) {
  const t = result.sectionTitles || { main: 'INFORMATION', extra: 'ADDITIONAL DETAILS' };
  const main = shown(result).filter((f) => f.section === 'main' && !(f.optional && !f.alwaysShow && f.status === STATUS.NOT_FOUND));
  const extra = shown(result).filter((f) => f.section === 'extra' && f.status !== STATUS.NOT_FOUND);
  let s = `${t.main}\n\n` + sectionLines(main);
  if (includeExtra && extra.length) s += `\n\n${t.extra}\n\n` + sectionLines(extra);
  return s + '\n';
}

const csvCell = (v) => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const csvLabel = (f) => (f.group ? `${f.label} (${f.group})` : f.label);

/** One header row + one value row (all fields of the detected layout, markers kept). */
export function toCSV(result) {
  const fs = shown(result);
  return '\uFEFF' + [fs.map((f) => csvCell(csvLabel(f))).join(','), fs.map((f) => csvCell(fieldText(f))).join(',')].join('\r\n') + '\r\n';
}

export function toJSON(result) {
  const layout = (result.fields.find((f) => f.layout) || {}).layout;
  return JSON.stringify({
    document_type: result.docType,
    ...(layout ? { form_layout: layout === 'new' ? 'LTO Form No. 3 (Revised December 2020)' : 'LTO Form No. 3' } : {}),
    extracted_at: new Date().toISOString(),
    tool: 'GRX Scan (prototype) — TLEU, NCPO',
    fields: Object.fromEntries(shown(result).map((f) => [f.key, { label: f.label, ...(f.group ? { group: f.group } : {}), section: f.section, value: f.value, status: f.status, confidence: f.confidence, note: f.note || undefined }])),
  }, null, 2);
}
