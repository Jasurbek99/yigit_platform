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

## Legal form (company type)

Every firm carries a **Legal form** — HJ, HT, HK on the export side; OOO, TOO, OsOO, IP, MChJ,
TOV, LLC, LTD, FH on the import side. It is a FK to `core.CompanyLegalType`, edited on the
detail page and on the create drawer.

The list of forms itself is its own screen, `/admin/legal-forms`
(`pages/admin/CompanyLegalTypesPage.tsx`), reached by the **gear button in the toolbar of
both firm lists** rather than from the sidebar — it is reference data for these two screens,
not a destination of its own. It has **no page permission code**: the route is gated on
`['admin.firms', 'admin.import_firms']` (ProtectedRoute ORs an array), so anyone who can open
either firm registry can open the forms behind it, and there is nothing new to seed on the
permissions matrix. Editing needs `export_firm` **or** `import_firm` edit rights.

The import-firm selector filters on the firm's country, so a Kazakh buyer is offered TOO / IP /
FH and never a Turkmen HJ. It hangs off the same country cascade the city selector uses: change
the country and the offered forms change with it. The export selector passes a fixed `TM`
instead — every export firm is Turkmen, so it offers only HJ / HT / HK. A form tagged with no
country at all is offered everywhere.

### Why the field exists

The legal form used to live **inside** the name string, and the contract template held a second
copy of it. Three things followed, all of them visible on signed paperwork:

1. `contract_kz.docx` appends `HJ` to the seller unconditionally (`"{{ seller_name_tk }}" HJ-iň`),
   and the stripper beside it (`_SELLER_FORM_SUFFIX`) only matched a trailing `H.J.` / `Х.Дж.`.
   Ten sole-proprietor firms are stored with a **prefix** form (`Hususy Telekeçi Döwranow J.A.`,
   `ИП Атаев Максат Амангельдиевич`), so they passed through untouched and printed as economic
   societies.
2. The buyer name was never stripped at all, yet the template adds a form anyway, so a buyer
   stored as `ТОО «Нур-Алем»` rendered `TOO «ТОО «Нур-Алем»»`.
3. The buyer's form is hardcoded Kazakh (`TOO` / `JÇB`) across all seven contract-eligible
   countries, so a Kyrgyz `ОсОО` buyer was declared a Kazakh partnership.

### The name columns

`name_tk` / `name_ru` / `name_en` (export) and `name_company` (import) are **unchanged** and
still carry the form. Migration `core.0046` added `name_bare_*` beside them: the same name with
the form, surrounding quotes and stray punctuation stripped.

Documents still read the `name_*` columns. Swapping them onto `legal_type` + `name_bare_*` is a
separate change, deliberately kept apart so this one moves no generated output at all.

### Firms the backfill could not type

`core.0046` types a firm only when **every** non-empty name column parses and they all agree.
That left 7 of 25 export firms and 6 of 119 import firms with a null form, and they are the
right ones to leave alone rather than guess at:

| Firm | Conflict |
|---|---|
| `BK`, `BKHK`, `KIHK` | Turkmen name says HJ, Russian name says ИП |
| `AMLH` | Turkmen says HK, Russian says ИП |
| `YE` | Turkmen carries an unrecognised `JH`; Russian and English say sole proprietor |
| `MA`, `TELGUWANC` | no form written in any column |

On the import side the six are junk or unseeded rows: `Грузополучатель: ИП ТУРСЫНБАЕВ О.Б.`,
`CUSTOMER «Masoud Behrooz LTD»`, `LZ SERVICE SRL` (Romanian SRL, not seeded), and three names
with no form at all. `SRL` can be added from the settings screen without a migration.

`legal_type` is in `REQUIRED_EXPORT_FIRM_FIELDS` and `REQUIRED_IMPORT_FIRM_FIELDS`, so an
untyped firm names **Legal form** among its missing fields on hover. A blank form does not blank
the document — it prints the **wrong** legal entity — which is why it counts as incomplete.

That is *not*, however, a way to **find** these firms. As of 2026-09-10 the indicator already
reads amber on 25 of 25 export and 118 of 119 import firms, because no stamps have ever been
uploaded, so adding `legal_type` turns no row from green to amber and the thirteen are not
distinguishable without hovering every one. Until the stamp backlog is cleared, the list above is
the way to find them.

## Sole proprietors on the export contract

A **Hususy telekeçi** acts on a certificate (*Tassyknama*), not on a charter, so
the contract's opening sentence about the seller is a *different sentence*, not
the same sentence with different words:

```
HJ    “Ak Bulut” HJ-iň (Türkmenistan), Tertipnama laýyklykda
      hereket edýän Direktor Çaryýew A.

HT    07.12.2022ý. senesindäki A seriýaly №0037564 Tassyknama
      esasynda hereket edýän Hususy Telekeçi Döwranow J.A.
```

Three fields on `ExportFirm` carry the certificate — `patent_series`,
`patent_number`, `patent_date` (migration `core.0047`). They appear on the firm
detail page **only when the legal form is HT**, and are required by the
doc-readiness rule only for that form. Series and number are stored apart
because the joining word belongs to the language: Turkmen writes
`A seriýaly №0037564`, Russian `серии A №0037564`. One combined field could only
ever be right in one of the contract's two columns.

### What the template no longer hardcodes

`contract_kz.docx` used to spell the seller's legal form into nine places. Those
are now single placeholders, composed in `document_context.py`:

| Placeholder | Where | Built by |
|---|---|---|
| `seller_clause_tk` / `_ru` | preamble, p6 / p8 | `_seller_clause()` |
| `seller_block_tk` / `_ru` | signature headings, p137 / p148 | `_seller_block()` |
| `seller_footer` | appendix footer, p230 | `_seller_footer()` |
| `seller_title_tk` / `_ru` | signature labels, p162/163 and p240/241 | `_seller_title()` |

A sole proprietor gets the certificate sentence and a `Hususy Telekeçi` / `И.П.`
label instead of *Direktor*, and the signature line prints the person rather than
the `director` column, which stores the firm name with the form already in it.
**Every other form, and a firm whose form is not set, produces exactly the
wording the template carried before, character for character** — pinned by
`apps/contracts/tests/test_sole_proprietor_contract.py`.

### Still outstanding

Two things this deliberately did not touch, both pre-existing:

- **The buyer's form is still hardcoded Kazakh** (`TOO` / `JÇB`) across all seven
  contract-eligible countries, and the buyer name is never stripped, so a buyer
  stored as `ТОО «Нур-Алем»` still renders `TOO «ТОО «Нур-Алем»»`.
- **A quoted stored name doubles its quotes.** `_bare_seller_name` strips the
  legal form but never the quote marks, so a firm stored as `“Ak Bulut” HJ`
  prints `““Ak Bulut””`. Eleven firms are stored that way. Fixing it changes what
  18 firms print, so it needs its own decision.

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

The three upload slots share a fixed `UPLOAD_SLOT_WIDTH` so they line up as equal columns. The long
explanation of what the combined photo is sits behind an ⓘ beside the label rather than inline: a flex
item sizes to its longest line of text, so as a paragraph it stretched the first slot across the card and
wrapped onto three lines. Its tooltip opens on click as well as hover, for tablets.

**One combined photo counts as both.** Some firms stamp and sign in one motion and can only
supply a photo of the result. `director_stamp` (added 2026-09-10) holds that single image; when
it is on file the separate `director_signature` and `director_seal` stop being required and drop
out of the missing list. `requiredFieldsFor()` in `frontend/src/utils/firmCompleteness.ts` is the
only place this rule lives.

Deliberately **not** required, with the reason each one is safe to leave blank:

| Field | Why not required |
|---|---|
| `name_en`, `address_en`, `bank_details_en` | `_firm_attr()` falls back ru→en→tk — an English invoice still renders, just in Russian |
| `director_tk`, `contact_person_tk` | the Turkmen spelling of a name already required in its Russian form, and both fall back to it |
| `tax_code`, `swift_code`, `one_c_code`, `phone`, `city`, `code` (import), `name_short` | no document builder reads them |

`legal_type` joined the required set on 2026-09-10 — see **Legal form** above for why a blank one is worse than a blank text field.

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
