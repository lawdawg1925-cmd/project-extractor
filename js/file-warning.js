// Classic (non-module) script: browsers block the app's modules and OCR engine when index.html is
// opened by double-click (file://). Show plain instructions instead of a silent failure.
(function () {
  if (location.protocol !== 'file:') return;
  var d = document.createElement('div');
  d.style.cssText = 'background:#fff4e0;border:3px solid #d98200;color:#5a3600;padding:16px 18px;margin:14px;border-radius:14px;font:600 16px/1.5 system-ui,sans-serif';
  d.innerHTML = '⚠ The browser blocks this tool when the file is opened directly.<br>' +
    'Close this tab and double-click <b>start-windows.bat</b> (in the GRX Scan folder) instead. ' +
    'It opens the tool at <b>http://localhost:8765</b> — still 100% on this computer, nothing is uploaded.';
  document.addEventListener('DOMContentLoaded', function () { document.body.insertBefore(d, document.body.firstChild.nextSibling); });
})();
