---
title: Firms Admin
tags: [screen, frontend, admin, core, contracts, documents]
related: [[../processes/document-generation]], [[../reference/api-endpoint-map]], [[../reference/contracts-contract-sale-model]]
---

# Firms Admin

The two firm registries behind every generated export document.

| Screen | Route | Component | Model |
|---|---|---|---|
| Export Firms (list) | `/admin/firms` | `frontend/src/pages/admin/ExportFirmsPage.tsx` | `core.ExportFirm` |
| Export Firm (detail) | `/admin/firms/:id` | `frontend/src/pages/admin/ExportFirmDetailPage.tsx` | `core.ExportFirm` |
| Import Firms (list) | `/admin/import-firms` | `frontend/src/pages/admin/ImportFirmsPage.tsx` | `core.ImportFirm` |
| Import Firm (detail) | `/admin/import-firms/:id` | `frontend/src/pages/admin/ImportFirmDetailPage.tsx` | `core.ImportFirm` |

`ExportFirm` is the YGT-side seller (the legal entity on the contract, invoice and customs
form); `ImportFirm` is the buyer. The import list splits into two tabs on `is_gapy_satys` —
*Our Firms* vs *Gapy Satyş* — and carries a country filter plus a Swap action that moves a firm
between tabs. Both lists search with `normalizeSearch` (diacritic- and punctuation-insensitive). The export list shows
code, Turkmen name, doc-readiness and active; the **Name (EN)** and **Name (RU)** columns were removed on
2026-09-10 as noise, but both are still matched by the search box.

Access is the standard resource split: `export_firm` and `import_firm` on `/admin/permissions`,
checked in the UI with `canDo(user, '<resource>', 'create' | 'edit' | 'delete')`.

## Document-readiness indicator

Both lists carry a **Doc Fields** column and both detail pages open with a matching banner:

- **green** — every field a generated document reads is filled
- **amber `Missing N`** — hover *or tap* the tag to see exactly which fields are blank

The rule lives in `frontend/src/utils/firmCompleteness.ts`
(`REQUIRED_EXPORT_FIRM_FIELDS` / `REQUIRED_IMPORT_FIRM_FIELDS`), rendered by
`frontend/src/components/FirmCompletenessTag.tsx`. It is computed **entirely on the frontend** —
both list endpoints already return every firm column, so no serializer or endpoint changed.
The tooltip trigger is `['hover', 'click']` because Ant Design's default is hover-only, which
leaves touch users no way to read it.

### What counts as required

Required means *a document builder in
`backend/apps/contracts/services/document_context.py` reads it and has no fallback worth
relying on*:

| Model | Required |
|---|---|
| `ExportFirm` | `code`, `name_tk`, `name_ru`, `address_tk`, `address_ru`, `bank_details_tk`, `bank_details_ru`, `director`, `director_signature`, `director_seal` |
| `ImportFirm` | `name_company`, `country`, `address`, `bank_details`, `contact_person`, `director_signature`, `director_seal` |

The signature and seal are required on **both** firms, and the import firm's director name with
them, by operator decision on 2026-09-10. A firm with no stamp on file cannot produce a signed
contract, so calling it complete was misleading even though the plain download still renders.

Deliberately **not** required, with the reason each one is safe to leave blank:

| Field | Why not required |
|---|---|
| `name_en`, `address_en`, `bank_details_en` | `_firm_attr()` falls back ru→en→tk — an English invoice still renders, just in Russian |
| `director_tk`, `contact_person_tk` | the Turkmen spelling of a name already required in its Russian form, and both fall back to it |
| `tax_code`, `swift_code`, `one_c_code`, `phone`, `city`, `code` (import), `name_short` | no document builder reads them |

`address_tk` and `bank_details_tk` are the strictest entries: the KZ export contract's Turkmen
column reads them with **no** fallback, so a blank leaves a visibly empty box on a signed
contract. The `_ru` columns do fall back to `_tk`, but that puts Turkmen text into a Russian
contract, so they count as unfilled too.

Against the live registry (2026-09-10) the rule flags **25 of 25** export firms and **118 of 119** import
firms — the stamps have never been uploaded for anyone, and the import firms' director names were never
captured either. Three fields account for nearly all of it: `director_signature` (25 export / 117 import),
`director_seal` (23 / 116) and `contact_person` (117 import). Below those the tail is small and specific:
11 export firms lack `address_tk` and `bank_details_tk`, 6 lack `director`, 15 import firms lack
`bank_details`, 2 lack `address`. Dropping the three stamp/director fields would put the counts back at
11 of 25 and 15 of 119, which is the shape this indicator had before 2026-09-10.

Firms are **not** exempted when `is_active` is false: no firm in either registry is currently deactivated,
so a retired-firm exemption would be code for a case that does not exist; deactivate one and it is
flagged like any other.

Changing the rule is a one-line edit to the two arrays. Tests:
`frontend/src/utils/firmCompleteness.test.ts`.
