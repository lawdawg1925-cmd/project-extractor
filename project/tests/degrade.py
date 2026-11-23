#!/usr/bin/env python3
"""Simulate low-end phone cameras: small sensor/resolution, blur, noise, dim light, JPEG, slight tilt.
Usage: python3 tests/degrade.py OUT_DIR IMG [IMG ...]
Writes OUT_DIR/<name>__<profile>.jpg for each profile. Deterministic (fixed seeds).
Use only with synthetic samples inside the repo; write degraded copies of private photos OUTSIDE it."""
import sys, os
import numpy as np
from PIL import Image, ImageOps, ImageFilter

PROFILES = {
    # ~1 MP budget phone, decent light
    'lowA': dict(width=1000, blur=1.0, noise=6, dark=1.0, gamma=1.0, q=60, rot=1.0),
    # ~0.5 MP, indoor light, soft focus
    'lowB': dict(width=800, blur=1.4, noise=9, dark=0.62, gamma=1.25, q=50, rot=-1.5),
    # VGA-class, dim, heavy JPEG
    'lowC': dict(width=640, blur=1.1, noise=12, dark=0.5, gamma=1.35, q=40, rot=2.0),
    # cheap 5 MP phone indoors: enough pixels, but soft focus / shake, sensor noise, dim, strong JPEG
    'lowD': dict(width=1600, blur=2.2, noise=10, dark=0.6, gamma=1.2, q=45, rot=-1.0),
}

def degrade(im, p, seed):
    im = ImageOps.exif_transpose(im).convert('RGB')
    w = p['width']
    if im.width > im.height:  # keep the short side comparable for landscape shots
        w = int(w * 4 / 3)
    h = round(im.height * w / im.width)
    im = im.resize((w, h), Image.BILINEAR)
    if p['rot']:
        im = im.rotate(p['rot'], resample=Image.BILINEAR, expand=False, fillcolor=(90, 80, 70))
    im = im.filter(ImageFilter.GaussianBlur(p['blur']))
    a = np.asarray(im).astype(np.float32) / 255.0
    a = np.power(a, p['gamma']) * p['dark']
    rng = np.random.default_rng(seed)
    a = a * 255 + rng.normal(0, p['noise'], a.shape)
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return im

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    for i, f in enumerate(sys.argv[2:]):
        src = Image.open(f)
        base = os.path.splitext(os.path.basename(f))[0]
        for j, (name, p) in enumerate(PROFILES.items()):
            degrade(src, p, 1000 + 17 * i + j).save(os.path.join(out, f'{base}__{name}.jpg'), quality=p['q'])
    print('ok')
