// GRX Scan — UI controller. All processing happens in this browser tab.
import { extractDocument } from './core/pipeline.js';
import { rotate90, crop as cropImg } from './core/image.js';
import { detectDocument, isFullImage } from './core/quad.js';
import { toText, toCSV, toJSON, fieldText } from './core/output.js';
import { STATUS } from './core/status.js';
import { getRecognizer, shutdown } from './core/ocr-browser.js';

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 3000; // limit very large phone photos (memory on phones)

const state = { original: null, working: null, rotation: 0, cropRect: null, result: null, busy: false, corners: null, quadAuto: false };

// ---------- STEP 1: load image ----------
async function loadFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|bmp|gif)$/i.test(file.name)) { toast('Please choose an image file (JPG or PNG).'); return; }
  clearResults();
  let bmp;
  try {
    // createImageBitmap applies the phone's EXIF orientation automatically
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    bmp = await new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
      im.src = url;
    }).catch(() => null);
  }
  if (!bmp) { toast('This image could not be opened. On iPhone, set Camera → Formats → "Most Compatible", or send a JPG.'); return; }
  const w0 = bmp.width, h0 = bmp.height;
  const f = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * f); c.height = Math.round(h0 * f);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  state.original = g.getImageData(0, 0, c.width, c.height);
  c.width = c.height = 0;
  state.rotation = 0; state.cropRect = null;
  rebuildWorking();
  $('previewWrap').classList.remove('hidden');
  $('btnExtract').disabled = false;
  $('btnCropReset').classList.add('hidden');
  $('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function rebuildWorking() {
  let img = state.original;
  if (!img) return;
  if (state.cropRect) img = cropImg(img, state.cropRect);
  if (state.rotation) img = rotate90(img, state.rotation);
  state.working = img;
  drawPreview();
  detectCorners();
}

// ---------- document corners (automatic, optionally adjusted by dragging) ----------
function detectCorners() {
  const img = state.working;
  state.corners = null; state.quadAuto = false;
  if (img) {
    let q = null;
    try { q = detectDocument(img); } catch (e) { console.warn(e); }
    if (q && q.confidence >= 0.6) { state.corners = q.corners.map((p) => ({ x: p.x, y: p.y })); state.quadAuto = true; }
    else state.corners = [{ x: 0, y: 0 }, { x: img.width - 1, y: 0 }, { x: img.width - 1, y: img.height - 1 }, { x: 0, y: img.height - 1 }];
  }
  drawQuad();
}
function quadStatusText() {
  if (!state.corners) return '';
  if (!$('chkStraighten').checked) return '(off: whole image is read)';
  if (isFullImage(state.corners, state.working.width, state.working.height)) return '(edges not found: whole image is read; drag the corners to set them)';
  return state.quadAuto ? '(edges found automatically)' : '(corners set by you)';
}
function drawQuad() {
  const svg = $('quadSvg'), box = cv.parentElement;
  box.querySelectorAll('.quad-handle').forEach((h) => h.remove());
  const show = !!state.corners && $('chkStraighten').checked && !cropMode;
  svg.classList.toggle('hidden', !show);
  $('quadHint').hidden = !show;
  $('quadStatus').textContent = quadStatusText();
  if (!show) return;
  const W = cv.width, H = cv.height;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  $('quadPoly').setAttribute('points', state.corners.map((p) => `${p.x},${p.y}`).join(' '));
  $('quadPoly').style.strokeWidth = Math.max(2, W / 250);
  state.corners.forEach((p, i) => {
    const h = document.createElement('div');
    h.className = 'quad-handle'; h.dataset.i = i; h.title = 'Drag onto the document corner';
    h.style.left = (p.x / W * 100) + '%'; h.style.top = (p.y / H * 100) + '%';
    h.addEventListener('pointerdown', (ev) => { h.setPointerCapture(ev.pointerId); ev.preventDefault(); h._drag = true; });
    h.addEventListener('pointermove', (ev) => {
      if (!h._drag) return;
      const q = toImg(ev);
      state.corners[i] = { x: Math.max(0, Math.min(W - 1, q.x)), y: Math.max(0, Math.min(H - 1, q.y)) };
      state.quadAuto = false;
      h.style.left = (state.corners[i].x / W * 100) + '%'; h.style.top = (state.corners[i].y / H * 100) + '%';
      $('quadPoly').setAttribute('points', state.corners.map((c) => `${c.x},${c.y}`).join(' '));
      $('quadStatus').textContent = quadStatusText();
    });
    const end = () => { h._drag = false; };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    box.appendChild(h);
  });
}
$('chkStraighten').onchange = () => drawQuad();

function drawPreview() {
  const cv = $('preview');
  const img = state.working;
  if (!img) { cv.width = cv.height = 0; return; }
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
}

// rotate
$('btnRotL').onclick = () => rotateBy(-1);
$('btnRotR').onclick = () => rotateBy(1);
function rotateBy(d) {
  if (!state.original) return;
  // keep crop in original coordinates; rotation applied after crop
  state.rotation = (state.rotation + d + 4) % 4;
  rebuildWorking();
}

// manual crop (drag a rectangle on the preview)
let cropMode = false, dragStart = null, dragRect = null;
$('btnCrop').onclick = () => {
  if (!state.original) return;
  cropMode = !cropMode;
  if (cropMode && (state.rotation || state.cropRect)) {
    // crop is defined on the un-rotated, un-cropped image for simplicity
    state.rotation = 0; state.cropRect = null; rebuildWorking();
  }
  $('cropHint').hidden = !cropMode;
  $('btnCrop').textContent = cropMode ? '✖ Cancel crop' : '✂ Crop';
  $('btnCropApply').classList.toggle('hidden', !cropMode);
  if (!cropMode) { $('cropBox').classList.add('hidden'); dragRect = null; }
  drawQuad();
};
const cv = $('preview');
const toImg = (ev) => {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * (cv.width / r.width), y: (ev.clientY - r.top) * (cv.height / r.height), cx: ev.clientX - r.left, cy: ev.clientY - r.top };
};
cv.addEventListener('pointerdown', (ev) => { if (!cropMode) return; cv.setPointerCapture(ev.pointerId); dragStart = toImg(ev); ev.preventDefault(); });
cv.addEventListener('pointermove', (ev) => {
  if (!cropMode || !dragStart) return;
  const p = toImg(ev);
  const box = $('cropBox');
  box.classList.remove('hidden');
  Object.assign(box.style, { left: Math.min(p.cx, dragStart.cx) + 'px', top: Math.min(p.cy, dragStart.cy) + 'px', width: Math.abs(p.cx - dragStart.cx) + 'px', height: Math.abs(p.cy - dragStart.cy) + 'px' });
  dragRect = { x: Math.min(p.x, dragStart.x), y: Math.min(p.y, dragStart.y), w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y) };
});
cv.addEventListener('pointerup', () => { dragStart = null; });
$('btnCropApply').onclick = () => {
  if (!dragRect || dragRect.w < 40 || dragRect.h < 40) { toast('Drag a bigger box around the document first.'); return; }
  state.cropRect = dragRect; dragRect = null;
  $('cropBox').classList.add('hidden');
  cropMode = false; $('cropHint').hidden = true; $('btnCrop').textContent = '✂ Crop'; $('btnCropApply').classList.add('hidden');
  $('btnCropReset').classList.remove('hidden');
  rebuildWorking();
};
$('btnCropReset').onclick = () => { state.cropRect = null; $('btnCropReset').classList.add('hidden'); rebuildWorking(); };

$('inCamera').onchange = (e) => { loadFile(e.target.files[0]); e.target.value = ''; };
$('inFile').onchange = (e) => { loadFile(e.target.files[0]); e.target.value = ''; };
// drag & drop (laptop)
['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) document.body.classList.remove('dragging'); }));
document.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
// paste a screenshot (Ctrl+V)
document.addEventListener('paste', (e) => { const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/')); if (it) loadFile(it.getAsFile()); });

// ---------- STEP 3: extract ----------
$('btnExtract').onclick = async () => {
  if (!state.working || state.busy) return;
  state.busy = true;
  $('btnExtract').disabled = true;
  const prog = $('progress');
  prog.classList.remove('hidden');
  setProgress(0.02, 'Loading the text-recognition engine (first time takes a few seconds)…');
  const docType = document.querySelector('input[name=doctype]:checked').value;
  try {
    let stageText = 'Reading text…';
    const recognize = await getRecognizer((p) => setProgress(p, stageText));
    // corners: the outline shown on the preview (auto-detected or dragged); null = read the whole image
    const corners = $('chkStraighten').checked && state.corners ? state.corners.map((p) => ({ ...p })) : null;
    const result = await extractDocument(state.working, {
      recognize, docType, corners,
      onProgress: ({ text }) => { stageText = text; setProgress(0.05, text); },
    });
    showStraightened(result.straightened ? result.processedImage : null);
    delete result.processedImage; // do not keep extra copies of the image
    state.result = result;
    renderResult();
    $('step4').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    toast('Extraction failed: ' + (err && err.message ? err.message : err) + '. If you opened the file directly, use the start launcher (see README).', 8000);
  } finally {
    state.busy = false;
    $('btnExtract').disabled = !state.working;
    prog.classList.add('hidden');
  }
};
function showStraightened(img) {
  const c = $('straightPreview');
  if (!img) { c.width = c.height = 0; $('straightWrap').hidden = true; return; }
  const f = Math.min(1, 1000 / Math.max(img.width, img.height));
  const t = document.createElement('canvas'); t.width = img.width; t.height = img.height;
  t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
  c.getContext('2d').drawImage(t, 0, 0, c.width, c.height);
  t.width = t.height = 0;
  $('straightWrap').hidden = false;
}
function setProgress(p, text) { $('progBar').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; if (text) $('progText').textContent = text; }

// ---------- STEP 4: review ----------
const chipClass = (s) => ({ [STATUS.OK]: 'ok', [STATUS.VERIFY]: 'verify', [STATUS.UNREADABLE]: 'unreadable', [STATUS.NOT_FOUND]: 'notfound', [STATUS.EDITED]: 'edited' }[s]);

function renderResult() {
  const r = state.result;
  $('step4').classList.remove('hidden');
  $('docType').textContent = `Detected: ${r.docLabel}` + (r.straightened ? ' · straightened' : '') + (r.rotation ? ` · auto-rotated ${r.rotation}°` : '') + ` · OCR confidence ${r.meanConf}%`;
  const ul = $('messages'); ul.innerHTML = '';
  for (const m of r.messages) { const li = document.createElement('li'); li.className = m.level; li.textContent = m.text; ul.appendChild(li); }
  $('rawText').textContent = r.rawText || '';
  const form = $('fieldsForm'); form.innerHTML = '';
  if (!r.fields.length) { $('step5').classList.add('hidden'); return; }
  let section = null;
  for (const f of r.fields) {
    if (f.section !== section) {
      section = f.section;
      const h = document.createElement('div'); h.className = 'section-title'; h.textContent = r.sectionTitles[section]; form.appendChild(h);
    }
    form.appendChild(fieldRow(f));
  }
  $('step5').classList.remove('hidden');
  refreshOutput();
}

function fieldRow(f) {
  const row = document.createElement('div');
  row.className = `field s-${chipClass(f.status)}`;
  const id = 'f_' + f.key;
  const multi = /address|conditions/.test(f.key);
  const input = document.createElement(multi ? 'textarea' : 'input');
  if (!multi) input.type = 'text'; else input.rows = 2;
  input.id = id; input.value = f.value; input.spellcheck = false; input.autocapitalize = 'characters';
  input.placeholder = f.status === STATUS.NOT_FOUND ? 'Not found — type it if visible on the document' : (f.status === STATUS.UNREADABLE ? 'Not readable — type it from the document' : '');
  const label = document.createElement('label'); label.htmlFor = id; label.textContent = f.label;
  const wrap = document.createElement('div'); wrap.className = 'inwrap';
  const meta = document.createElement('div'); meta.className = 'meta';
  const chip = document.createElement('span'); chip.className = `chip ${chipClass(f.status)}`; chip.textContent = f.status;
  const note = document.createElement('span'); note.className = 'note';
  note.textContent = [f.confidence != null && f.status !== STATUS.NOT_FOUND ? `OCR ${f.confidence}%` : '', f.note].filter(Boolean).join(' · ');
  meta.append(chip, note);
  wrap.append(input, meta);
  const side = document.createElement('div'); side.className = 'side';
  const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'icon-btn'; cp.title = `Copy ${f.label}`; cp.textContent = '📋';
  cp.onclick = () => copyText(input.value, `${f.label} copied`);
  side.append(cp);
  input.addEventListener('input', () => {
    f.value = input.value.trim();
    f.status = f.value ? STATUS.EDITED : (f.originalStatus || STATUS.NOT_FOUND);
    if (!f.originalStatus) f.originalStatus = f.status;
    row.className = `field s-${chipClass(f.status)}`;
    chip.className = `chip ${chipClass(f.status)}`; chip.textContent = f.status;
    refreshOutput();
  });
  f.originalStatus = f.status;
  row.append(label, wrap, side);
  return row;
}

// ---------- STEP 5: output ----------
function refreshOutput() { if (state.result && state.result.fields.length) $('outText').value = toText(state.result, { includeExtra: $('chkExtra').checked }); }
$('chkExtra').onchange = refreshOutput;
$('btnCopyAll').onclick = () => copyText($('outText').value, 'All fields copied — paste into your form/report');
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const fname = (ext) => `extract-${state.result.docType}-${stamp()}.${ext}`;
$('btnTxt').onclick = () => state.result && download(fname('txt'), $('outText').value, 'text/plain');
$('btnCsv').onclick = () => state.result && download(fname('csv'), toCSV(state.result), 'text/csv');
$('btnJson').onclick = () => state.result && download(fname('json'), toJSON(state.result), 'application/json');

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Saved ${name} to your Downloads`);
}

async function copyText(text, msg) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else throw new Error('no clipboard api');
  } catch (e) {
    // fallback for http:// on a LAN address (phones opening the laptop's server)
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove();
  }
  toast(msg);
}

// ---------- Clear / Delete ----------
function clearResults() {
  state.result = null;
  $('fieldsForm').innerHTML = ''; $('messages').innerHTML = ''; $('rawText').textContent = ''; $('outText').value = '';
  $('step4').classList.add('hidden'); $('step5').classList.add('hidden');
  showStraightened(null);
}
async function clearAll() {
  clearResults();
  state.original = state.working = null; state.cropRect = null; state.rotation = 0; state.corners = null;
  drawPreview(); drawQuad();
  $('chkStraighten').checked = true;
  $('previewWrap').classList.add('hidden');
  $('btnExtract').disabled = true;
  $('inCamera').value = ''; $('inFile').value = '';
  document.querySelector('input[name=doctype][value=auto]').checked = true;
  await shutdown(); // also wipes the OCR engine's memory
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('Image and extracted data deleted from this device.');
}
$('fieldsForm').addEventListener('submit', (e) => e.preventDefault());
$('btnClear').onclick = clearAll;
$('btnClearTop').onclick = clearAll;
window.addEventListener('pagehide', () => { state.original = state.working = state.result = null; });

let toastTimer;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }

// Offline + "Add to Home Screen" support (only in secure contexts: https or localhost)
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// expose for automated smoke tests only
window.__PE = { state };
