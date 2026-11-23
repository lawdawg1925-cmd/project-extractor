#!/usr/bin/env python3
"""Synthetic, clearly FICTITIOUS CR in the revised LTO Form No. 3 (December 2020) grid layout:
4-column grid, Field Office / Office Code / Date in the header, CR No. printed at the bottom, N/A boxes,
a blank Remarks box and a signature block that must be ignored. All names/numbers are invented.
Adds its entries to expected.json (existing entries are kept)."""
import json, os, random
from PIL import Image, ImageDraw
import generate_samples as G

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(11)
P = {
    "field_office": "SAN PABLO DISTRICT OFFICE", "office_code": "0412", "date": "2023/06/30", "cr_no": "0012345678",
    "plate_no": "NBC 4321", "engine_no": "2NR7654321", "chassis_no": "PA1BB3HE0P1234567", "vin": "N/A",
    "mv_file_no": "0412-00000765432", "vehicle_type": "CAR", "vehicle_category": "M1", "make": "TOYOTA",
    "passenger_capacity": "5", "color": "PEARL WHITE", "fuel": "GASOLINE", "classification": "PRIVATE",
    "body_type": "SEDAN", "series": "VIOS 1.3 XLE", "gross_wt": "1550", "net_wt": "1075",
    "year_model": "2023", "year_rebuilt": "N/A", "piston_displacement": "1329", "max_power": "N/A",
    "owner_name": "DELA CRUZ, ROSA MERCADO", "owner_address": "12 RIZAL AVENUE, POBLACION, SAN PABLO CITY, LAGUNA",
    "encumbered_to": "N/A", "or_no": "000000301234567", "or_date": "2023/06/30", "amount": "PHP 3,210.50",
}
GRID = [
    [("PLATE NO.", "plate_no"), ("ENGINE NO.", "engine_no"), ("CHASSIS NO.", "chassis_no"), ("VIN", "vin")],
    [("MV FILE NO.", "mv_file_no"), ("VEHICLE TYPE", "vehicle_type"), ("VEHICLE CATEGORY", "vehicle_category"), ("MAKE/BRAND", "make")],
    [("PASSENGER CAPACITY", "passenger_capacity"), ("COLOR", "color"), ("TYPE OF FUEL", "fuel"), ("CLASSIFICATION", "classification")],
    [("BODY TYPE", "body_type"), ("SERIES", "series"), ("GROSS WEIGHT", "gross_wt"), ("NET WEIGHT", "net_wt")],
    [("YEAR MODEL", "year_model"), ("YEAR REBUILT", "year_rebuilt"), ("PISTON DISPLACEMENT", "piston_displacement"), ("MAX POWER (kW)", "max_power")],
]

def make_cr_new(p):
    W, H = 2100, 2050
    img = G.security_bg(W, H, (246, 248, 240), (236, 242, 246))
    d = ImageDraw.Draw(img)
    f = G.font
    d.text((W - 60, 40), "LTO Form No.3 (Revised December 2020)", font=f(22), fill=(60, 80, 60), anchor="ra")
    d.text((W // 2, 70), "REPUBLIC OF THE PHILIPPINES", font=f(30, True), fill=(30, 60, 30), anchor="mm")
    d.text((W // 2, 108), "DEPARTMENT OF TRANSPORTATION", font=f(26), fill=(30, 60, 30), anchor="mm")
    d.text((W // 2, 146), "LAND TRANSPORTATION OFFICE", font=f(32, True), fill=(30, 60, 30), anchor="mm")
    d.text((80, 190), "Field Office", font=f(24), fill=(60, 80, 60)); d.text((260, 184), p["field_office"], font=f(32, True), fill=(10, 10, 10))
    d.text((80, 236), "Office Code", font=f(24), fill=(60, 80, 60)); d.text((260, 230), p["office_code"], font=f(32, True), fill=(10, 10, 10))
    d.text((80, 282), "Date", font=f(24), fill=(60, 80, 60)); d.text((260, 276), p["date"].replace("2023/06/30", "06/30/2023"), font=f(32, True), fill=(10, 10, 10))
    d.text((W // 2, 350), "CERTIFICATE OF REGISTRATION", font=f(48, True), fill=(10, 40, 10), anchor="mm")
    top, rh, left, right = 400, 130, 60, W - 60
    y = top
    def box(x0, x1, lab, val):
        d.rectangle([x0, y, x1, y + rh], outline=(70, 90, 70), width=3)
        d.text((x0 + 14, y + 10), lab, font=f(22), fill=(60, 80, 60))
        if val: d.text((x0 + 14, y + 56), val, font=f(36, True), fill=(10, 10, 10))
    cw = (right - left) / 4
    for row in GRID:
        for c, (lab, k) in enumerate(row):
            box(left + c * cw, left + (c + 1) * cw, lab, p[k])
        y += rh
    for lab, k in [("COMPLETE OWNER'S NAME", "owner_name"), ("COMPLETE ADDRESS", "owner_address"), ("ENCUMBERED TO", "encumbered_to")]:
        box(left, right, lab, p[k]); y += rh
    box(left, left + cw, "DETAILS OF FIRST REGISTRATION", "")
    box(left + cw, left + 2 * cw, "O.R. NO.", p["or_no"])
    box(left + 2 * cw, left + 3 * cw, "O.R. DATE", p["or_date"].replace("2023/06/30", "06/30/2023"))
    box(left + 3 * cw, right, "AMOUNT", p["amount"]); y += rh
    box(left, right, "REMARKS", ""); y += rh
    d.text((left, y + 20), "This is certifying that the motor vehicle described herein is duly registered. This certificate is VALID only", font=f(20), fill=(40, 40, 40))
    d.text((left, y + 48), "when signed by authorized LTO Officials, properly sealed and accompanied by Official Receipt.", font=f(20), fill=(40, 40, 40))
    d.text((left, y + 110), "REGISTRANT'S SIGNATURE", font=f(22, True), fill=(40, 40, 40))
    d.text((1250, y + 90), "ANA R. LOPEZ", font=f(30, True), fill=(20, 20, 60))
    d.text((1250, y + 128), "CHIEF OF OFFICE", font=f(22), fill=(40, 40, 40))
    d.text((1250, y + 156), "Signature/Date", font=f(20), fill=(40, 40, 40))
    d.text((left, y + 200), "CR No.", font=f(26), fill=(60, 80, 60)); d.text((left + 110, y + 192), p["cr_no"], font=f(38, True), fill=(160, 20, 20))
    return G.watermark(img)

def expected(p):
    e = {k: p[k] for k in ["mv_file_no", "plate_no", "engine_no", "chassis_no", "vin", "vehicle_type", "vehicle_category",
                           "piston_displacement", "max_power", "fuel", "make", "series", "body_type", "color", "classification",
                           "passenger_capacity", "year_model", "year_rebuilt", "gross_wt", "net_wt", "owner_name", "owner_address",
                           "encumbered_to", "or_no", "or_date", "amount", "cr_no", "field_office", "office_code"]}
    e["date_registered"] = p["date"]
    e["remarks"] = None
    return e

def main():
    path = os.path.join(HERE, "expected.json")
    exp = json.load(open(path))
    doc = make_cr_new(P)
    doc.save(os.path.join(HERE, "cr_new_layout_clean.png"))
    exp["cr_new_layout_clean.png"] = {"type": "cr", "kind": "clean", "fields": expected(P)}
    G.on_background(doc, angle=-2.5, bg=(95, 90, 85)).save(os.path.join(HERE, "cr_new_layout_skew.jpg"), quality=85)
    exp["cr_new_layout_skew.jpg"] = {"type": "cr", "kind": "degraded", "fields": expected(P)}
    json.dump(exp, open(path, "w"), indent=2)
    print("wrote 2 new-layout CR samples")

if __name__ == "__main__":
    main()
