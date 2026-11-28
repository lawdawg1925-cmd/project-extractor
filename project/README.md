# GRX Scan — License & CR Data Extractor (Prototype v0.2)
Traffic Law Enforcement Unit, Naga City Police Office. Formerly "Project Extractor". Live app: https://lawdawg1925-cmd.github.io/project-extractor/

**About the name:** GRX stands for *Government Records Extraction*: the tool extracts data from government-issued records (Driver's License, Certificate of Registration, and later other documents) into encoding-ready fields that personnel verify before use. It also carries the initials of its developer, PLTCOL Arkhemedes C. Garcia, TLEU, NCPO.

**Data Extraction & Encoding Assistant** for the Traffic Enforcement Unit, Naga City Police Office (PNP).

Take a photo of a **Driver's License** or **Certificate of Registration (CR)** → the tool reads it →
puts the information into the right fields → you check/correct → **Copy All** and paste into your form, report or Excel.

> 🔒 **Everything happens on your own device.** The photo is never uploaded, nothing is saved,
> and it works **without internet**. Press **Clear / Delete** when done.

### New: license fields by card position, Huawei / low-memory phone fixes, faster CR (cache grx-scan-v9)
- **License fields read by their place on the card.** On the busy card background (pattern, hologram, LTO seal) small
  labels are often lost. The labels that *were* read now locate the whole card layout, and each missing or doubtful value
  (Expiration Date, Agency Code, Eyes Color, DL Codes, Height, Address, Name…) is re-read from its printed position.
  Such values are always **[VERIFY]**, must pass the field's format check, and need agreeing readings.
  The embossed Expiration Date is checked against the birthday rule (a license expires on the holder's birthday): an
  impossible month such as "13" is only taken as the birth month when the day matches; the note says so. A stray "Q"
  from the LTO seal next to the name (e.g. "SANTOSQ") is dropped when another reading shows the name without it.
- **Signatory ignored on newer cards too:** "EDGAR C. GALVANTE / Assistant Secretary" (like "ATTY. VIGOR D. MENDOZA II") is never copied.
- **Huawei / low-memory phones:** big camera photos (12–50 MP) are opened straight at a safe size (no crash or blank
  picture), the reading engine falls back to its plain build if the faster one fails, and every step has a time limit.
  A problem now shows a red **"Scan failed: …"** box with **↻ Try again** and a *Details* line (browser, memory, photo size) to report.
  If the phone closes the page while the camera is open, the app says so on return (use the Camera app, then **🖼 Choose Image**).
- **Faster CR reading** on weak phones (no needless rotation tries; noisy security-pattern boxes are read once).
- The app opens faster on a weak signal (engine files come from the phone's offline copy).

### New: better reading of photos from low-end phone cameras (cache grx-scan-v7)
- **Dim, soft or low-resolution photos** are cleaned up on the phone before reading (enlarged, noise removed, lighting
  evened out, letters sharpened). Sharp photos are read exactly as before.
- **CR boxes are found even when the ruled lines are faint or broken**, and when the small printed labels are too blurry
  to read, the CR is recognised by its **box layout**; values taken by position are always marked **[VERIFY]**.
- **Photo check:** after choosing a photo, a yellow note warns if it is too dark or the document is too small, with a
  retake tip (you can still extract).
- Several readings of a poor photo are combined field by field; readings that disagree stay [VERIFY].

### New: CR reader rebuilt (box-by-box, both CR layouts)
- **Both CR layouts:** the old *LTO Form No. 3* and the new *Form No. 3 (Revised December 2020)* — the layout is detected
  and fields that are not printed on that layout are hidden.
- **Locks onto the ruled CR table** and reads it box by box, so a value never leaks into the next box. Everything below the
  table — the legal NOTE/footer, the signatory and signature block, stamps and an OFFICIAL RECEIPT printed underneath — is ignored.
- **Field order follows the form labels.** O.R. No., O.R. Date and Amount are grouped under *Details of First Registration*;
  CR No., CR Date, Field Office and Office Code are in the *Other* section. CR No. must be numeric ("VALID ONLY WHEN SIGNED" is never taken).
- **Checked against known lists / formats** (fuel, body type, denomination, years, weights, VIN rules). Any correction is marked VERIFY;
  engine and chassis numbers stay VERIFY unless every reading agrees. A printed **N/A** is kept as `N/A` (OK); an empty box is NOT FOUND.
- Text, CSV and JSON exports use the same labels, grouping and order (JSON also states the detected `form_layout`).

### New in v0.2 (phase 2)
- **Automatic document edges + straightening.** After you take/choose a photo, a yellow outline marks the card/CR edges and the
  photo is straightened (perspective-corrected) before reading. If the outline is wrong, drag the round corner handles onto
  the document corners — optional. Untick **Auto-straighten document** to read the whole photo as-is. Crop and Rotate still work.
  In step 4, *"Show the straightened image that was read"* lets you see exactly what was read.
- **New-style LTO card layout fixed:** Address no longer picks up the Sex / Date of Birth / Weight row; DL Codes such as
  `A, A1, B, B1, B2` (beside or below the label, with AT/MT or NONE) are read; Conditions no longer pick up the LTO signatory.
- **Signature block ignored:** the printed official's name ("ATTY. …"), "Assistant Secretary", "LTO Chief" are never copied into a field.
- **Tilted photos:** text rows are levelled before fields are matched, so values stay on their own row.
- **Second, targeted read** for strict-format fields (license no., dates, plate, MV file no., blood type, weight/height…):
  the value area is re-read 3 ways; it is marked OK only if the reads agree, otherwise VERIFY. Nothing is invented.
- Old CR layout and the 10-year license layout supported (extra label spellings).

The 5 steps on screen: **1 Take/Upload photo → 2 Document type (Auto) → 3 EXTRACT → 4 Review & correct → 5 Copy / Export.**

Field colours: 🟢 **OK** · 🟠 **VERIFY** (check this one) · 🔴 **NOT READABLE** (type it from the document) ·
⚪ **NOT FOUND** (not on the photo — nothing is guessed) · 🔵 **EDITED** (you corrected it).
Markers like `[VERIFY]` stay in the copied text until you fix the field, so unchecked data is never mistaken for confirmed data.

---

## A. Windows laptop (Chrome or Edge)

1. Unzip `project-extractor.zip` (right-click → **Extract All…**). Keep the folder together.
2. Double-click **`start-windows.bat`**. A black window opens and the browser opens at `http://localhost:8765`.
   - Keep the black window open while using the tool; close it to stop.
   - If the page shows "can't be reached", wait 2 seconds and press **F5**.
   - Works with Python installed; if not, it uses built-in Windows PowerShell automatically.
   - Do **not** just double-click `index.html` — browsers block the reading engine that way (the page will tell you).
3. Click **🖼 Choose Image** (or drag a photo onto the page, or paste a screenshot with **Ctrl+V**).
4. Leave **Auto-detect**, click **🔍 EXTRACT DATA** (2–6 seconds).
5. Check every orange/red field against the document and correct it. Click **📋 Copy All**, then paste (Ctrl+V) into your form/report.
   **⬇ .CSV** opens in Excel (one row); **.TXT** and **.JSON** are also available.
6. Click **🗑 Clear / Delete** when finished.

**Try it first with the samples:** in step 3 pick images from the `samples` folder (all fictitious, marked "SAMPLE – FICTITIOUS").

## B. Android phone (Chrome)

The **📷 Take Photo** button opens the **rear camera directly** on Android Chrome; **🖼 Choose Image** opens the Gallery/Files.
The phone does the reading itself — the photo never leaves the phone.

**Option 1 — open it from the laptop over the same Wi-Fi (easiest for testing)**
1. On the laptop, double-click **`start-phone-wifi.bat`**. It shows an address like `http://192.168.1.25:8765/index.html`.
   If Windows Firewall asks, allow **Private networks** only.
2. Phone and laptop on the **same Wi-Fi**. On the phone open **Chrome** and type that address.
3. Tap **📷 Take Photo** → take the photo → **✓ / OK** → **EXTRACT DATA** → review → **Copy All** → paste into your app/form.
   (If copy does not work on this connection: long-press the output box → **Select all** → **Copy**.)
   *Note: in this mode the laptop must be running; offline install (Add to Home screen) does not activate over a plain `http://192.168…` address.*

**Option 2 — run it on the phone itself, fully offline (no laptop)**
1. Copy the **`app`** folder to the phone (USB cable, or Google Drive → download → unzip with **Files by Google**).
2. Install a small local web-server app, for example **"Simple HTTP Server"** from the Play Store (or Termux: `pkg install python`, then `cd` into the folder and run `python -m http.server 8765`).
   Point it to the `app` folder and start it.
3. In Chrome open **`http://localhost:8765/index.html`**.
4. Chrome menu **⋮ → Add to Home screen / Install app**. Because it is `localhost`, the tool installs with an icon and then **works offline** (airplane mode is fine) — even with the server app stopped, after the first full load.

**Option 3 — secure web address (later, needs command approval)**
The same files can be put on any HTTPS static host (for example a unit-controlled site). Officers then open the link once, tap
**⋮ → Add to Home screen**, and it works offline afterwards. OCR still runs on the phone; only the program files are hosted, never photos or data.

## C. iPhone (Safari)

1. Use **Option 1** above (laptop `start-phone-wifi.bat`, same Wi-Fi), open the address in **Safari**.
2. Tap **📷 Take Photo** → **Take Photo** (or **Photo Library**) → **Use Photo** → **EXTRACT DATA** → review → **Copy All**.
3. If a photo will not open, set **Settings → Camera → Formats → Most Compatible** (JPG).
4. **Share → Add to Home Screen** gives an app icon; full offline use on iPhone needs the HTTPS option (Option 3).

## D. Testing with your own real License / CR photos

- Use **your own** license/CR or one from a colleague who agrees. Don't share the photos; the tool keeps nothing.
- Compare every extracted field with the document and note which fields were wrong or flagged — send those notes (not the photos) so the extractor can be tuned.
- Try both a careful photo and a "real-world" one (on the car hood, under the sun, at night with flash) to see how the warnings behave.

### Photo tips (phone or laptop)
- **Flat** document on a **plain, darker** surface; fill the frame (document edges close to the photo edges).
- **Even light**, no shadow from your hand/phone. Avoid flash glare on the plastic license — tilt slightly or turn flash off.
- Hold the phone **parallel** to the document (straight above, not at an angle). Tap the screen on the text to **focus**; wait until sharp.
- One document per photo. Unfold the CR completely; make sure the **bottom part (Owner, Address)** is in the photo.
- Android: clean the lens; use the normal 1× lens (not ultra-wide); avoid "beauty"/portrait modes. iPhone: avoid Live Photo blur.
- Sideways or upside-down photos are fine (auto-rotated) but straight is faster. Use **✂ Crop** to cut away background.
- If you see "blurry/low-contrast" or many orange fields → retake rather than typing everything.
- **Low-end phones:** go near a window or turn on the room light (flash only if there is no glare), fill the frame with the
  document, tap to focus and hold still for a second. A closer, sharper photo helps far more than a higher megapixel setting.
- **Huawei / phones with little memory:** close other apps first; if the page reloads after taking a photo, take it with the
  phone's **Camera** app and then use **🖼 Choose Image**. A camera setting of 8–13 MP is plenty (50 MP modes only slow things down).
  If a scan fails, tap **↻ Try again**; if it keeps failing, note the *Details* line and try Google Chrome.

## E. For developers / IT

```bash
npm install                      # tesseract.js, jimp, puppeteer-core (tests only — the app itself needs nothing)
npm test                         # unit tests (text fixtures) + full OCR pipeline on samples/ with per-field accuracy
npm run test:browser             # headless Chrome: desktop + Android Pixel viewport, offline test, file:// check
node tests/quad-tests.mjs        # document edge detection + perspective tests (corner error vs. known corners)
python3 samples/generate_samples.py && python3 samples/generate_samples_hard.py   # regenerate synthetic samples (hard = perspective, clutter, glare, low light, old CR, 10-year license)
node tests/live-check.mjs https://lawdawg1925-cmd.github.io/project-extractor/ samples/license_perspective_glare_clutter.jpg   # check the live site
node tests/debug-ocr.mjs samples/cr_clean.png   # see OCR words + positions
node tests/lowend-tests.mjs      # photo check / restoration / broken-rule boxes / CR box-layout fallback (synthetic)
node tests/card-tests.mjs        # license card-layout re-read, signatory, photo header / EXIF, engine error messages (synthetic)
node tests/huawei-test.mjs       # Huawei-like mobile: 12/48 MP + EXIF photos, no-SIMD engine, failures → "Scan failed" + retry
python3 tests/degrade.py /tmp/deg samples/*.png samples/*.jpg     # simulate low-end cameras (lowA..lowD)
node tests/bench.mjs samples/expected.json samples /tmp/deg /tmp/out.json && python3 tests/bench-report.py /tmp/out.json --fields
```
Architecture, how fields are mapped, how to add a new document type (OR, citation ticket…), privacy design,
limitations and roadmap: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

*Prototype — an encoding aid, not an official verification tool. Always check the output against the original document.
It does not connect to LTO/LTMS or any database.*
