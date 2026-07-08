# Document Generation

Auto-fills the export documents that the document team used to fill by hand from
the `Export_contracts` master sheet (2–3 hrs/day against a 13:00 deadline). P4
ships this **one document at a time** on a shared, document-agnostic framework.

**Shipped:** per-firm **Invoice** (RU/EN) + the **CT-1 / FITO / Customs** request
letters, and the truck-level **CMR** (RU/EN) — each as both `.docx` (editable) and
PDF. Documents are produced from the **Documents page** (`/documents`), a
truck-indexed workspace for the document team.

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
| Template registry | `apps/contracts/document_templates/registry.py` | Plain dict (not a DB model) keyed by document key → `.docx` file, scope, language, context-builder, filename pattern. One entry per concrete document/variant. |
| Template files | `apps/contracts/document_templates/*.docx` | Authored Word layouts with Jinja tags. Static labels baked per language; only data values are `{{ }}`. Built by `build_templates.py`. |
| Context builders | `apps/contracts/services/document_context.py` | Pure `(obj, lang) → dict`. Owns date/money/kg formatting, firm-language fallback, shipment-vs-invoice fallback. Unit-tested without rendering. |
| Render service | `apps/contracts/services/document_render.py` | `render_docx` (docxtpl→bytes); `render_pdf` (LibreOffice headless→bytes); `generate(key, obj, fmt)` ties it together. |
| API views | `ContractSaleViewSet.document` (per-firm docs), `ShipmentCmrView` (truck CMR), `DocumentPacketListView` (page list) — all in `apps/contracts/views.py` | Thin; run the packing guard, then return the file as an attachment (or the packet list). |
| Audit model | *(deferred)* | `GeneratedDocument` for the 13:00 board — not needed to generate. |

## Endpoints

All gated by the **`sale`** resource (admin / director / export_manager / **document_team**
— the last needs `sale` **view**, granted in `seed_permissions`, or the whole page 403s).
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

**Document packets** — one row per truck for the page:
```
GET /api/v1/contracts/document-packets/?date=&date_from=&date_to=&status=&firm=
```
- Floor to appear: non-archived / non-deleted trucks with **≥1 export firm** (a firm split),
  **regardless of status** (a draft qualifies). Missing buyer / country / driver / plate /
  packing do NOT hide the truck — they surface as `is_ready=false` + `missing_setup[]` so the
  team sees what to fill. Defaults to the active season. Returns `packing_complete` +
  `missing_packing[]`, `is_ready` + `missing_setup[]`, and `firms[]` (each with `sale_id`).

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
provisioned in `backend/Dockerfile` (`libreoffice-writer` + `fonts-dejavu` /
`fonts-liberation` / `fonts-noto-core` for Cyrillic/Latin glyphs), so PDF works in
the deployed container regardless of host OS — the runtime is Debian, not the
dev machine. The filled `.docx` is converted to PDF (single source of truth:
PDF == Word) via a unique `-env:UserInstallation` profile per call (avoids the
shared-profile lock under concurrency). Resolution order: `LIBREOFFICE_BIN`
setting → `soffice`/`libreoffice` on PATH.

**Local dev (Windows/macOS):** LibreOffice is usually absent, so PDF returns 503
and only `.docx` works — which is fine for development. To test PDF locally,
install LibreOffice and either add its `program/` dir to PATH or set
`LIBREOFFICE_BIN` (e.g. `C:\Program Files\LibreOffice\program\soffice.exe`).

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

## Frontend

A per-sale **Documents** dropdown (`components/InvoiceDocumentsButton.tsx`) sits
in the action column of the contract **Faktura tab** (`ContractSalesTab`) and the
**all-sales list** (`ContractSaleList`). It offers Invoice / CMR in RU/EN as Word or
PDF (8 entries) and downloads via `utils/fileDownload.ts::downloadUrl()` — a plain
anchor click; the httpOnly auth cookie rides the same-origin GET (same mechanism as
the Boss report exports). Labels are `documents.*` i18n keys (tk/ru/en).

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
was dropped — the destination borders don't require it. Deferred: the **official
24-box CMR form** (current template is a simplified labelled layout with the same
Jinja field names, so the business can re-skin it).

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

Three short request letters, each **single-language** per its source form: CT-1
certificate-of-origin (`ct1_ru`), phytosanitary certificate (`fito_ru`), and the
customs-clearance ARZA (`customs_tk`, Turkmen). Builders `build_ct1_context` /
`build_fito_context` / `build_customs_context`; static addressee/body boilerplate
is baked into each template, only named fields injected. `fito`/`customs` resolve
the destination country via `_country_name` (shipment → buyer-firm fallback). CT-1
needs only firm + contract, so it fills even with no shipment link.

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

## Deliberate limits

- Single product line per invoice (`line_items[0]`); multi-line is a future template change.
- CMR: simplified labelled layout; the official 24-box form is deferred (above).
- Trade passport / packing list are later documents.
- The truck CMR needs `firm_splits` (sellers) + whole-truck packing; per-firm docs
  need the firm's `ContractSale`.
