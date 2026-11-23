// Service worker: caches ONLY the app's own files (code + OCR engine) so the tool opens offline.
// It never caches photos or extracted data (those never touch the network at all).
const CACHE = 'grx-scan-v7';
const FILES = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/ncpo-logo.png',
  './js/app.js', './js/file-warning.js', './js/core/ocr-browser.js', './js/core/pipeline.js', './js/core/image.js', './js/core/layout.js', './js/core/text.js',
  './js/core/formats.js', './js/core/quad.js', './js/core/refine.js', './js/core/status.js', './js/core/validate.js', './js/core/output.js', './js/core/table.js', './js/core/cellocr.js',
  './js/extractors/registry.js', './js/extractors/base.js', './js/extractors/license.js', './js/extractors/cr.js',
  './vendor/tesseract/tesseract.min.js', './vendor/tesseract/worker.min.js',
  './vendor/core/tesseract-core-simd-lstm.wasm.js', './vendor/core/tesseract-core-lstm.wasm.js',
  './vendor/lang/eng.traineddata.gz',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first (so updates show up), cache as offline fallback
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
