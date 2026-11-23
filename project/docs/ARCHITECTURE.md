# GRX Scan — Architecture (Prototype v0.2)

**License & CR Data Extraction & Encoding Assistant** · TEU, Naga City Police Office (PNP)

Core concept (unchanged): **take a document photo → extract the information → organize it into fields → verify/correct → produce encoding-ready data.**

---

## 1. Recommended architecture: privacy-first, browser-only

```
 ┌──────────────────────────── the officer's own phone / laptop browser ────────────────────────────┐
 │                                                                                                  │
 │  [1] Photo / Upload ──► [2] Preprocess ──► [3] OCR (Tesseract WASM) ──► [4] Detect doc type       │
 │      camera input        rotate, crop,        words + boxes +              keyword scoring        │
 │      or file             scale, gray,         confidence                   (License / CR / ?)     │
 │                          contrast, B/W                                                            │
 │                                         ▲ retry 90/270/180° and "enhanced" mode if quality is low │
 │                                                                                                  │
 │  [5] Field mapping (extractor for that document) ──► [6] Validation ──► [7] Review/Edit form      │
 │      label anchoring + column position + regex        format checks,       status chips           │
 │                                                       OCR confidence,                             │
 │                                                       cross-checks                                │
 │                                                                                                  │
 │  [8] Output: section text (Copy All / per field) · .TXT · .CSV · .JSON      [Clear / Delete]      │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘
          Nothing is uploaded. No server. No database. No browser storage of personal data.
```

Why this is the simplest *practical* design:

| Need | Decision | Reason |
|---|---|---|
| Personal data (names, addresses, plates) | OCR **on the device** | Nothing leaves the phone/laptop → no data-privacy exposure, no third party, no server to secure. |
| Station Wi-Fi/data is unreliable | **Works offline** | OCR engine + English language model are bundled in `app/vendor/` (no CDN). |
| Ordinary personnel, any device | **Web page**, no install | Opens in Chrome/Edge (Windows), Chrome (Android), Safari (iPhone). |
| Easy to maintain / extend | **Plain HTML/CSS/JS, no build step** | Any IT-literate officer can edit a file and refresh. |
| More document types later | **One extractor file per document** | Drop in `extractors/or.js`, add one line to the registry. |

## 2. Technology stack

| Layer | Choice | Why |
|---|---|---|
| UI | HTML + CSS + vanilla JavaScript (ES modules) | No framework/build tooling to learn or break. |
| OCR | **Tesseract.js 5.1.1** (Tesseract 5 LSTM compiled to WebAssembly), `eng` "best_int" model | Mature open-source OCR, runs in the browser, free, offline. |
| Image processing | Own pure-JS functions on canvas `ImageData` (`core/image.js`) | Small, no OpenCV.js (≈8 MB) needed for phase 1. |
| Field mapping | Own layout engine (`core/layout.js`) + declarative extractors | Understands *where* a value is relative to its printed label. |
| Offline / Home Screen | Web App Manifest + Service Worker | Installs like an app over HTTPS/localhost. |
| Tests | Node.js + the **same** modules + tesseract.js for Node, `jimp` to decode images, `puppeteer-core` + Chrome for UI smoke tests | Proves the exact browser code works. |
| Launchers | `start-windows.bat` (Python `http.server`, PowerShell fallback `serve.ps1`), `start-phone-wifi.bat`, `start-mac-linux.sh` | Browsers block OCR workers from `file://`. |

Vendored engine files (`app/vendor/`, ≈11 MB): `tesseract/tesseract.min.js`, `tesseract/worker.min.js`,
`core/tesseract-core-simd-lstm.wasm.js` (fast, modern CPUs) and `core/tesseract-core-lstm.wasm.js` (fallback for
devices without WASM SIMD, e.g. older iPhones), `lang/eng.traineddata.gz`. Tesseract.js picks the right core automatically.
(The legacy, non-LSTM cores are omitted on purpose — we only use the LSTM engine — to keep the package small.)

## 3. How OCR and field extraction work

1. **Load** — `createImageBitmap(file, {imageOrientation:'from-image'})` applies the phone's EXIF rotation. Huge photos are capped at 3000 px.
2. **Manual fixes (optional)** — Rotate ⟲/⟳ buttons and a drag-to-crop box.
3. **Preprocess** (`core/image.js → preprocess`) — scale long side to ~2000 px, grayscale (luminance blended with min-channel so red/blue ink stays dark), 1–99 % contrast stretch. "Enhanced" mode adds sharpen + Sauvola adaptive threshold (shadows, blur).
4. **OCR** — Tesseract page-segmentation mode 3, `rotateAuto` (small skew is straightened), returns every word with its **bounding box** and **confidence**.
5. **Orientation & quality retry** (`core/pipeline.js`) — quality = mean confidence × word count factor + document-keyword score, multiplied down if most words are taller than wide (sideways page). If the first pass is weak, it retries at 90°, 270°, 180°, then in enhanced mode, and keeps the best.
6. **Document detection** — each extractor scores the text against weighted keywords (e.g. "DRIVER'S LICENSE", "Agency Code", license-number pattern vs. "CERTIFICATE OF REGISTRATION", "MV File", "Piston Displacement", MV-file pattern). Best score ≥ 0.20 wins; otherwise *Unknown* and the user is told to pick the type. The user can always force License or CR.
7. **Field mapping** (`core/layout.js`, `extractors/base.js`) — for every field:
   - find its printed **label** among the OCR words (fuzzy: "Helght(m)" still matches "Height(m)"; short labels like "Sex", "Make" must match exactly; when labels overlap the closer/longer one wins, so "Expiration Date" is not read as "Date");
   - read the value **to the right** of the label ("Plate No.: ABC 1234") or **below it in the same column**, bounded by the next label to the right and the next label below (grid layouts of the LTO card and CR);
   - multi-line fields (Address, Conditions) take following lines until a gap or the next label.
8. **Validation** (`core/formats.js`) — strict formats get validated and normalized:
   license no. `A00-00-000000`, PH plates (`ABC 1234`, `ABC 123`, `123 ABC`, `1234 AB`, temporary `1234-1234567`),
   MV File No. (15 digits → `0000-00000000000`), VIN (17 chars, no I/O/Q), dates (→ "January 15, 1990"), year model,
   blood type, DL codes, restrictions, numbers. **Look-alike fixes (O→0, I→1, S→5, B→8, Al→A1 …) are applied only
   inside strict-format fields, and every fixed value is marked [VERIFY].** Names, engine and chassis numbers are never "auto-corrected".
9. **Status per field**

   | Status | Meaning |
   |---|---|
   | **OK** | Label found, value has the expected format, every word ≥ 80 % OCR confidence. |
   | **[VERIFY]** | Low confidence, format mismatch, auto-corrected look-alikes, extra characters trimmed, ambiguous name split, or conflicting data (e.g. expiry not on birthday, VIN ≠ chassis). |
   | **[NOT READABLE]** | Label found but the value is missing or garbled. The garbled text is shown in the note, the field is left empty. |
   | **[NOT FOUND]** | Label not on the image (cut off, covered, or not printed on this version of the document). Value left empty — **never invented**. |
   | **EDITED** | Corrected/typed by the user (treated as confirmed; no marker in output). |

10. **Messages** — plain instructions: "License number could not be read. Retake the photo with better lighting…",
    "CR appears partially cut off or covered. Please upload a photo of the complete document. (Not found: Registered Owner, Address.)",
    "N fields need verification…", "License appears EXPIRED…".
11. **Output** — the encoding text block (same layout as the TEU sample), per-field copy buttons, Copy All, .TXT, .CSV (one header row + one value row, opens in Excel), .JSON. Markers like `[VERIFY]` stay in the copied text so unchecked values are never mistaken for confirmed ones.

## 4. License vs CR handling

| | Driver's License (`extractors/license.js`) | Certificate of Registration (`extractors/cr.js`) |
|---|---|---|
| Layout | Card: rows of small labels with values underneath (Nationality / Sex / Date of Birth …) | Form: grid of boxes, label at top-left of each box, value below (some CRs print "Label: value") |
| Main block (output order) | License No., Name, Date of Birth, Address, Classification, Restrictions **or** DL Codes, Conditions, Expiration | Plate No., MV File No., Engine No., Chassis No., VIN, Make, Model/Series, Year Model, Vehicle Type (Denomination), Body Type, Color, Fuel, Registered Owner, Address |
| Additional details | Last/First/Middle name (split from "LAST, FIRST MIDDLE"), Nationality, Sex, Weight, Height, Agency Code, Blood Type, Eye Color | CR No., CR Date, Piston Displacement, No. of Cylinders, Gross Wt., Net Wt., Net Capacity, Classification |
| Special rules | Classification only if printed in the title (new cards don't print it → NOT FOUND with explanation). New cards = DL Codes, old cards = Restrictions; the absent one is hidden from the output. Expiry checked against birthday; expired licenses flagged. Name split with 3+ given names → VERIFY. | VIN only from an explicit "VIN" label; if absent but the Chassis No. is VIN-shaped, a note says so (no silent copying). Owner names with digits → VERIFY. Missing owner/address → "cut off" message. |

## 5. Folder structure

```
project-extractor/
├─ start-windows.bat         ← double-click on Windows (opens http://localhost:8765)
├─ start-phone-wifi.bat      ← lets a phone on the same Wi-Fi open the app from the laptop
├─ serve.ps1                 ← no-Python fallback server (PowerShell)
├─ start-mac-linux.sh
├─ README.md                 ← plain-language testing guide (Windows, iPhone, Android)
├─ app/                      ← THE APP (copy this folder anywhere; works offline)
│  ├─ index.html  manifest.webmanifest  sw.js  icons/
│  ├─ css/style.css
│  ├─ js/app.js              ← UI controller (steps 1-5, edit, copy, export, clear)
│  ├─ js/file-warning.js     ← explains the launcher if opened by double-click
│  ├─ js/core/
│  │  ├─ image.js            ← rotate, crop, resize, grayscale, contrast, sharpen, adaptive threshold
│  │  ├─ ocr-browser.js      ← Tesseract.js worker using local vendor files
│  │  ├─ pipeline.js         ← preprocess → OCR (+rotation retry) → detect → extract → validate
│  │  ├─ layout.js           ← label finding + right/below value reading using word boxes
│  │  ├─ formats.js          ← validators/normalizers (plate, license no., MV file, VIN, dates…)
│  │  ├─ validate.js         ← user messages
│  │  ├─ status.js           ← OK / VERIFY / NOT READABLE / NOT FOUND / EDITED
│  │  ├─ output.js           ← text, CSV, JSON
│  │  └─ text.js             ← fuzzy matching helpers
│  ├─ js/extractors/
│  │  ├─ registry.js         ← list of document types (add new ones here)
│  │  ├─ base.js             ← generic extraction engine
│  │  ├─ license.js          ← Driver's License definition
│  │  └─ cr.js               ← CR definition
│  └─ vendor/                ← Tesseract.js, WASM core, English model (offline)
├─ samples/                  ← SYNTHETIC test images (clearly marked FICTITIOUS) + expected.json + generator
├─ tests/
│  ├─ unit-tests.mjs         ← extractors on hand-written LTO-style OCR text fixtures + validators
│  ├─ run-tests.mjs          ← full pipeline on sample images, per-field accuracy
│  ├─ smoke-browser.mjs      ← headless Chrome: desktop + Android Pixel viewport, screenshot
│  ├─ offline-test.mjs       ← service-worker offline reload + extraction with network OFF
│  ├─ filetest.mjs           ← checks file:// behaviour
│  ├─ debug-ocr.mjs          ← prints OCR words + boxes (for tuning a new extractor)
│  └─ fixtures/*.txt
└─ docs/ARCHITECTURE.md
```

## 6. How to add a new document type (e.g. Official Receipt, TOP/citation ticket)

1. Copy `app/js/extractors/cr.js` to `app/js/extractors/or.js`.
2. Change `id`, `label`, `sectionTitles`, the `detect()` keywords, and the `fields` list. Each field is just:
   ```js
   { key: 'or_no', label: 'O.R. No.', labels: ['O.R. No.', 'Official Receipt No.'], format: F.text }
   // options: section:'extra', multiline:true, maxLines:2, where:'right'|'below', labelOpts:{exact:true},
   //          optional:true, fallback:(ocr)=>({value}) for pattern search when the label is unreadable
   ```
3. Add it to `EXTRACTORS` in `registry.js` and a radio button in `index.html` (step 2).
4. Add sample images + `expected.json` entries (or text fixtures) and run `npm test`. Use `node tests/debug-ocr.mjs <image>` to see what the OCR reads and where.
No change to the pipeline, UI rendering or output is needed — they are generic.

## 7. Privacy design

- Image decoded into memory only; **never uploaded**, never written to disk, never put in `localStorage`/IndexedDB (`cacheMethod:'none'` for Tesseract).
- A Content-Security-Policy in `index.html` blocks connections to any other site; the smoke test also blocks and counts external requests (result: **0**).
- **Clear / Delete** (top bar and after export) wipes the image, the fields, the output box and terminates the OCR worker (its memory is released). Data also disappears when the tab is closed.
- The service worker caches **only the app's own files**, never photos or results.
- Exports (.txt/.csv/.json) are created only when the user presses a button and go to the user's own Downloads — they are then official records and fall under the unit's normal records-handling rules.
- Scope: encoding assistance from a document physically presented. It does not connect to LTO/LTMS or any government database.

## 8. Known limitations (honest)

- **Tested only on synthetic images.** Real LTO cards have holographic overlays, guilloche backgrounds, glare and wear; real CRs vary by year/printer and are often folded, stamped or faded. Expect lower accuracy and more [VERIFY] flags until tuned with real photos.
- Labels/positions were modelled on the common 2017+ PVC license and the standard CR layout; unusual versions may need label aliases added to `license.js` / `cr.js`.
- Automatic edge detection needs some contrast between the document and the surface. On a very dark photo where a dark card header blends into a dark table, the outline can cut off the top of the card (the name row) — drag the handles or untick Auto-straighten. Very strong glare can still wipe out a value (shown as VERIFY / NOT READABLE, never guessed).
- Weight/Height labels are tiny; when the label itself is unreadable, the number right after the birth date on that row is offered as VERIFY.
- **The real-card fixes were tuned on fictitious look-alike samples.** No real card or personal data is stored in this project or its tests.
- Tesseract confuses similar shapes (J/I, 1/I, 0/O) — that is why strict-format fields and confidence flags exist. Free-text fields (engine/chassis numbers) cannot be auto-checked → always compare.
- Clipboard: on `http://<laptop-IP>` (phone over Wi-Fi) the modern clipboard API is unavailable; a fallback copy method is used, which works in current Chrome/Safari, but if it fails, long-press the output box → Select All → Copy.
- Offline "Add to Home Screen" with service worker needs **HTTPS or localhost**; it does not activate when the phone opens the laptop's `http://192.168.x.x` address.
- Classification (Professional/Non-Professional) is not printed on new cards; it is left NOT FOUND rather than guessed from DL codes.
- HEIC photos open in Safari (iPhone) but may not open in Chrome on Windows; use JPG.

## 8b. Phase 2 (v0.2) — what was added

| Area | Module | How it works |
|---|---|---|
| Document edges | `core/quad.js` | Pure JS (no OpenCV). (A) k-means of the image border colours → background mask (shadow-tolerant) → largest non-background region → hole fill → convex hull → reduced to 4 corners → refined by fitting lines to the edges. (B) if A fails (e.g. card on white paper): Sobel edges → largest enclosed region. A quad is used only if its confidence ≥ 0.6, otherwise the whole image. |
| Perspective | `core/quad.js` `warpQuad` | 4-point homography, bilinear sampling, output size from the quad's side lengths (max 2400 px). |
| Corner UI | `app.js` | Outline + 4 draggable handles on the preview (pointer events, works with touch). Auto-straighten toggle (default on). |
| Row/column split | `core/layout.js` | Word boxes are de-skewed (median line slope) before matching; "right of label" values must sit on the label's own text line; a gap > 1.8× word height is a column break; "below label" values are limited to the label's column. |
| Field validators | `core/formats.js` | Address rejects date/sex/weight-like rows; DL codes accept `A, A1, B, B1, B2`, AT/MT, NONE; Conditions cut at the signature block. |
| Signature block | `extractors/license.js` | Lines with "Assistant Secretary", "LTO Chief", "Signature of…", and words from "ATTY." onward are removed before matching. |
| Targeted re-read | `core/refine.js` | For strict fields still VERIFY/NOT READABLE: crop the value area, upscale, read 3 variants (contrast, flattened+Otsu, Sauvola) with Tesseract PSM 7 + character whitelist. OK only if ≥2 variants agree with ≥85 confidence; otherwise VERIFY with a note. |
| Tests | `tests/quad-tests.mjs`, `samples/generate_samples_hard.py` | 9 hard synthetic samples (perspective on wood, clutter, glare, guilloche, motion blur, low light, new-style LTO layout, 10-year license, old CR layout) with known corners; tilt regression fixture for the new-style card. |

## 9. Phase-3 roadmap (remaining)

1. **Real-sample tuning**: collect 20–30 consenting/redacted real License and CR photos, add them to the test set, tune label aliases and thresholds.
2. ~~Automatic document boundary + perspective correction~~ — done in v0.2 (pure JS).
3. **Official Receipt (OR) extractor**, then TOP/citation ticket, then blotter/incident forms — same framework.
4. ~~Field-specific OCR passes~~ — done in v0.2 (`refine.js`); extend to more fields after real-photo tuning.
5. **Output templates** that match specific TEU/PNP forms (e.g. column order of the unit's Excel log), one-click "copy as row".
6. **Secure HTTPS hosting** of the static files (still on-device OCR) so phones can install it without the laptop; requires command approval of the hosting location.
7. **Optional AI-vision mode** (cloud model reading the photo) only with explicit approval, data-privacy review (RA 10173) and a clear on-screen switch — **off by default**, because it sends images to a third party.
