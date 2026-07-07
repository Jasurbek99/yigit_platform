# Document Generation

Auto-fills the export documents that the document team used to fill by hand from
the `Export_contracts` master sheet (2–3 hrs/day against a 13:00 deadline). P4
ships this **one document at a time** on a shared, document-agnostic framework.

**Shipped:** Invoice (RU/EN) and CMR base single-firm (RU/EN), each as both
`.docx` (editable) and PDF.

## Architecture

A six-piece core so adding the next document is "drop in a template + write one
context builder", never "wire a new endpoint stack".

| Piece | Where | Role |
|-------|-------|------|
| Template registry | `apps/contracts/document_templates/registry.py` | Plain dict (not a DB model) keyed by document key → `.docx` file, scope, language, context-builder, filename pattern. One entry per concrete document/variant. |
| Template files | `apps/contracts/document_templates/*.docx` | Authored Word layouts with Jinja tags. Static labels baked per language; only data values are `{{ }}`. Built by `build_templates.py`. |
| Context builders | `apps/contracts/services/document_context.py` | Pure `(obj, lang) → dict`. Owns date/money/kg formatting, firm-language fallback, shipment-vs-invoice fallback. Unit-tested without rendering. |
| Render service | `apps/contracts/services/document_render.py` | `render_docx` (docxtpl→bytes); `render_pdf` (LibreOffice headless→bytes); `generate(key, obj, fmt)` ties it together. |
| API action | `ContractSaleViewSet.document` in `apps/contracts/views.py` | Thin `@action`, returns the file as an attachment. |
| Audit model | *(deferred)* | `GeneratedDocument` for the 13:00 board — not needed to generate. |

## Endpoint

```
GET /api/v1/contracts/sales/{id}/document/?type=<key>&fmt=docx|pdf
```

- `type`: `invoice_ru` (default), `invoice_en`, `cmr_ru`, `cmr_en`, `ct1_ru`,
  `fito_ru`, `customs_tk`.
- `fmt`: `docx` (default) or `pdf`. **Named `fmt`, not `format`** — `format` is
  reserved by DRF content negotiation and would 404.
- Permissions: existing `sale` resource permission (document team / export_manager / director).
- Errors: `400` unknown `type`; `503` when `fmt=pdf` but LibreOffice is absent
  (with a clear message — the `.docx` path is unaffected).
- Response: `Content-Disposition: attachment`, filename e.g. `Invoice_93-26-DM-EXP_118_RU.docx`.

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

## Deliberate v1 limits

- `place_loading` is blank until a loading-location source is wired.
- Single product line per invoice (`line_items[0]`); multi-line is a future template change.
- CMR: single-firm only; firm-split variants + official box form deferred (above).
- Trade passport / customs / phyto / CT-1 / packing list are later documents.
- Most documents need `invoice.shipment` populated (Slice B) to fill transport/cargo.
