#!/usr/bin/env python3
"""Generate SYNTHETIC, clearly FICTITIOUS Philippine Driver's License-style and
CR-style images for testing Project Extractor. No official seals/logos are drawn.
All names, numbers and addresses are invented."""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(7)
F_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
F_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
F_DJ = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def font(size, bold=False):
    return ImageFont.truetype(F_BOLD if bold else F_REG, size)

def watermark(img, text="SAMPLE \u2013 FICTITIOUS"):
    W, H = img.size
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = ImageFont.truetype(F_DJ, int(min(W, H) * 0.11))
    tw = d.textlength(text, font=f)
    tile = Image.new("RGBA", (int(tw) + 40, int(min(W, H) * 0.16)), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text((20, 0), text, font=f, fill=(220, 60, 60, 38))
    tile = tile.rotate(18, expand=True)
    layer.paste(tile, ((W - tile.width) // 2, (H - tile.height) // 2), tile)
    out = Image.alpha_composite(img.convert("RGBA"), layer)
    d = ImageDraw.Draw(out)
    d.text((20, H - 34), "SAMPLE \u2013 FICTITIOUS DATA FOR TESTING ONLY", font=ImageFont.truetype(F_DJ, 20), fill=(200, 40, 40, 255))
    return out.convert("RGB")

def security_bg(W, H, c1, c2):
    img = Image.new("RGB", (W, H), c1)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        col = tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3))
        d.line([(0, y), (W, y)], fill=col)
    for k in range(0, W + H, 14):  # guilloche-ish fine lines
        d.arc([k - 400, -200, k + 400, H + 200], 0, 360, fill=tuple(max(0, c - 12) for c in c1), width=1)
    return img

# ----------------------------------------------------------------- LICENSE
def make_license(p):
    W, H = 1700, 1072
    img = security_bg(W, H, (232, 240, 248), (246, 236, 222))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, W - 5, H - 5], radius=40, outline=(120, 140, 170), width=4)
    cx = W // 2 + 120
    d.text((cx, 40), "REPUBLIC OF THE PHILIPPINES", font=font(30, True), fill=(30, 40, 90), anchor="mm")
    d.text((cx, 80), "DEPARTMENT OF TRANSPORTATION", font=font(28), fill=(30, 40, 90), anchor="mm")
    d.text((cx, 118), "LAND TRANSPORTATION OFFICE", font=font(34, True), fill=(30, 40, 90), anchor="mm")
    d.text((cx, 170), p["header"], font=font(46, True), fill=(20, 30, 120), anchor="mm")
    # photo placeholder (generic silhouette, not a real person)
    d.rectangle([50, 230, 430, 700], fill=(205, 210, 220), outline=(90, 90, 110), width=3)
    d.ellipse([170, 290, 310, 440], fill=(160, 165, 180))
    d.rounded_rectangle([110, 450, 370, 700], radius=60, fill=(160, 165, 180))
    d.text((240, 730), "PHOTO", font=font(24), fill=(90, 90, 110), anchor="mm")
    x0 = 480
    L = lambda x, y, t: d.text((x, y), t, font=font(24), fill=(70, 80, 110))
    V = lambda x, y, t, s=36: d.text((x, y), t, font=font(s, True), fill=(10, 10, 10))
    L(x0, 225, "Last Name, First Name, Middle Name")
    V(x0, 255, p["name"], 44)
    y = 330
    cols = [(x0, "Nationality", p["nationality"]), (x0 + 200, "Sex", p["sex"]), (x0 + 330, "Date of Birth", p["dob"]),
            (x0 + 610, "Weight (kg)", p["weight"]), (x0 + 800, "Height(m)", p["height"])]
    for x, lab, val in cols:
        L(x, y, lab); V(x, y + 30, val)
    L(x0, 420, "Address")
    V(x0, 450, p["addr1"], 32)
    if p.get("addr2"):
        V(x0, 490, p["addr2"], 32)
    y = 560
    cols = [(x0, "License No.", p["license_no"]), (x0 + 380, "Expiration Date", p["exp"]), (x0 + 700, "Agency Code", p["agency"])]
    for x, lab, val in cols:
        L(x, y, lab); V(x, y + 30, val)
    y = 660
    cols = [(x0, "Blood Type", p["blood"]), (x0 + 220, "Eyes Color", p["eyes"])]
    if "dl_codes" in p:
        cols += [(x0 + 450, "DL Codes", p["dl_codes"])]
    else:
        cols += [(x0 + 450, "Restrictions", p["restrictions"])]
    for x, lab, val in cols:
        L(x, y, lab); V(x, y + 30, val)
    L(x0, 760, "Conditions"); V(x0, 790, p["conditions"])
    # signature line (no real signature)
    d.line([(1150, 900), (1600, 900)], fill=(60, 60, 60), width=2)
    L(1260, 910, "Signature of Licensee")
    return watermark(img)

# ----------------------------------------------------------------- CR
def make_cr(p, H=1500):
    W = 2100
    img = security_bg(W, 1500, (248, 246, 236), (238, 244, 236))
    d = ImageDraw.Draw(img)
    d.text((W // 2, 50), "REPUBLIC OF THE PHILIPPINES", font=font(32, True), fill=(30, 60, 30), anchor="mm")
    d.text((W // 2, 92), "DEPARTMENT OF TRANSPORTATION", font=font(28), fill=(30, 60, 30), anchor="mm")
    d.text((W // 2, 132), "LAND TRANSPORTATION OFFICE", font=font(34, True), fill=(30, 60, 30), anchor="mm")
    d.text((W // 2, 195), "CERTIFICATE OF REGISTRATION", font=font(52, True), fill=(10, 40, 10), anchor="mm")
    d.text((1600, 250), "CR No.", font=font(26), fill=(60, 80, 60))
    d.text((1720, 244), p["cr_no"], font=font(36, True), fill=(160, 20, 20))
    d.text((80, 250), "Date", font=font(26), fill=(60, 80, 60))
    d.text((160, 244), p["date"], font=font(36, True), fill=(10, 10, 10))
    rows = [
        [("MV File No.", p["mv_file_no"]), ("Plate No.", p["plate_no"]), ("Engine No.", p["engine_no"]), ("Chassis No.", p["chassis_no"])],
        [("Denomination", p["denomination"]), ("Piston Displacement", p["piston"]), ("Number of Cylinders", p["cyl"]), ("Fuel", p["fuel"])],
        [("Make", p["make"]), ("Series", p["series"]), ("Body Type", p["body_type"]), ("Year Model", p["year"])],
        [("Gross Wt.", p["gross"]), ("Net Wt.", p["net"]), ("Net Capacity", p["capacity"]), ("Color", p["color"])],
        [("Classification", p["classification"])],
        [("Owner's Name", p["owner"])],
        [("Address", p["owner_addr"])],
    ]
    top, rh, left, right = 310, 150, 60, W - 60
    for r, row in enumerate(rows):
        y = top + r * rh
        n = len(row)
        cw = (right - left) / n
        for c, (lab, val) in enumerate(row):
            x = left + c * cw
            d.rectangle([x, y, x + cw, y + rh], outline=(90, 110, 90), width=2)
            d.text((x + 14, y + 10), lab, font=font(26), fill=(60, 80, 60))
            d.text((x + 14, y + 62), val, font=font(40, True), fill=(10, 10, 10))
    img = watermark(img)
    if H < 1500:
        img = img.crop((0, 0, W, H))
    return img

# ----------------------------------------------------------------- degradations
def on_background(img, angle=0, bg=(120, 100, 80), pad=160):
    W, H = img.size
    canvas = Image.new("RGB", (W + 2 * pad, H + 2 * pad), bg)
    px = canvas.load()
    for _ in range(40000):
        x, y = random.randrange(canvas.width), random.randrange(canvas.height)
        g = random.randint(-25, 25)
        px[x, y] = tuple(max(0, min(255, c + g)) for c in bg)
    canvas.paste(img, (pad, pad))
    if angle:
        canvas = canvas.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=bg)
    return canvas

def lowq(img, blur=1.6, contrast=0.55, bright=1.15):
    img = img.filter(ImageFilter.GaussianBlur(blur))
    img = ImageEnhance.Contrast(img).enhance(contrast)
    img = ImageEnhance.Brightness(img).enhance(bright)
    return img

LIC1 = dict(header="DRIVER'S LICENSE", name="DELA CRUZ, JUAN SANTOS", nationality="PHL", sex="M", dob="1990/01/15",
            weight="70", height="1.70", addr1="123 MAGSAYSAY AVENUE, BRGY. PENAFRANCIA,", addr2="NAGA CITY, CAMARINES SUR",
            license_no="D12-34-567890", exp="2031/01/15", agency="D12", blood="O+", eyes="BLACK",
            dl_codes="A, A1, B, B1, B2", conditions="NONE")
LIC2 = dict(header="NON-PROFESSIONAL DRIVER'S LICENSE", name="SANTOS, MARIA CLARA REYES", nationality="PHL", sex="F",
            dob="1985/07/22", weight="55", height="1.58", addr1="45 PANGANIBAN DRIVE, BRGY. TINAGO, NAGA CITY, CAMARINES SUR",
            license_no="D05-18-004321", exp="2028/07/22", agency="D05", blood="A+", eyes="BROWN",
            restrictions="1, 2", conditions="A - WEAR CORRECTIVE LENSES")
CR1 = dict(cr_no="123456789", date="2024/03/12", mv_file_no="0517-00000123456", plate_no="NBC 1234", engine_no="2NRX123456",
           chassis_no="MR2B29F30K1234567", denomination="CAR", piston="1496", cyl="4", fuel="GAS", make="TOYOTA",
           series="VIOS 1.5 G CVT", body_type="SEDAN", year="2024", gross="1500", net="1060", capacity="5 PERSONS",
           color="WHITE", classification="PRIVATE", owner="DELA CRUZ, JUAN SANTOS",
           owner_addr="123 MAGSAYSAY AVENUE, NAGA CITY, CAMARINES SUR")
CR2 = dict(cr_no="987654321", date="2023/11/05", mv_file_no="0507-00000987654", plate_no="456 KJX", engine_no="JK12E7654321",
           chassis_no="MH1JK1234PK765432", denomination="MC", piston="125", cyl="1", fuel="GAS", make="HONDA",
           series="CLICK 125I", body_type="SCOOTER", year="2023", gross="200", net="112", capacity="2 PERSONS",
           color="RED/BLACK", classification="PRIVATE", owner="REYES, PEDRO GOMEZ",
           owner_addr="78 ELIAS ANGELES ST., NAGA CITY, CAMARINES SUR")

def lic_expected(p):
    last, rest = [s.strip() for s in p["name"].split(",", 1)]
    parts = rest.split()
    e = {
        "license_no": p["license_no"], "full_name": p["name"], "last_name": last,
        "first_name": " ".join(parts[:-1]) if len(parts) > 1 else parts[0], "middle_name": parts[-1] if len(parts) > 1 else "",
        "nationality": p["nationality"], "sex": p["sex"], "date_of_birth": p["dob"], "weight": p["weight"], "height": p["height"],
        "address": (p["addr1"] + " " + p.get("addr2", "")).strip(), "expiration_date": p["exp"], "agency_code": p["agency"],
        "blood_type": p["blood"], "eye_color": p["eyes"], "conditions": p["conditions"],
        "classification": "NON-PROFESSIONAL" if "NON-PROF" in p["header"] else None,
    }
    if "dl_codes" in p: e["dl_codes"] = p["dl_codes"]; e["restrictions"] = None
    else: e["restrictions"] = p["restrictions"]; e["dl_codes"] = None
    return e

def cr_expected(p, cropped=False):
    e = {"cr_no": p["cr_no"], "date_registered": p["date"], "mv_file_no": p["mv_file_no"], "plate_no": p["plate_no"],
         "engine_no": p["engine_no"], "chassis_no": p["chassis_no"], "vin": None, "denomination": p["denomination"],
         "piston_displacement": p["piston"], "cylinders": p["cyl"], "fuel": p["fuel"], "make": p["make"], "series": p["series"],
         "body_type": p["body_type"], "year_model": p["year"], "gross_wt": p["gross"], "net_wt": p["net"],
         "net_capacity": p["capacity"], "color": p["color"], "classification": p["classification"],
         "owner_name": p["owner"], "owner_address": p["owner_addr"]}
    if cropped:
        for k in ["owner_name", "owner_address"]: e[k] = None  # classification row is still visible
    return e

def main():
    out, exp = {}, {}
    lic1 = make_license(LIC1); lic2 = make_license(LIC2)
    cr1 = make_cr(CR1); cr2 = make_cr(CR2)
    out["license_clean.png"] = (lic1, "license", lic_expected(LIC1), "clean")
    out["license2_nonpro_clean.png"] = (lic2, "license", lic_expected(LIC2), "clean")
    out["license_rotated90.jpg"] = (lic1.rotate(90, expand=True), "license", lic_expected(LIC1), "degraded")
    out["license_photo_skew.jpg"] = (on_background(lic1, angle=4), "license", lic_expected(LIC1), "degraded")
    out["license_blurry_lowcontrast.jpg"] = (lowq(lic2), "license", lic_expected(LIC2), "degraded")
    out["cr_clean.png"] = (cr1, "cr", cr_expected(CR1), "clean")
    out["cr2_motorcycle_clean.png"] = (cr2, "cr", cr_expected(CR2), "clean")
    out["cr_photo_skew.jpg"] = (on_background(cr1, angle=-3, bg=(90, 90, 95)), "cr", cr_expected(CR1), "degraded")
    out["cr_cropped_missing_owner.jpg"] = (make_cr(CR1, H=1060), "cr", cr_expected(CR1, cropped=True), "degraded")
    out["cr_rotated180_blurry.jpg"] = (lowq(cr2, blur=1.2, contrast=0.7).rotate(180), "cr", cr_expected(CR2), "degraded")
    for name, (im, typ, e, kind) in out.items():
        path = os.path.join(HERE, name)
        if name.endswith(".jpg"): im.save(path, quality=82)
        else: im.save(path)
        exp[name] = {"type": typ, "kind": kind, "fields": e}
    with open(os.path.join(HERE, "expected.json"), "w") as f:
        json.dump(exp, f, indent=2)
    print("wrote", len(out), "samples")

if __name__ == "__main__":
    main()
