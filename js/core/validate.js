// Builds the plain-language messages shown above the review form.
import { STATUS } from './status.js';

export function buildMessages(result, extractor) {
  const msgs = [];
  const fields = result.fields || [];
  if (result.meanConf !== undefined && result.meanConf < 60) {
    msgs.push({ level: 'error', text: 'The photo is blurry, dark or low-contrast. Retake it in good light, hold the phone steady and fill the frame with the document.' });
  }
  const crit = extractor.critical || {};
  for (const f of fields) {
    if (crit[f.key] && (f.status === STATUS.NOT_FOUND || f.status === STATUS.UNREADABLE)) msgs.push({ level: 'error', text: crit[f.key] });
  }
  const missing = fields.filter((f) => f.status === STATUS.NOT_FOUND && !f.optional && !f.hidden && !/^Blank/.test(f.note || '') && f.raw === '' && !(f.note || '').startsWith('Not printed') && !(f.note || '').startsWith('No middle') && !(f.note || '').startsWith('Name not found'));
  // fields that have labels and were not found → probably cut off / covered
  const labelled = missing.filter((f) => (extractor.fields.find((d) => d.key === f.key) || {}).labels);
  if (labelled.length >= 2) msgs.push({ level: 'error', text: `${extractor.cutoffMessage} (Not found: ${labelled.map((f) => f.label).join(', ')}.)` });
  if (extractor.messages) msgs.push(...extractor.messages(Object.fromEntries(fields.map((f) => [f.key, f]))));
  const verify = fields.filter((f) => f.status === STATUS.VERIFY || f.status === STATUS.UNREADABLE).length;
  if (verify) msgs.push({ level: 'warn', text: `${verify} field${verify > 1 ? 's need' : ' needs'} verification — check the highlighted fields against the document.` });
  if (!msgs.some((m) => m.level !== 'info')) msgs.push({ level: 'ok', text: 'All fields read clearly. Still give them a quick check before encoding.' });
  return msgs;
}
