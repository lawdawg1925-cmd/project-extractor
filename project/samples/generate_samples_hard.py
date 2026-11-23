#!/usr/bin/env python3
"""Phase-2 HARD synthetic samples (all data FICTITIOUS, no official seals/logos):
documents photographed at an angle on wood / cluttered tables, with glare, hologram-like
overlay, guilloche patterns behind text, motion blur and low light. Also a newer
'10-year style' license layout and an older typewritten CR layout.
Ground-truth document corners are saved in expected.json (for the perspective test)."""
import json, math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageChops
import generate_samples as G

HERE = os.path.dirname(os.path.abspath(__file__))
rng = random.Random(11)
F_MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
font = G.font

# ------------------------------------------------------------- 10-year style license
def guilloche(img, color, alpha=60, step=9, amp=18):
    W, H = img.size
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for k in range(-H, H, step):
        pts = [(x, k + x * 0.35 + amp * math.sin(x / 37.0 + k / 50.0)) for x in range(0, W + 20, 12)]
        d.line(pts, fill=color + (alpha,), width=2)
    for k in range(0, W + H, step * 2):
        pts = [(x, -k + x * 1.1 + amp * math.cos(x / 53.0)) for x in range(0, W + 20, 12)]
        d.line(pts, fill=color + (alpha // 2,), width=1)
    return Image.alpha_composite(img.convert("RGBA"), layer)

def hologram(img, box):
    W, H = img.size
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    for i in range(0, x1 - x0, 6):
        hue = i / (x1 - x0)
        col = (int(180 + 70 * math.sin(6.28 * hue)), int(180 + 70 * math.sin(6.28 * hue + 2)), int(180 + 70 * math.sin(6.28 * hue + 4)), 55)
        d.ellipse([x0 + i, y0, x0 + i + 60, y1], outline=col, width=3)
    return Image.alpha_composite(img.convert("RGBA"), layer)

def make_license10(p):
    W, H = 1700, 1072
    img = G.security_bg(W, H, (238, 228, 240), (222, 236, 246)).convert("RGBA")
    img = guilloche(img, (150, 110, 170), alpha=70)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, W - 5, H - 5], radius=40, outline=(120, 100, 150), width=4)
    d.rectangle([0, 0, W, 205], fill=(40, 60, 130, 235))
    cx = W // 2 + 120
    d.text((cx, 38), "REPUBLIC OF THE PHILIPPINES", font=font(30, True), fill=(255, 255, 255), anchor="mm")
    d.text((cx, 78), "DEPARTMENT OF TRANSPORTATION", font=font(28), fill=(235, 235, 255), anchor="mm")
    d.text((cx, 116), "LAND TRANSPORTATION OFFICE", font=font(34, True), fill=(255, 255, 255), anchor="mm")
    d.text((cx, 166), "DRIVER'S LICENSE", font=font(46, True), fill=(255, 225, 120), anchor="mm")
    d.rectangle([50, 240, 430, 710], fill=(205, 205, 220), outline=(90, 90, 110), width=3)
    d.ellipse([170, 300, 310, 450], fill=(160, 160, 180)); d.rounded_rectangle([110, 460, 370, 710], radius=60, fill=(160, 160, 180))
    x0 = 480
    L = lambda x, y, t: d.text((x, y), t, font=font(24), fill=(80, 60, 110))
    V = lambda x, y, t, s=36: d.text((x, y), t, font=font(s, True), fill=(15, 10, 25))
    L(x0, 228, "Last Name, First Name, Middle Name"); V(x0, 258, p["name"], 44)
    for x, lab, val in [(x0, "Nationality", p["nationality"]), (x0 + 200, "Sex", p["sex"]), (x0 + 330, "Date of Birth", p["dob"]),
                        (x0 + 610, "Weight (kg)", p["weight"]), (x0 + 800, "Height(m)", p["height"])]:
        L(x, 333, lab); V(x, 363, val)
    L(x0, 423, "Address"); V(x0, 453, p["addr1"], 32); V(x0, 491, p["addr2"], 32)
    for x, lab, val in [(x0, "License No.", p["license_no"]), (x0 + 380, "Expiration Date", p["exp"]), (x0 + 700, "Agency Code", p["agency"])]:
        L(x, 556, lab); V(x, 586, val)
    for x, lab, val in [(x0, "Blood Type", p["blood"]), (x0 + 220, "Eyes Color", p["eyes"]), (x0 + 450, "DL Codes", p["dl_codes"])]:
        L(x, 651, lab); V(x, 681, val)
    L(x0, 746, "Conditions"); V(x0, 776, p["conditions"])
    L(1250, 850, "Serial No."); d.text((1250, 880), "SN-0000000", font=font(28), fill=(120, 20, 20))
    img = hologram(img, (900, 300, 1450, 560))
    return G.watermark(img.convert("RGB"))

# ------------------------------------------------------------- new-style LTO layout (mimics real 2023+ cards)
def make_license_lto_new(p):
    W, H = 1700, 1072
    img = G.security_bg(W, H, (236, 242, 236), (244, 240, 226)).convert("RGBA")
    img = guilloche(img, (120, 160, 130), alpha=45, step=11, amp=14)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, W - 5, H - 5], radius=40, outline=(110, 140, 120), width=4)
    cx = W // 2 + 130
    d.text((cx, 36), "REPUBLIC OF THE PHILIPPINES", font=font(28, True), fill=(20, 40, 100), anchor="mm")
    d.text((cx, 72), "DEPARTMENT OF TRANSPORTATION", font=font(26), fill=(20, 40, 100), anchor="mm")
    d.text((cx, 108), "LAND TRANSPORTATION OFFICE", font=font(32, True), fill=(20, 40, 100), anchor="mm")
    d.text((cx, 156), "DRIVER'S LICENSE", font=font(44, True), fill=(20, 30, 120), anchor="mm")
    d.rectangle([45, 210, 415, 650], fill=(205, 208, 215), outline=(90, 90, 110), width=3)
    d.ellipse([160, 270, 300, 420], fill=(160, 165, 180)); d.rounded_rectangle([100, 430, 360, 650], radius=60, fill=(160, 165, 180))
    # small print under the photo: issue date + tiny repeat of number/name (must NOT be taken as fields)
    d.text((120, 668), p["issued"], font=font(24, True), fill=(30, 30, 30))
    d.text((50, 708), f'{p["license_no"]} {p["name"]}', font=font(15), fill=(60, 60, 60))
    x0 = 455
    L = lambda x, y, t: d.text((x, y), t, font=font(22), fill=(70, 80, 100))
    V = lambda x, y, t, s=34: d.text((x, y), t, font=font(s, True), fill=(10, 10, 10))
    L(x0, 200, "Last Name, First Name, Middle Name"); V(x0, 228, p["name"], 42)
    for x, lab, val in [(x0, "Nationality", p["nationality"]), (x0 + 190, "Sex", p["sex"]), (x0 + 300, "Date of Birth", p["dob"]),
                        (x0 + 560, "Weight (kg)", p["weight"]), (x0 + 740, "Height(m)", p["height"])]:
        L(x, 296, lab); V(x, 322, val)
    L(x0, 380, "Address"); V(x0, 406, p["addr1"], 30)
    for x, lab, val in [(x0, "License No.", p["license_no"]), (x0 + 360, "Expiration Date", p["exp"]), (x0 + 640, "Agency Code", p["agency"])]:
        L(x, 466, lab); V(x, 492, val)
    for x, lab, val in [(x0, "Blood Type", p["blood"]), (x0 + 200, "Eyes Color", p["eyes"])]:
        L(x, 552, lab); V(x, 578, val)
    L(x0, 638, "DL Codes"); V(x0, 664, p["dl_codes"], 32)
    L(x0 + 360, 638, "Conditions"); V(x0 + 360, 664, p["conditions"], 32)
    # signatory block printed right of Conditions (fictitious name)
    d.line([(1150, 690), (1560, 660)], fill=(40, 40, 90), width=3)
    d.text((1160, 670), p["signatory"], font=font(24, True), fill=(20, 20, 60))
    d.text((1230, 702), "Assistant Secretary", font=font(20), fill=(40, 40, 70))
    L(x0, 760, "Signature of Licensee"); d.line([(x0, 750), (x0 + 380, 750)], fill=(60, 60, 60), width=2)
    return G.watermark(img.convert("RGB"))

def paper_wood_bg(W, H):
    bg = wood_bg(W, H)
    d = ImageDraw.Draw(bg)
    d.polygon([(1500, 0), (2400, 0), (2400, 900), (1700, 1100)], fill=(236, 234, 228))  # a sheet of paper behind
    for y in range(80, 900, 46): d.line([(1560, y), (2380, y - 20)], fill=(170, 170, 175), width=2)
    return bg

# ------------------------------------------------------------- older typewritten CR
def make_cr_old(p):
    W, H = 2000, 1500
    img = Image.new("RGB", (W, H), (244, 238, 220))
    px = np.array(img).astype(np.int16)
    px += np.random.default_rng(3).integers(-8, 8, size=px.shape, dtype=np.int16)
    img = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    d.rectangle([30, 30, W - 30, H - 30], outline=(120, 90, 60), width=3)
    d.text((W // 2, 80), "REPUBLIC OF THE PHILIPPINES", font=font(30, True), fill=(80, 50, 30), anchor="mm")
    d.text((W // 2, 120), "LAND TRANSPORTATION OFFICE", font=font(32, True), fill=(80, 50, 30), anchor="mm")
    d.text((W // 2, 180), "CERTIFICATE OF REGISTRATION", font=font(50, True), fill=(60, 30, 20), anchor="mm")
    mono = ImageFont.truetype(F_MONO, 38)
    lab = lambda x, y, t: d.text((x, y + 6), t, font=font(26, True), fill=(90, 60, 40))
    val = lambda x, y, t: d.text((x, y), t, font=mono, fill=(25, 25, 45))
    lab(80, 250, "CR NO."); val(240, 250, p["cr_no"]); lab(1150, 250, "DATE ISSUED:"); val(1400, 250, p["date"])
    left = [("MV FILE NO.:", p["mv_file_no"]), ("PLATE NO.:", p["plate_no"]), ("ENGINE NO.:", p["engine_no"]), ("CHASSIS NO.:", p["chassis_no"]),
            ("DENOMINATION:", p["denomination"]), ("PISTON DISPL.:", p["piston"]), ("NO. OF CYL.:", p["cyl"]), ("FUEL:", p["fuel"])]
    right = [("MAKE:", p["make"]), ("SERIES:", p["series"]), ("TYPE OF BODY:", p["body_type"]), ("YEAR MODEL:", p["year"]),
             ("COLOR:", p["color"]), ("GROSS WT.:", p["gross"]), ("NET WT.:", p["net"]), ("NET CAPACITY:", p["capacity"])]
    for i, (a, b) in enumerate(left):
        y = 350 + i * 90; lab(80, y, a); val(400, y, b); d.line([(400, y + 48), (960, y + 48)], fill=(150, 120, 90), width=1)
    for i, (a, b) in enumerate(right):
        y = 350 + i * 90; lab(1050, y, a); val(1340, y, b); d.line([(1340, y + 48), (1930, y + 48)], fill=(150, 120, 90), width=1)
    lab(80, 1100, "CLASSIFICATION:"); val(400, 1100, p["classification"])
    lab(80, 1190, "OWNER:"); val(400, 1190, p["owner"])
    lab(80, 1280, "ADDRESS:"); val(400, 1280, p["owner_addr"])
    # faint red rubber-stamp text box (not an official seal)
    st = Image.new("RGBA", (420, 130), (0, 0, 0, 0)); sd = ImageDraw.Draw(st)
    sd.rectangle([4, 4, 415, 125], outline=(200, 40, 40, 120), width=6); sd.text((210, 65), "PAID", font=font(70, True), fill=(200, 40, 40, 110), anchor="mm")
    st = st.rotate(12, expand=True); img = img.convert("RGBA"); img.alpha_composite(st, (1450, 1150))
    return G.watermark(img.convert("RGB"))

# ------------------------------------------------------------- photo scene
def wood_bg(W, H):
    y = np.arange(H)[:, None]; x = np.arange(W)[None, :]
    grain = np.sin(y / 9.0 + 3 * np.sin(x / 210.0) + 0.5 * np.sin(y / 31.0)) * 0.5 + 0.5
    base = np.stack([120 + 50 * grain, 75 + 35 * grain, 40 + 20 * grain], -1)
    base += np.random.default_rng(1).normal(0, 7, base.shape)
    planks = ((y // 260) % 2) * 12
    return Image.fromarray(np.clip(base - planks[..., None], 0, 255).astype(np.uint8))

def clutter_bg(W, H):
    img = Image.new("RGB", (W, H), (70, 74, 82))
    d = ImageDraw.Draw(img)
    r = random.Random(5)
    for _ in range(18):
        x, y = r.randrange(W), r.randrange(H)
        col = (r.randrange(30, 200), r.randrange(30, 200), r.randrange(30, 200))
        if r.random() < 0.5: d.rounded_rectangle([x, y, x + r.randrange(80, 400), y + r.randrange(30, 120)], radius=20, fill=col)
        else: d.ellipse([x, y, x + r.randrange(60, 200), y + r.randrange(60, 200)], fill=col)
    for _ in range(25):
        d.line([(r.randrange(W), r.randrange(H)), (r.randrange(W), r.randrange(H))], fill=(r.randrange(90, 160),) * 3, width=r.randrange(2, 6))
    px = np.array(img).astype(np.float32) + np.random.default_rng(2).normal(0, 6, (H, W, 3))
    return Image.fromarray(np.clip(px, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))

def table_bg(W, H):
    px = np.full((H, W, 3), (48, 52, 58), np.float32) + np.random.default_rng(4).normal(0, 5, (H, W, 3))
    return Image.fromarray(np.clip(px, 0, 255).astype(np.uint8))

def persp_coeffs(src, dst):
    """Coefficients for PIL Image.transform(PERSPECTIVE): maps OUTPUT (dst) pixel → INPUT (src) pixel."""
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

def scene(doc, bg, corners, glare=None, motion=0, lowlight=False, shadow=True, size=(2400, 1800)):
    W, H = size
    out = bg.copy().convert("RGB")
    w, h = doc.size
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    warped = doc.transform((W, H), Image.PERSPECTIVE, persp_coeffs(src, corners), Image.BICUBIC)
    mask = Image.new("L", (W, H), 0); ImageDraw.Draw(mask).polygon(corners, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    if shadow:
        sh = Image.new("L", (W, H), 0); ImageDraw.Draw(sh).polygon([(x + 18, y + 22) for x, y in corners], fill=120)
        sh = sh.filter(ImageFilter.GaussianBlur(18))
        out = Image.composite(Image.new("RGB", (W, H), (10, 10, 10)), out, sh)
    out = Image.composite(warped, out, mask)
    arr = np.array(out).astype(np.float32)
    # gentle uneven lighting across the whole photo
    yy, xx = np.mgrid[0:H, 0:W]
    arr *= (0.88 + 0.12 * (xx / W))[..., None]
    if glare:
        gx, gy, gr, strength = glare
        g = np.exp(-(((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * gr ** 2))) * strength
        arr = arr + (255 - arr) * g[..., None]
    if motion:
        k = int(motion); acc = np.zeros_like(arr)
        for s in range(k): acc += np.roll(arr, s - k // 2, axis=1)
        arr = acc / k
    if lowlight:
        arr = arr * 0.42 + np.random.default_rng(9).normal(0, 9, arr.shape)
        arr[..., 2] *= 0.85
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

LIC10 = dict(name="RAMOS, ELMER BAUTISTA", nationality="PHL", sex="M", dob="1995/03/08", weight="68", height="1.68",
             addr1="ZONE 3, BRGY. CAROLINA,", addr2="NAGA CITY, CAMARINES SUR", license_no="E05-21-002468", exp="2034/03/08",
             agency="E05", blood="AB+", eyes="BLACK", dl_codes="A, B, B1", conditions="NONE")
CROLD = dict(cr_no="04512398", date="1999/06/18", mv_file_no="0507-00000234567", plate_no="WKD 582", engine_no="4G15P123456",
             chassis_no="CK2A-0012345", denomination="CAR", piston="1468", cyl="4", fuel="GAS", make="MITSUBISHI", series="LANCER GLX",
             body_type="SEDAN", year="1998", color="BLUE", gross="1360", net="975", capacity="5 PERSONS", classification="PRIVATE",
             owner="LOPEZ, RAMON SANTOS", owner_addr="21 BAGUMBAYAN SUR, NAGA CITY")

LTONEW = dict(name="MERCADO, LUIS ANDRES", nationality="PHL", sex="M", dob="1983/04/17", weight="78", height="1.64",
              addr1="1520 MAGSAYSAY AVE. CONCEPCION GRANDE NAGA CITY", addr2="", license_no="E07-15-123987", exp="2033/04/17",
              agency="E07", blood="O+", eyes="BLACK", dl_codes="A,A1,B,B1,B2", conditions="NONE", issued="2024/05/10",
              signatory="ATTY. RAMON T. FICTICIO II")

def ltonew_expected():
    e = G.lic_expected(dict(LTONEW, header="DRIVER'S LICENSE"))
    e["dl_codes"] = "A, A1, B, B1, B2"
    return e

def lic10_expected():
    p = dict(LIC10, header="DRIVER'S LICENSE"); return G.lic_expected(p)

def main():
    path = os.path.join(HERE, "expected.json")
    exp = json.load(open(path))
    lic10 = make_license10(LIC10)
    lic1 = G.make_license(G.LIC1)
    cr1 = G.make_cr(G.CR1)
    crold = make_cr_old(CROLD)
    S = (2400, 1800)
    ltonew = make_license_lto_new(LTONEW)
    items = {
        "license_ltonew_flat.png": (ltonew, "license", ltonew_expected(), None),
        "license_ltonew_handheld_tilt.jpg": (ltonew, "license", ltonew_expected(),
            dict(bg=paper_wood_bg(*S), corners=[(470, 470), (1890, 330), (1990, 1250), (520, 1420)], glare=(900, 700, 110, 0.35))),
        "license10_clean.png": (lic10, "license", lic10_expected(), None),
        "cr_old_layout_clean.png": (crold, "cr", G.cr_expected(CROLD), None),
        "license10_perspective_wood.jpg": (lic10, "license", lic10_expected(),
            dict(bg=wood_bg(*S), corners=[(520, 380), (1880, 300), (1960, 1240), (430, 1330)], glare=(1300, 650, 150, 0.55))),
        "license_perspective_glare_clutter.jpg": (lic1, "license", G.lic_expected(G.LIC1),
            dict(bg=clutter_bg(*S), corners=[(600, 420), (1820, 520), (1760, 1380), (480, 1290)], glare=(1500, 800, 120, 0.7), motion=3)),
        "license10_lowlight_motion.jpg": (lic10, "license", lic10_expected(),
            dict(bg=table_bg(*S), corners=[(380, 330), (2010, 360), (2050, 1400), (330, 1380)], motion=5, lowlight=True)),
        "cr_perspective_wood_glare.jpg": (cr1, "cr", G.cr_expected(G.CR1),
            dict(bg=wood_bg(*S), corners=[(250, 230), (2170, 170), (2240, 1600), (160, 1660)], glare=(1500, 700, 170, 0.6))),
        "cr_old_perspective_clutter_lowlight.jpg": (crold, "cr", G.cr_expected(CROLD),
            dict(bg=clutter_bg(*S), corners=[(300, 260), (2080, 330), (2120, 1640), (240, 1580)], lowlight=True, motion=3)),
    }
    for name, (doc, typ, e, sc) in items.items():
        rec = {"type": typ, "kind": "hard", "fields": e}
        if sc:
            im = scene(doc, sc["bg"], sc["corners"], glare=sc.get("glare"), motion=sc.get("motion", 0), lowlight=sc.get("lowlight", False), size=S)
            rec["corners"] = sc["corners"]
            if name == "license10_lowlight_motion.jpg":
                rec["cornersKnownHard"] = "dark header band blends into the dark table in low light"
            im.save(os.path.join(HERE, name), quality=85)
        else:
            rec["kind"] = "hard-layout"
            doc.save(os.path.join(HERE, name))
        exp[name] = rec
    json.dump(exp, open(path, "w"), indent=2)
    print("wrote", len(items), "hard samples")

if __name__ == "__main__":
    main()
