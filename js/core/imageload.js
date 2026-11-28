// Safe photo loading for phones (low RAM, old browsers, 12–50 MP cameras).
// A 50 MP photo decoded at full size needs ~200 MB and can exceed the browser's canvas limits
// (≈16.7 M pixels on many Android browsers): the tab crashes or the canvas stays blank. The photo
// is therefore decoded straight to the working size whenever the browser can do that, and the
// result is checked before use. Nothing leaves the device.

/** Width, height and EXIF orientation from the first bytes of a JPEG or PNG (null if unknown). */
export function parseImageInfo(u8) {
  const b = u8, n = b.length;
  if (n > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, n);
    return { type: 'png', w: dv.getUint32(16), h: dv.getUint32(20), orientation: 1 };
  }
  if (n < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2, orientation = 1;
  while (i + 9 < n) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xe1 && i + 10 < n && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; // TIFF header
      const le = b[t] === 0x49;
      const u16 = (p) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
      const u32 = (p) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
      if (t + 8 < n) {
        const ifd = t + u32(t + 4);
        if (ifd + 2 < n) { const cnt = u16(ifd); for (let k = 0; k < cnt && ifd + 2 + k * 12 + 10 < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === 0x0112) { const o = u16(e + 8); if (o >= 1 && o <= 8) orientation = o; } } }
      }
    }
    // start of frame (baseline / progressive / …, not DHT 0xC4, JPG 0xC8, DAC 0xCC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { type: 'jpeg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], orientation };
    }
    if (m === 0xda) break; // image data started without a frame header
    i += 2 + len;
  }
  return null;
}

async function readInfo(file) {
  try {
    // most phones put the frame header in the first few hundred KB (after EXIF and its thumbnail)
    for (const size of [262144, 4194304]) {
      const info = parseImageInfo(new Uint8Array(await file.slice(0, size).arrayBuffer()));
      if (info || file.size <= size) return info;
    }
  } catch (e) { /* unknown format */ }
  return null;
}

// How does this browser combine EXIF orientation with resizeWidth/resizeHeight? Probed once on a
// 16×8 JPEG (left red / right blue) with orientation 6 (shown as 8×16: top red / bottom blue).
const PROBE = '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAAIABADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4/r+dz/ZA+a6/6GD/AAvP/9k=';
let probed = null;
async function resizeMode() {
  if (probed) return probed;
  probed = (async () => {
    try {
      const bin = atob(PROBE), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u], { type: 'image/jpeg' }), { imageOrientation: 'from-image', resizeWidth: 8, resizeHeight: 16, resizeQuality: 'high' });
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const w = bmp.width, h = bmp.height; if (bmp.close) bmp.close();
      const px = (x, y) => g.getImageData(x, y, 1, 1).data;
      let mode = 'none';
      if (w === 8 && h === 16) { const a = px(1, 2), b = px(6, 2); mode = a[0] > a[2] && b[0] > b[2] ? 'oriented' : 'raw-unrotated'; } // top row all red = rotated
      else if (w === 16 && h === 8) mode = 'raw'; // resized before rotating
      c.width = c.height = 0;
      return mode;
    } catch (e) { return 'none'; }
  })();
  return probed;
}

function viaImgElement(file) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); res(null); };
    im.src = url;
  });
}

/**
 * Decode a photo to an ImageData no larger than maxSide (long side), EXIF orientation applied when
 * the browser supports it. Returns { image, info: { w, h, orientation, decodedW, decodedH, path } }.
 * Throws an Error with a plain-language message when the photo cannot be opened.
 */
export async function loadPhoto(file, maxSide) {
  const info = await readInfo(file);
  let bmp = null, path = '';
  const swap = info && info.orientation >= 5 && info.orientation <= 8;
  if (typeof createImageBitmap === 'function') {
    if (info && Math.max(info.w, info.h) > maxSide) {
      const mode = await resizeMode();
      const f = maxSide / Math.max(info.w, info.h);
      const dims = mode === 'oriented' && swap ? [info.h, info.w] : [info.w, info.h];
      if (mode !== 'none') {
        try {
          bmp = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: Math.max(1, Math.round(dims[0] * f)), resizeHeight: Math.max(1, Math.round(dims[1] * f)), resizeQuality: 'high' });
          path = 'bitmap-resized';
        } catch (e) { bmp = null; }
      }
    }
    if (!bmp) { try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); path = 'bitmap'; } catch (e) { bmp = null; } }
  }
  if (!bmp) { bmp = await viaImgElement(file); path = 'img'; }
  if (!bmp || !bmp.width || !bmp.height) throw new Error('This image could not be opened. Send or choose a JPG photo (on iPhone: Camera → Formats → "Most Compatible").');
  const w0 = bmp.width, h0 = bmp.height;
  const f = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * f)); c.height = Math.max(1, Math.round(h0 * f));
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('The phone could not prepare the photo (no drawing memory left). Close other apps or browser tabs and try again.');
  g.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  let image;
  try { image = g.getImageData(0, 0, c.width, c.height); } catch (e) { throw new Error('The phone ran out of memory preparing the photo. Close other apps, or set the camera to a lower resolution (8–12 MP), and try again.'); }
  c.width = c.height = 0; // release the canvas memory now
  // a canvas that silently failed (memory / size limits) comes back fully transparent or black
  const d = image.data; let seen = 0;
  for (let k = 0; k < 400; k++) { const p = (Math.floor((k * 2654435761) % (d.length / 4))) * 4; if (d[p + 3] !== 0 && (d[p] | d[p + 1] | d[p + 2]) !== 0) seen++; }
  if (seen === 0) throw new Error('The photo came out blank after loading (the phone ran out of memory or the picture is too large). Set the camera to a lower resolution (8–12 MP) or close other apps, then try again.');
  return { image, info: { ...(info || {}), decodedW: w0, decodedH: h0, path } };
}
