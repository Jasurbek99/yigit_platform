# Document Generation

Auto-fills the export documents that the document team used to fill by hand from
the `Export_contracts` master sheet (2–3 hrs/day against a 13:00 deadline). P4
ships this **one document at a time** on a shared, document-agnostic framework.

**Shipped:** per-firm **Invoice** (RU/EN) + the **CT-1 / FITO / Customs** request
letters, and the truck-level **CMR** (RU/EN). Most documents download as `.docx`
(editable) and PDF; the **CMR is the exception** — it is an **xlsx print-overlay**
(see [[#CMR (road consignment note) — truck-level]]) so its native download is
`.xlsx`. Template layouts mirror the office Excel sheets: e.g. the Invoice renders
**two pages** — the invoice and the `Упаковочный лист` / `Packing List` (weights
only, no prices), matching the `InvoiceRU` / `InvoiceEN` sheets. Documents are
produced from the **Documents page** (`/documents`), a
truck-indexed workspace for the document team. Plus the **export contract** itself
(bilingual TK/RU agreement) — generated from the **Contract detail page** or from the
Sheet's contracts cell, not the Documents page (its scope is a `Contract`, not a truck).
See [[#Export contract (bilingual TK/RU agreement)]].

## How it works (end to end)

1. **Packing first.** A truck's whole-truck packing (gross / net / boxes /
   pallets) is settled in the Sheet — raw cells or an applied `PackingTemplate`.
   A **packing guard** (`missing_packing_on`) blocks *every* document until it is,
   returning `400 {error, missing_packing[]}`.
2. **Two document altitudes.** The **CMR is per-truck** (one `Shipment`, 1–3
   seller firms, one buyer) — built from the shipment. The **Invoice + letters are
   per-firm** — built from each firm's `ContractSale`.
3. **Documents page.** One row per truck; expand → the packet: the truck CMR
   button + a row per firm with that firm's Invoice/letters (driven by its
   `sale_id`). Backed by `GET /contracts/document-packets/`.
4. **Generate.** A button hits the relevant endpoint; the builder assembles a pure
   context dict, docxtpl fills the `.docx`, LibreOffice optionally makes a PDF, and
   the file downloads (`downloadFile` surfaces a `400`/`503` as a toast).

## Architecture

A six-piece core so adding the next document is "drop in a template + write one
context builder", never "wire a new endpoint stack".

| Piece | Where | Role |
|-------|-------|------|
| Template registry | `apps/contracts/document_templates/registry.py` | Plain dict (not a DB model) keyed by document key → template file, scope, language, context-builder, filename pattern, **`engine`** (`docx` \| `xlsx`). One entry per concrete document/variant. |
| Template files | `apps/contracts/document_templates/*.docx` / `*.xlsx` | docx: authored Word layouts with Jinja tags (static labels baked per language, only data as `{{ }}`), built by `build_templates.py`. xlsx: the CMR overlay sheets (geometry-preserving), built by `build_cmr_xlsx.py`. |
| Context builders | `apps/contracts/services/document_context.py` | Pure `(obj, lang) → dict`. docx builders return a Jinja context; the xlsx CMR builder (`build_cmr_overlay`) returns a `{cell: value}` map. Owns date/money/kg formatting, firm-language fallback, shipment-vs-invoice fallback. Unit-tested without rendering. |
| Render service | `apps/contracts/services/document_render.py` | `render_docx` (docxtpl→bytes); `render_xlsx` (openpyxl cell-fill→bytes); `render_pdf` (LibreOffice headless→bytes, any source ext); `generate(key, obj, fmt)` branches on `spec.engine`. |
| API views | `ContractSaleViewSet.document` (per-firm docs), `ShipmentCmrView` (truck CMR), `DocumentPacketListView` (page list) — all in `apps/contracts/views.py` | Thin; run the packing guard, then return the file as an attachment (or the packet list). |
| Highlight pass | `apps/contracts/services/document_highlight.py` | Renders every database-filled value red, boilerplate black. `wrap_context` sentinel-wraps values before the docxtpl render, `colorize` splits the runs afterwards. Touches **no template and no context builder**. |
| Layout adjustments | `apps/contracts/models/document_layout.py` + `document_render.apply_layout` | Per-document-type margin/font/line-spacing **adjustments** (deltas and a percentage, never absolutes), saved by the office instead of edited into the `.docx`. |
| Audit model | *(deferred)* | `GeneratedDocument` for the 13:00 board — not needed to generate. |

## Endpoints

All gated by the **`sale`** resource (admin / director / export_manager / **document_team**).
The document team has full operational access — `contract` CRUD and `sale` view/create/edit
(sale DELETE stays admin-only by design), plus the Contracts / Sales / Documents pages —
granted in `seed_permissions`.
`fmt` is `docx` (default) or `pdf`. **Named `fmt`, not `format`** — `format` is reserved by
DRF content negotiation. PDF needs LibreOffice on the server (`503` with a clear message when
absent; `.docx` is unaffected). Every generator first runs the **packing guard** →
`400 {error, missing_packing[]}` if the truck's packing isn't resolvable.

**Per-firm documents** (Invoice + letters) — from a `ContractSale`:
```
GET /api/v1/contracts/sales/{id}/document/?type=<key>&fmt=docx|pdf&place_loading=&tir_carnet=
```
- `type`: `invoice_ru` (default), `invoice_en`, `ct1_ru`, `fito_ru`, `customs_tk`.
  **Rejects `cmr_*`** (truck-scope) with `400`.
- `place_loading` (invoice) is an optional generate-time value; `tir_carnet` is ignored here.

**Truck CMR** — from a `Shipment`, all firms as senders:
```
GET /api/v1/contracts/shipments/{id}/cmr/?lang=ru|en&fmt=docx|pdf&place_loading=&tir_carnet=
```
- `place_loading` + `tir_carnet` (Uzbekistan transit) are optional generate-time values.

**Whole-packet ZIP** — the truck's entire packet in one download:
```
GET /api/v1/contracts/shipments/{id}/packet.zip?lang=ru|en&fmt=docx|pdf&place_loading=&tir_carnet=
```
- Bundles the truck CMR + **per firm** (each linked `ContractSale`): invoice + CT-1 + FITO
  + customs letters. `generate_packet_zip` in `document_render.py`. Whole packet fails as one
  (e.g. 503 if PDF requested but LibreOffice absent). Filename `Packet_<code>_<LANG>.zip`.

**Document packets** — one row per truck for the page:
```
GET /api/v1/contracts/document-packets/?date=&date_from=&date_to=&status=&firm=
```
- Floor to appear: non-archived / non-deleted trucks with **≥1 export firm** (a firm split),
  **regardless of status** (a draft qualifies). Missing buyer / country / driver / plate /
  packing do NOT hide the truck — they surface as `is_ready=false` + `missing_setup[]` so the
  team sees what to fill. Defaults to the active season. Returns `packing_complete` +
  `missing_packing[]`, `is_ready` + `missing_setup[]`, and `firms[]` (each with `sale_id`).

**Contract-link status** — how many of each truck's firms already have a live contract:
```
GET /api/v1/contracts/shipment-contract-status/?season=
```
- Returns `{"<shipment_id>": <linked_firm_count>}`; a truck with no live link is **absent**
  (absent = 0). Only the numerator travels — the caller (the Sheet) already holds each row's
  `firm_splits`, so the denominator has one source of truth.
- Excludes `status='void'` sales, matching `rollup_contract_totals()` — a cancelled firm share
  is not a contract. Season-scoped like every other list; `{}` during the close→open gap (D7).
- Exists because `export` may not import `contracts`: the Sheet's `firm_contracts` cell needs
  this to colour its icon and cannot annotate it onto its own payload. See
  [[shipment-sheet#Synthetic cells — `packing` and `firm_contracts` (icon states)]].

Response (files): `Content-Disposition: attachment`, e.g. `Invoice_93-26-DM-EXP_118_RU.docx`,
`CMR_0201045-25_RU.docx`.

## Data sources — the gross-net packing template

Header/firms from **Contract + ExportFirm/ImportFirm**. Packing comes from a single
**`PackingTemplate`** applied to the shipment (`Shipment.packing_template`) — one Excel
`gross net` row (whole truck + firm shares), picked *before loading*:

- **CMR** ← the template's whole-truck line directly. BRUT = gross **with** pallet, so
  `gross_without_pallet = gross_kg − pallet_weight_kg`. Falls back to the shipment's own
  weight fields when no template.
- **Invoice** (per firm) ← NET = the firm's own weight (`quantity_kg`, never the real
  `Shipment.weight_net`, ADR-023); gross/boxes/pallets are the firm's **explicit** packing on
  the sale (`ContractSale.gross_kg` …), copied from the template share on apply and editable
  per truck. Nothing is derived.
  - **Multi-line invoice:** a sale may carry explicit `ContractSaleLineItem` rows
    (product / qty / price) — entered in the sale modal — for different
    varieties/grades. When present, the invoice lists them (docxtpl row loop) and
    `total_sum` = their sum; the lines are validated to **break down** the sale
    (`Σ quantity_kg == quantity_kg`, `Σ amount == total_usd`) so quota/contract
    rollups stay correct. With no line items, the classic single tomato line
    renders from the sale's own fields.

Set from the **packing panel** (export Sheet `packing` row → popover): pick one template →
each firm's editable numbers + a live Σ-check + swap. Truck plate still comes from the
shipment. Catalog admin-managed (`/api/v1/export/packing-templates/`, seeded by
`seed_packing_templates`). See [[../reference/packing-template-model]].
Firm name/address/bank use the tri-lingual `*_ru`/`*_en`/`*_tk` columns selected
by language (ru→en→tk fallback). Product line: HS code `070200000`, localized
product name + packing.

**Number formatting is locale-aware:** RU uses space-thousands + comma-decimal
(`7 830,00`, `10 720`), EN keeps English (`7,830.00`, `10,720`). Dates are
`DD.MM.YYYY` in both.

## PDF dependency (server)

`.docx` needs only `docxtpl` (pip). **PDF requires LibreOffice headless.** It is
provisioned in `backend/Dockerfile` (`libreoffice-writer` **+ `libreoffice-calc`** +
`fonts-dejavu` / `fonts-liberation` / `fonts-noto-core` for Cyrillic/Latin glyphs),
so PDF works in the deployed container regardless of host OS — the runtime is
Debian, not the dev machine. **Calc is required for the CMR**, which is an `.xlsx`
overlay — Writer alone converts the `.docx` documents but cannot render xlsx→PDF,
so a Writer-only image makes the CMR PDF button error while invoice/letter PDFs
still work. The filled source is converted to PDF via a unique
`-env:UserInstallation` profile per call (avoids the shared-profile lock under
concurrency). Resolution order: `LIBREOFFICE_BIN` setting → `soffice`/`libreoffice`
on PATH.

**Local dev (Windows/macOS):** LibreOffice is usually absent, so PDF returns 503
and only `.docx` works — which is fine for development. To test PDF locally,
install LibreOffice and either add its `program/` dir to PATH or set
`LIBREOFFICE_BIN` (e.g. `C:\Program Files\LibreOffice\program\soffice.exe`).

## Red highlighting of filled values

Every value that came from the database prints **dark red (`C00000`)**; static
boilerplate stays black. A clerk checking a document before it is printed can see at a
glance what the system filled in — and a blank field becomes obvious. Ported from
sera-butce-web, whose print view marks the same values with a `.dyn` CSS class.

**On by default; `?highlight=0` gives an all-black copy** for the version that goes to
the customer or into a customs file. All four generating endpoints accept it, and the
download modals carry a checkbox (`documents.highlight`).

### How it works, and why not `RichText`

The obvious route — docxtpl's `RichText` — was tried and rejected. It only works with
the `{{r tag }}` prefix syntax, so every tag in all 8 templates would have to be
rewritten; and because `{{r }}` replaces the **entire run**, it discards the template's
bold/size/font, forcing the (currently pure) context builders to re-supply
presentation. With plain `{{ }}` it silently emits invalid OOXML — a `<w:r>` nested
inside a `<w:t>` — which python-docx parses without complaint, so the existing
`assertNotIn('{{', text)` smoke test would not catch it.

Instead:

1. `wrap_context` wraps each non-blank context string in the private-use sentinels
   `U+E000` / `U+E001`. Blank strings are left alone — a wrapped empty value would emit
   a stray red run, and an unwrapped blank stays falsy for any future `{% if %}`.
2. docxtpl renders as normal. Sentinels ride along inside the runs.
3. `colorize` walks every paragraph — body, table cells (recursively), and each
   section's header/footer — and replaces any sentinel-bearing run with black/red runs
   that are **deep copies of the original `<w:r>`**, so all run properties carry over.
   They are inserted in place via `addnext`; appending to the paragraph would move the
   text to the end.

The xlsx CMR overlay needs none of this: every cell the builder writes is a filled
value, so `render_xlsx` colours them directly.

**All 9 templates are covered, including the CMR** — colour moves nothing, and the run
split preserves the `rPr` that positions each line on the pre-printed form.

## Page-layout adjustments

`DocumentLayoutSetting` — one row per document type, shared by every user (the printed
form of a legal document should not differ between operators). Lets the office make a
contract fit one page without a developer editing the `.docx` and redeploying.

| Field | Range | Effect |
|-------|-------|--------|
| `font_scale_pct` | 80–120 | Multiplies **every run's** font size, snapped to the nearest half-point (Word's `<w:sz>` grid). |
| `line_spacing` | 1.00–2.00, nullable | Sets `styles['Normal']`. Effective everywhere — no shipped template sets `line_spacing` on a single paragraph. |
| `margin_*_delta_mm` | −10…+15 | Added to each section's existing margin, clamped at 0. |

### Why adjustments and not absolutes

* `contract_kz.docx` has **two sections with deliberately different top margins**
  (0.51cm on page 1 for the letterhead, 2.5cm after). One absolute knob would flatten
  that; a delta preserves the gap.
* An absolute base font size is nearly a no-op — most runs carry an explicit `<w:sz>`
  overriding the Normal style (713 of 879 runs in `contract_kz.docx`, 70 of 83 in
  `invoice_ru.docx`). Only a scale applied run-by-run moves the text, and it keeps each
  template's size hierarchy.

### Table reflow

`build_templates._col_widths` pins `autofit = False` with widths summing to exactly the
17.5cm text area; widen a margin and those tables would run off the page. So a
left/right delta also scales every fixed-width table — **by the table's own current
total**, not an assumed page width. `contract_kz`'s hand-authored tables legitimately
start *wider* than their section (18.89cm against 16.68cm), and squashing them to fit
would silently redesign a legal document. `autofit = True` tables are skipped; Word
reflows those itself.

The rescale runs **once per document, not per section** — `doc.tables` spans the whole
document, so doing it inside the section loop squared the ratio on `contract_kz`'s two
sections (0.8849 where 0.9402 was right). Covered by
`test_multi_section_document_scales_its_tables_only_once`; the single-section
`invoice_ru` case could not see it.

### Which levers actually work

| Lever | `invoice_*` / letters | `contract_kz` |
|-------|----------------------|---------------|
| Font scale | strong | **strongest** |
| Line spacing | strong | strong |
| Margins | strong | **weak** — the body table already renders past the margin |

The popover shows an inline note on the contract saying so, rather than letting staff
drag a slider that does nothing.

### Excluded: the four CMR keys

`cmr_ru`, `cmr_en`, `cmr_ru_docx`, `cmr_en_docx` are refused by
`registry.supports_layout()` and by the API (400). Their geometry registers onto the
pre-printed official form — the Word CMR's page margins are all zeros on a
non-standard 11918×16858 page, derived from the xlsx overlay so both formats land
every value in the same box.

### API

| Method | Route | Permission |
|--------|-------|-----------|
| `GET` | `/api/v1/contracts/document-layouts/` | `IsAuthenticated` — synthesises defaults for untouched keys, so the client always gets all six. |
| `PATCH` | `/api/v1/contracts/document-layouts/{document_key}/` | `DynamicResourcePermission`, **resource derived from the document's scope** — `contract_kz` → `contract`, everything else → `sale`. Upserts. Send the `version` you read; `409` if someone saved in between (ADR-0006). |

`document_render.layout_for()` reads the row on every generate and is **deliberately
uncached** — one indexed row from a six-row table is nothing next to a render that may
shell out to LibreOffice for 10–30s, and a staleness window would land squarely in the
one loop that matters (nudge a slider, re-download, look).

## Adding the next document (CMR, Pasport Sdelka, …)

1. Author the `.docx` template (Jinja-tagged) under `document_templates/`.
2. Add a `TemplateSpec` to `REGISTRY` (key, file, scope, language, builder path, filename pattern).
3. Write the context builder in `document_context.py` (pure).
4. For non-invoice scopes, add the scope's filename-fields extractor to `_FILENAME_FIELDS`
   in `document_render.py` and expose an `@action` on the matching viewset.

## Tests

`apps/contracts/tests/test_document_generation.py` — pure builder (formatting /
language / shipment fallback), RU+EN render smoke (asserts no leftover Jinja tags),
and the API endpoint (docx download, EN variant, 400 unknown type, 503 PDF-without-LibreOffice).

`HighlightRenderTest`, `DocumentLayoutRenderTest`, `DocumentLayoutModelTest` and
`DocumentLayoutEndpointTest` cover the two features above. Note the render classes are
`TestCase`, not `SimpleTestCase`: rendering now reads the document's saved layout row.

**The pre-existing assertions cannot detect either feature's failure mode** — `p.text`
/ `cell.text` discard every run property, and `assertNotIn('{{', text)` passes happily
on structurally corrupt OOXML. So the new tests assert at the XML level: no `<w:r>`
nested inside a `<w:t>` in **any** part of the zip, no sentinel survivors in any part,
and colour checked in **both** directions (a known value is red, a known label is not —
over-colouring is as wrong as under-colouring). Margin and font assertions allow for
Word's storage grids: `<w:pgMar>` is in twips (635 EMU), `<w:sz>` in whole half-points.

## Frontend

A per-sale **Documents** dropdown (`components/InvoiceDocumentsButton.tsx`) sits
in the action column of the contract **Faktura tab** (`ContractSalesTab`) and the
**all-sales list** (`ContractSaleList`). It offers Invoice / CMR in RU/EN as Word or
PDF (8 entries) and downloads via `utils/fileDownload.ts::downloadFile()`; the httpOnly
auth cookie rides the same-origin GET (same mechanism as the Boss report exports).
Labels are `documents.*` i18n keys (tk/ru/en).

**Shared pieces** (`CmrDocumentsButton`, `PacketZipButton` and `InvoiceDocumentsButton`
were ~90% identical before):

* `hooks/useDocumentDownload.ts` — spinner + server-error toast + an `ok` result, so a
  failed download leaves its modal open.
* `components/DocumentOptionsModal.tsx` — loading point, TIR carnet, the red-highlight
  checkbox, and (when the document is tunable) the layout gear. `applyDocumentOptions()`
  writes them onto the query string; red being the server default, only the **opt-out**
  travels, so every pre-existing URL renders exactly as before.
* `components/DocumentLayoutPopover.tsx` + `hooks/useDocumentLayouts.ts` — the layout
  sliders. Values mirror locally during a drag and save once on release
  (`onChangeComplete`), following `sheet/SheetRowStyleControls`. A `409` opens a
  `Modal.confirm` to overwrite.

The layout gear is mounted from the options modal (per-sale documents) and from
`ContractAgreementButton`'s own modal for `contract_kz`. It is **not** offered for the
CMR or the packet zip — the CMR's geometry is fixed by the pre-printed form.

**One deliberate UX change:** the CT-1 / FITO / customs letters used to download on a
single click. They now open the options modal too, because those are precisely the
copies that go to the customs and phytosanitary authorities and most need the
clean-copy toggle. One extra click.

## CMR (road consignment note) — truck-level

CMR is a per-**truck** document: one `Shipment` == one truck, which may carry 1–3
export firms (`firm_splits`) selling to a single buyer (`shipment.import_firm`).
So the CMR is `scope=shipment` (not invoice) — `build_cmr_context(shipment, …)`
aggregates **all** export firms on the truck into the single sender box
(`;`-joined — a bare newline won't line-break in a docx run), uses the one buyer
as consignee, whole-truck cargo/weights, and
references every invoice on the truck (`shipment.sales`). Computes
`gross_without_pallet = weight_gross − pallet_weight` (BRUT is gross WITH pallet).

Endpoint: **`GET /api/v1/contracts/shipments/{id}/cmr/?lang=ru|en&fmt=docx|pdf`**
(`ShipmentCmrView`, gated by the `sale` resource). It lives in `contracts` — not
an `export` ViewSet — because the builder is in `contracts`, which may import
`export` (never the reverse). The per-invoice `sales/{id}/document/` endpoint now
**rejects** `cmr_*` types (they are shipment-scope), so CMR is reachable only via
this truck endpoint.

The `forwarder` is auto-filled from the export firm(s). The `route` / border line
was dropped — the destination borders don't require it.

**The CMR is an XLSX print-overlay, not a docx.** The office prints truck data ON
TOP of the pre-printed official 24-box CMR form; the source `CMR RU` / `CMR EN`
Excel sheets carry the exact geometry (A4 @ 60% scale, column/row sizes, merges)
tuned to register on the paper. Reproducing that grid in python-docx is lossy by
construction, so the CMR keeps the Excel geometry:
- **Templates** `cmr_ru.xlsx` / `cmr_en.xlsx` — the source sheets stripped to
  fixed unit labels + geometry (data/formula/helper cells blanked). Rebuilt by
  `build_cmr_xlsx.py` from the operational workbook.
- **Builder** `build_cmr_overlay(shipment, lang, overrides)` returns a
  `{cell_coordinate: value}` map (reuses `build_cmr_context` for the figures, adds
  destination country / driver / plates). RU and EN use **different coordinate
  maps** (the two sheets sit data on slightly different rows/cols).
- **Engine** `TemplateSpec.engine='xlsx'` → `render_xlsx` fills cells by coordinate
  (openpyxl), preserving geometry untouched; PDF still goes through LibreOffice.
- Known simplification: multiple firms are joined into one sender box (matches
  single-firm trucks exactly; per-cell firm1/firm2 split is a future refinement).

**CMR outputs** (`?fmt=`), all carrying the same values in the same boxes:

| `fmt` | Output | Notes |
|-------|--------|-------|
| `docx` *(default)* | `.docx` Word form | **The office's own CMR form.** ~65 ms. Keys `cmr_ru_docx` / `cmr_en_docx`. |
| `pdf` | `.pdf` | Converted **from the Word form** via LibreOffice — the slow path (~6 s). |
| `xlsx` | `.xlsx` overlay | Spreadsheet overlay. **Not offered in the UI** (Word supersedes it) but still wired — re-add `'xlsx'` to `FORMATS` in `CmrDocumentsButton.tsx` to bring it back. |

PDF renders from the **Word** form, not the xlsx: converting the spreadsheet
would emit the older overlay layout rather than the office document.

The Word variant exists because LibreOffice **cannot** convert a spreadsheet to
Word (xlsx→docx is refused), so it needs its own template. Its source is the
office's **real Word CMR** (`data/CMR_RU_template.docx`) — a flat sequence of
positioned paragraphs (no tables) already laid out for the blank form.
`build_cmr_docx.py` keeps that document as the layout and only swaps each sample
value for a Jinja tag, leaving the fixed labels (`Брутто:` / `кг.` / `вес поддона`)
untouched; the EN variant reuses the same positions with the `CMR EN` sheet's
English wording. Both formats read one values function
(`build_cmr_overlay_values`) so they cannot drift.

The Word form has **two consignor blocks**, so the values function exposes
`sender1_*` / `sender2_*` per firm (3rd+ firm appended to slot 2) alongside the
joined `sender_name`. `driver_passport` and `truck_model` render **blank** —
`Shipment` has no passport/vehicle-model columns, so the crew completes those two
by hand (add the columns if they should be generated).

**Caveat:** a Word table *approximates* Excel's print registration — it is not
guaranteed identical. For printing onto the blank customs form the `.xlsx` is the
reference; the Word variant should be confirmed with a physical test print first.

**Generate-time inputs.** `place_loading` (invoice + CMR) and `tir_carnet` (CMR
only, Uzbekistan transit) are not stored on the invoice — they're chosen when the
document is generated and passed through as `?place_loading=&tir_carnet=` query
params to `generate(..., overrides)`. The frontend `InvoiceDocumentsButton` opens
a small modal for invoice/CMR downloads: `place_loading` is a dropdown from the
`core.LoadingLocation` list (`GET /core/loading-locations/`), `tir_carnet` a free
text field. Both optional → blank on the document when left empty. The CT-1 /
phyto / customs letters accept the `overrides` arg (uniform signature) but ignore
it and download immediately with no modal.

**Packing guard (poka-yoke).** No document — invoice, CMR, or letter — generates
until the truck's whole-truck packing is **resolvable**: `weight_gross`,
`weight_net`, `box_count`, `pallet_count`. Each field is satisfied by the raw
shipment cell **or** an applied `PackingTemplate` counterpart (`gross_kg` /
`net_kg` / `box_count` / `pallet_count`) — so a template-configured truck (which
links the template + per-firm sales but leaves the raw cells null) is NOT blocked.
See `REQUIRED_PACKING_FIELDS` / `missing_packing_on()` in `document_context.py`.
Both endpoints return **400** with `{error, missing_packing: [...]}` when a field
is unresolved (a shipment-less invoice fails all four). The frontend downloads via
`downloadFile()` (axios blob) so that 400 surfaces as a toast instead of dumping
JSON into a new tab; a successful call saves the file.

## Authority request letters (CT-1 / phyto / customs)

Three request letters, each **single-language** per its source form: CT-1
certificate-of-origin (`ct1_ru`), phytosanitary certificate (`fito_ru`), and the
customs-clearance ARZA (`customs_tk`, Turkmen). Builders `build_ct1_context` /
`build_fito_context` / `build_customs_context`; static addressee/boilerplate is
baked into each template (three dedicated builders in `build_templates.py`,
Times New Roman / A4), only named fields injected. `fito`/`customs` resolve the
destination country via `_country_name` (shipment → buyer-firm fallback).

Layouts mirror the office `letter CT1` / `fito` / `customs` sheets, so they carry
more than the addressee + one line:
- **CT-1** — sender + consignee (Отправитель / Грузополучатель) blocks and the
  Нетто / Брутто / Кол-во мест weights.
- **FITO** — the truck line (`1 автомашина: {plate}`) + sender/consignee blocks.
- **Customs (ARZA)** — a truck **table** (T/b · plate · product · boxes · gross)
  and the full four-paragraph legal boilerplate (gümrük Kodeksi articles, the
  finance-ministry order), with the generate-time `place_loading` inserted, plus
  the `Telekeçi` signature.

`_letter_figures(invoice)` supplies per-firm net/gross/boxes/plate (same rule as
the invoice line item). CT-1 still fills with no shipment link (weights fall back
to the invoice's own quantity).

## Export contract (bilingual TK/RU agreement)

The master sale agreement itself — a two-column Turkmen/Russian legal instrument
(the `NNN/YY-YGT-EXP` contracts). Unlike every other document it renders from a
**`Contract`** (`scope=contract`, key `contract_kz`), and unlike the per-language
invoice/CMR it holds **both languages in one `.docx`** (the source is a two-column
document). The template `contract_kz.docx` was cloned from a real signed contract
to preserve the exact legal layout/logo; only the variable fields became Jinja tags.

**Multi-country since 2026-08-28 — gated on a genitive-form map.** §4.1/§4.2 name the
**buyer country's** authorities ("Акт … выданным уполномоченным органом Казахстана" /
"Gazagystanyň gümrük gullugy"). Those were the template's only hardcoded "Kazakhstan"
(verified: a sweep for `РК` / `Алматы` / `Астана` / `KZT` found nothing else; the
`Туркменистана` in §4.3/§7 is the **seller's** law and stays fixed). They are now the
tags `{{ dest_country_gen_tk }}` / `{{ dest_country_gen_ru }}`.

The clause needs the country in the **genitive case**, but `Country` stores only the
nominative `name_tk` / `name_ru` and the declension is irregular in both languages —
so the forms come from a fixed ISO-code map, `_COUNTRY_GENITIVE` in
`services/document_context.py`:

| Code | TK | RU |
|------|----|----|
| `KZ` | Gazagystanyň | Казахстана |
| `KG` | Gyrgyzystanyň | Кыргызстана |
| `RU` | Russiýanyň | России |
| `TJ` | Täjigistanyň | Таджикистана |
| `UZ` | Özbegistanyň | Узбекистана |
| `BY` | Belarusyň | Беларуси |
| `AE` | BAE-niň | ОАЭ *(indeclinable)* |

**The map IS the gate.** A country absent from it has no verified declension, so the
endpoint **400s** (`country_template_supported()`), and the frontend button is disabled
with a tooltip. The frontend reads the server-owned boolean
**`contract_template_supported`** on the contract detail serializer — *not* a second
copy of the country list in TypeScript (`import_firm_country_code` stays, for display).
Adding a country = one row in `_COUNTRY_GENITIVE`; no migration, no template change.

> **Assumption on record (user-confirmed 2026-08-28):** the §4 clause wording is
> identical across destinations apart from the country name. It was verified against
> KZ contracts only — the first generated non-KZ contract should get a human read
> before it goes to a buyer. If some country needs different §4 text, that country
> needs its own template rather than a map row.

Endpoint (gated by the **`contract`** resource view permission — this one is NOT on
the `sale` resource, since it hangs off the Contract, not a truck):
```
GET /api/v1/contracts/contracts/{id}/agreement/?fmt=docx|pdf&buyer_director=&delivery_deadline=
```

**Data sources.** Financials/dates come from the `Contract`.
- **Seller** = `contract.export_firm`: bilingual name (**bare** — the template supplies
  the legal form `HJ` / `Хозяйственное общество`, so a trailing `H.J.`/`Х.Дж.` in the
  stored name is stripped), address, director (the leading `Директор`/`Direktor` title
  the template already prints is stripped), and the `bank_details_tk/ru` **blob**
  collapsed to one line (`_oneline` joins newlines with `; ` — a bare `\n` won't
  line-break in a docx run; the template's structured seller-bank lines were merged
  since ExportFirm stores only a blob).
- **Buyer** = `contract.import_firm`: the flat single-value fields the model has
  (`name_company` / `address` / `bank_details` **blob**, collapsed to one line the
  same way as the seller bank) shown in both language columns, plus the bilingual
  country name (the one buyer field that's genuinely per-language). The buyer's
  director name is the firm's **`contact_person`** ("Director's Full Name"); the
  generate-time `buyer_director` override only fills in when that's blank, and the
  modal **only asks for it when the firm has none** (`import_firm_has_director` on the
  detail serializer drives `askDirector`). (This is deliberately "fidelity A" — the
  seller was parametrized but the buyer reuses existing fields; adding structured
  bilingual buyer columns was considered and rejected as duplication.)
- **§2.6** ("delivery until") prints `Contract.start_date`; the generate-time
  `delivery_deadline` query param (`YYYY-MM-DD`) still overrides it per generation,
  and the modal leaves it blank by default. The contract **validity** date (§8.1)
  comes from `Contract.end_date`.
- **The header date** (`ş. Asgabat  <date>`, and the appendix `Контракт № … от <date>`)
  is `Contract.contract_date` — the date the document itself carries — falling back to
  `start_date` for contracts created before that field existed.
- **The unit price** (`{{ price }}`) is `Contract.price_per_kg`, falling back to
  `planned_amount_usd / planned_quantity_kg` for older rows.

**Amount in words.** The total is spelled out in both languages —
`services/amount_words.py` (`amount_words_ru` / `amount_words_tk`), hand-rolled (no
`num2words` dependency) for the bounded USD range, with RU thousands
gender/plural agreement and TK's dropped leading `bir` before `müň`/`ýüz`. Only the
whole-dollar part is spelled. Tested against the two real contract amounts in
`test_amount_words.py`.

**Dates.** RU is spelled (`30 июня 2026`); TK is **numeric** (`30.06.2026 ý.`) —
Turkmen ordinal-date morphology is applied inconsistently even in the source
contracts, so the unambiguous numeric form (idiomatic in TK official text) is used
rather than risk wrong grammar.

**Stamps.** The template is **unstamped by default** — the original signed contract
it was cloned from carried both parties' seals as embedded images, which were
stripped (image elements + media files removed) so a generated draft never shows
someone else's seal; seals are applied at signing. Passing **`?stamps=1`** stamps the
section-9 signature block with each firm's own uploaded seal + signature —
`ExportFirm.director_seal`/`director_signature` (seller) and
`ImportFirm.director_seal`/`director_signature` (buyer), uploaded on the firm's admin
page. The builder emits a `StampImage` marker (a deferred FieldFile ref, so builders
stay I/O-free) only when stamps are on **and** the firm has the image; `render_docx`
reads the bytes and turns it into a docxtpl `InlineImage` (an unreadable/missing file
degrades to blank, never breaks the doc). Placeholders `{{ seller_seal }}` /
`{{ seller_signature }}` / `{{ buyer_seal }}` / `{{ buyer_signature }}`.

Frontend: a **"Download contract"** button (`components/ContractAgreementButton.tsx`)
opens a modal for the director + deadline + format + a **"With stamps"** checkbox (off by
default), then downloads via `downloadFile()`. Labels `contracts.generate.*` (tk/ru/en).

Renamed from **"Generate contract"** on 2026-09-03. The `Contract` row already exists by the
time this button renders — it is created from the Sheet's contracts cell — and the tk label
read literally as "create contract" (`Şertnama döret`), contradicting that cell's green
"every firm has a contract" icon. Producing the .docx is a **stateless download**: nothing
records that it happened, so no icon can key off it (see
[[shipment-sheet#Synthetic cells — `packing` and `firm_contracts` (icon states)]]).

Two entry points, one component:
- the **Contract detail** header (`contract_template_supported` / `import_firm_director`
  come from `ContractDetailSerializer`);
- the **Sheet's contracts cell**, per resolved firm split, alongside a link to the contract
  page — see [[shipment-sheet]]. `ShipmentFirmContractsView` GET carries the same two
  buyer-level fields for it. Because that call site sits inside a dismiss-on-outside-click
  popover, the button reports its modal state through an optional `onOpenChange` prop so the
  popover can hold itself open; the contract page passes nothing and is unaffected. The template's placeholder schema is
documented in the standalone template under `data/contract_documents/` (the reusable
`{{placeholder}}` version).

## Documents page (packets endpoint)

The document team works **by truck**: one truck dispatches with a packet — the
truck-level CMR plus each firm's invoice/letters. `GET /api/v1/contracts/
document-packets/` (`DocumentPacketListView`, `DocumentPacketSerializer`) returns
one row per truck for the Documents page: `shipment_code`, `date`, route
(`country_name` / `city_name`), `buyer_name`, `status_code` / `status_display`,
`packing_complete` + `missing_packing[]`, and `firms[]` — each firm with its
`export_firm_id` / `export_firm_name`, its `sale_id` (drives the per-firm invoice/
letter downloads; null when no contract is linked yet) and `invoice_number`.

Scope: non-archived, non-deleted trucks with **≥1 export firm** (a firm split),
**regardless of lifecycle status** (a draft qualifies). A truck missing buyer /
country / driver / plate / packing is **shown, not hidden** — flagged
`is_ready=false` with `missing_setup[]` (the Sheet-edited fields) so the team knows
what to fill rather than wondering why it isn't listed; only a truck with no firms
at all is out of scope. Defaults to the active season; filters `?date=` (exact),
`?date_from=` / `?date_to=` (range), `?status=` (code), `?firm=` (export firm id).
Gated by the `sale` resource. The page shows a **Ready / Setup needed** badge and,
in the expanded panel, a banner listing the missing fields.

The frontend **Documents page** (`/documents`, page code `contracts.documents`,
default-visible to admin / director / export_manager / document_team) is a
truck-indexed ProTable: each row expands to `DocumentPacketPanel` — the truck-level
CMR (`CmrDocumentsButton`, disabled until packing is complete) plus a row per firm
with that firm's `InvoiceDocumentsButton` (its `sale_id`), or a "no contract linked"
note. Data via `useDocumentPackets`; a date filter drives the 13:00 workflow.

## Roadmap / TODO

- **`GeneratedDocument` audit model** — one row per generation (doc, truck/sale,
  user, time) to back the **13:00 board**: per truck, what's done vs pending.
  Doesn't block generation — progress tracking only.
- **Save-and-reuse** — persist the rendered file so an unchanged truck re-downloads
  the saved copy instead of re-rendering (needs a "dirty since generated" check on
  shipment/sale `updated_at`).
- **Editable templates** — let the office upload/swap the `.xlsx`/`.docx` templates
  from the admin at runtime (see the `DocumentTemplate` note in `registry.py`).
- Trade passport / packing list are later documents.

The CMR now renders onto the **official 24-box form** (xlsx overlay,
`build_cmr_overlay`) — no longer a simplified layout. The truck CMR needs
`firm_splits` (sellers) + whole-truck packing; per-firm docs need the firm's
`ContractSale`.
