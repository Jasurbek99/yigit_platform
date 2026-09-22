# Tırlar tab — exact sera design

**Date:** 2026-09-16 · **Branch:** `Copy_Gadams_UI` · **Status:** design, awaiting owner review

## 1. Goal

The export manager wants **Maşyn Yzarlamasy → Tırlar** (`/tir-takip`) to look and work like
**Tır Takip → Tırlar** in `data/sera-butce-web` (`client/src/App.jsx:14018–15130`).

Today the tab renders our Shipment Sheet with its `ios` design pinned (`TirlarTab.tsx`,
commit `9ab41eb`). The `ios` design only *resembles* sera: grey pill cells, grey section
bands, a one-line truck header. This spec closes the gap without changing
`/export/shipments/sheet`.

## 2. Decisions taken (2026-09-16)

| # | Question | Answer |
|---|---|---|
| D1 | How far does "exactly" go? | **Everything**: look, input-box cells, sera's tools |
| D2 | Where does the look live? | **A new third design, `sera`**, next to Classic/iOS, used only by Tırlar |
| D3 | How literal are input boxes? | **Box look, one click edits**: every editable cell is drawn as a sera box, one click (filled or empty) opens our existing editor |
| D4 | Truck header | **Full tall card**, like sera |
| D5 | "DOLY DÄL" (partial truck) | **Not wanted**: no badge, no "Ýarym" filter |
| D6 | Which sera tools | **Doly Tır Aç + Aktar**, and **Ayır**. Not wanted: Tapgyrlar stamp buttons, Grup goş, the "Kg / Açylan wagty" row |

Standing rule (memory `feedback_sera_copies_leave_originals`): Tır Takip changes must not
alter the original pages. Shared sheet code may only gain **additive branches that run for
`variant === 'sera'`**.

## 3. Phases

Each phase is its own plan → implementation → test → commit cycle.

| Phase | Content | Backend |
|---|---|---|
| **1** | The `sera` design: look, header card, box cells (§4) | none |
| **2** | Filter panel (§5) | none |
| **3** | Doly Tır Aç + ↗ Aktar (§6) | none (reuses existing endpoints) |
| **4** | ✂ Ayır, i.e. un-join (§7) | **new endpoint**; needs its own spec |

Out of scope: Tapgyrlar "Okat" buttons, Grup goş / user groups, "Kg / Açylan wagty" row,
DOLY DÄL, sera's "Eski otomatik tırları temizle" (legacy of its own data).

## 4. Phase 1 — the `sera` design

### 4.1 Plumbing

- `TSheetVariant` (`stores/sheetStore.ts`) becomes `'classic' | 'ios' | 'sera'`.
  `loadVariant()` keeps returning only `classic`/`ios`, and the Sheet toolbar's design
  select keeps offering only those two. **The Sheet page can never enter `sera`.**
- `TirlarTab` passes `variant="sera"` instead of `"ios"`. The existing pin path
  (`SheetGrid` → `SheetCell`, commit `9ab41eb`) carries it. `SheetLabelRow` and
  `SheetColumnHeader` gain the same optional `variant` prop (caller's pin, not the resolved
  value; see the `renderCell` deps note in `SheetGrid`).
- **Row order:** `sera` uses the same topic order as `ios`. The two checks
  `sheetVariant === 'ios'` (`SheetGrid.tsx:259`, `SheetToolbar.tsx:385`) become
  `sheetVariant !== 'classic'`. `iosRowOrder` (the per-browser row order) is shared by both.
  That is acceptable because it is the same section model.
- **Row hook for CSS:** `SheetGrid` puts `data-field-key="<field_key>"` on each row wrapper,
  so `SheetVariantSera.css` can style one row (the Export Kody band, §4.3) without JS. The
  attribute is inert for classic/ios.

### 4.2 Geometry: all sizes come from JS

The grid is virtualised; widths and heights must come from `scaleSheetLayout`, never from CSS
(`constants/sheetRowConfig.ts` header, `shipment-sheet.md` "Design variant").

| Slot | classic / ios today | sera |
|---|---|---|
| Row # column | 28 | **0** (sera has none; zero-width slot, as "hide Who" already does) |
| Who column | 120 | **0** |
| Field (label) column | 210 | **220** |
| Truck column | 145 × density | **160** |
| Row height | 36 × density | **≈ 32**, tuned against a side-by-side screenshot |
| **Header height** | = row height | **≈ 104** (the tall card) |

`scaleSheetLayout` gains a per-variant label-width table and a new `headerHeight` output.
For `classic`/`ios`, `headerHeight === rowHeight`, so their numbers are unchanged; a test
pins this.

**Header-height threading.** `SheetGrid` assumes "header = one row" in these places, and
each must read `headerHeight` instead:

- scroll-into-view maths, `SheetGrid.tsx:471–484` (`(1 + idx) * ROW_HEIGHT`, `stickyBand`)
- header row height, `:1238`
- header cells, `:1281`
- the frozen-rows sticky offset, `:1307` (`top: ROW_HEIGHT`)
- the corner cell, `:1227`

Plus any others found by grepping `ROW_HEIGHT` during implementation. This is the riskiest
part of phase 1; it gets unit tests on the maths and a manual scroll/freeze check.

### 4.3 Skin: `components/sheet/SheetVariantSera.css`

A new file, every rule scoped under `.sheet-grid--sera`. It follows the same two rules as
`SheetVariantIos.css`: no `background` on `.sheet-cell`, and no sizes. It is not `sera.css`,
which is shared with other Tır Takip work.

| Element | sera value (Tailwind resolved) |
|---|---|
| Canvas / rows | white; row divider `#f5f5f4`; hover `#fafaf9` at 60 % |
| Base text | 11px, `#292524`, labels weight 600 |
| Section band | label cell bg `rgba(30,64,175,.15)`, row bg `rgba(30,64,175,.20)`, text `#1e40af`, 3px left `#1e40af`, 11px bold uppercase, wide tracking |
| Label column | white, 2px right border `#e7e5e4`, 3px left border in the section colour (§4.4) |
| Cell box | 1px `#e7e5e4` border, 4px radius, white, inset about 4px; focus ring emerald |
| Read-only cell | plain text, no box |
| Export Kody row | amber band: bg `#fffbeb`, 2px top/bottom `#fbbf24`, label `#78350f` bold uppercase; filled value bold `#92400e` in a 2px `#f59e0b` box, empty value in a dashed `#fcd34d` box |
| Corner cell | stone-50 bg, caption 10px uppercase `#a8a29e` ("Kategoriýa / Açyklama") |

### 4.4 Label column: emoji and section colour

A new module, `components/sheet/sheetSeraLabels.ts`, maps `field_key` to the emoji
(sera `App.jsx`), and topic section to the left-edge colour. Label **texts stay ours**
(admin-configurable, tk/ru/en). Only the emoji prefix and the edge come from sera. The same
rule was used for Önümçilik.

| Section | Edge | Rows → emoji |
|---|---|---|
| General | `#0f2d5a` | block_sources 🏗 · harvest_status 🌿 · export_code 🏷 (amber row, §4.3) |
| Cargo & customs | `#0f2d5a` (firm_splits `#14532d`) | firm_splits 🏭 · documents_status 📄 · country 🌍 · customer 👤 · city 🏙 · import_firm 🏢 · firm_contracts 📜 |
| Transport | `#7c2d12` | driver_name 🧑‍✈️ · driver_phone 📱 · truck_plate 🚘 · vehicle_responsible 👷 |
| Loading times | `#0e4f6a` | customs_exit_at 📜 · loading_started_at ▶️ · loading_ended_at ⏹ · departed_at 🏭 · transit_days_temp 🗓 |
| Road & border | `#1e3a8a` | border_point 📍 · border_crossed_at 🕐 · dest_entry_at 🛂 · has_peregruz 🔄 · peregruz_date 🕑 · arrived_at 📦 |
| Sales & report | `#4c1d95` | weight_net ⚖️ · variety 🍅 · harvest_date 📅 · sale_started_at ▶️ · sale_ended_at ⏹ · sales_report_date 📋 |
| Other (custom rows) | `#a8a29e` | none |

- **YGT-only rows** (no sera sibling) get **no emoji**, only the edge. Examples: `shipment_code`
  (its sera pairing is the "Kg / Açylan wagty" row, which D6 drops), `packing`,
  `transport_docs_given_at`, `vehicle_condition`, `customs_entry_at`, `weight_to_load_kg`.
- During implementation, check each pairing against the "Sera: …" comments in
  `sheetTopicOrder.ts`; those comments are the source of the pairing.

### 4.5 Truck header card (`SheetColumnHeader`, sera branch)

Top to bottom, centred, as in `App.jsx:14160–14240`:

1. 4px top border and tinted background, by origin (**assumption A1**):

   | Shipment | Colour | Label |
   |---|---|---|
   | `isSupplyDraft` | green: `#16a34a` edge, `#dcfce7` bg | 📦 Gaplama |
   | `isDestinationDraft` | orange: `#ea580c` edge, `#ffedd5` bg | 📋 Export Bölüm |
   | anything else (joined or promoted) | green, like sera's merged truck | 📦 Gaplama |

2. **Code**, 13px extra-bold mono: `export_code`, falling back to `—` as sera does. Below it,
   `shipment_code` small grey, so an empty export code never leaves a column unidentifiable
   (**assumption A2**).
3. Blocks, 10px grey: `block_sources` codes joined with ` + `.
4. Status chip, 9px bordered: our `status_display`, coloured by `phase`:
   PLAN/PREP stone · DOCS/LOAD amber · TRANSIT blue · DEST/CLOSE emerald · CANCELLED rose.
5. Origin label (from step 1), 9px bold.
6. Actions: 🗑 as today (existing delete rules). Phases 3–4 add ↗ Aktar and ✂ Ayır here.

Existing header features stay: sequence number, colour dot, cancelled tag, drag-reorder,
join-mode selection. They are laid out inside the card. New visible strings (origin labels,
corner caption) get i18n keys in tk/ru/en.

### 4.6 Cells (`SheetCell`, sera branch)

- An editable cell draws as a sera box (§4.3). **One click opens the editor**, for filled
  cells too (today a filled cell needs a double-click). Selection, keyboard navigation,
  copy/paste, undo, right-click menu and history are unchanged.
- A read-only cell (by `isCellEditable`) draws as plain text. One click selects it, as today.
- Editors are our existing `SheetCellEditor` set, unchanged.
- Per-cell colours, column tints and the gapy tint still paint, inside the box.

### 4.7 What does not change

Data (`/sheet/`), write path (`useSheetCellWrite`), permissions (`isCellEditable`, row access,
backend field checks), comments/tasks, live sync, freeze, zoom, the Classic and iOS designs,
and everything on `/export/shipments/sheet`.

### 4.8 Tests (phase 1)

- `scaleSheetLayout`: classic/ios outputs unchanged (snapshot), and the sera widths and
  heights are as specified.
- Header-height maths: the scroll-into-view offsets are correct for sera (tall header) and
  unchanged for classic.
- `SheetColumnHeader` sera branch: origin colour and label for supply draft, destination
  draft and full shipment; `export_code` fallback; status chip colour per phase.
- `SheetCell` sera branch: one click opens the editor on a filled editable cell; a read-only
  cell has no box.
- `sheetSeraLabels`: every emoji key exists in `TOPIC_SECTIONS`, so no stale keys.
- Store: `loadVariant` never returns `sera`; the toolbar options are still two.
- Existing sheet suites stay green, and `TestEveryRoleCanEditItsOwnSheetRow` is re-run (the
  permission chain is not touched, but `SheetCell` is).
- Manual, by the owner: side-by-side with sera at 100 % zoom, scroll right and down, frozen
  rows, one-click edit.

### 4.9 Files (phase 1)

Modified (additive, gated on `sera`): `stores/sheetStore.ts` (type only),
`constants/sheetRowConfig.ts`, `components/sheet/SheetGrid.tsx`, `SheetCell.tsx`,
`SheetLabelColumn.tsx`, `SheetColumnHeader.tsx`, `SheetToolbar.tsx` (one condition),
`pages/sera/TirlarTab.tsx`, `i18n/{tk,ru,en}.json`.
New: `components/sheet/SheetVariantSera.css`, `components/sheet/sheetSeraLabels.ts`, tests.
Docs: `docs/obsidian/screens/tir-takip.md`, `shipment-sheet.md` (the third design).

## 5. Phase 2 — filter panel

A collapsible **▼ Filtrler** button above the sheet (`App.jsx:14020–14100`), sera styling in
`sera.css`.

- **State lives in the URL**, `?tir_year=&tir_months=&tir_blocks=&tir_status=` (frontend rule:
  URL-reflected filters). It never touches `sheetStore` search/filters, so the Sheet page is
  unaffected, and neither leaks into the other.
- **Ýyl:** number input. **Default empty (all years)**, because a season crosses New Year
  (sera defaults to the current year, which would hide Sep–Dec).
- **Aý:** "Hemmesi" plus 12 month chips, multi-select, matched on the shipment `date`.
- **Blok Saýlawy:** chips grouped by greenhouse, matched on `block_sources`. Trucks without
  blocks (destination drafts) always pass, as in sera.
- **Status:** Hemmesi / Açyk (no `arrived_at`) / Tamamlandy (`arrived_at` set). No Ýarym (D5).
- Filtering is client-side on the season already loaded; the `/sheet/` API is unchanged.
- The "N sany" count next to the title reflects the filtered set.

## 6. Phase 3 — Doly Tır Aç + ↗ Aktar

- **Doly Tır Aç** ("El bilen Tır Aç" card, `App.jsx:14103`) opens our existing
  `DestinationDraftModal`, which creates a **destination draft**: sera's orange
  "Export Bölüm" truck. Shown to roles that may create destination drafts (same gate as the
  modal's other entry points).
- **↗ Aktar**, on an orange (destination-draft) header card. It opens an inline code input,
  like sera's (`App.jsx:14197–14230`), or a picker of supply drafts. It calls the existing
  `POST /export/shipments/{this}/join/` with `source_id` = the chosen supply draft.
  - Our Join keeps the **destination** row and deletes the supply row, after moving blocks,
    firm splits, `export_code`, weight and harvest data into it. The result matches sera
    (one merged truck carrying the export code, green card), though the surviving row id
    differs.
  - Gate: `JOIN_ROLES` (`joinHelpers.ts`), which already includes `export_manager`.
  - Errors: the endpoint's 400 messages are shown inline under the input, as sera does.
- **Open question Q3:** does the export manager type the **export code** (sera) or pick from
  a list? The spec assumes typing, with a match on `export_code` among supply drafts.

## 7. Phase 4 — ✂ Ayır (un-join)

Sera's Ayır (`App.jsx:12316`) is the inverse of its Aktar. **We have no inverse of Join**:
Join hard-deletes the source and does not record which fields it copied. So Ayır needs:

- a **join record** written by Join (source id, code, creator, and which fields were copied
  or moved), and
- a new `POST /export/shipments/{id}/unjoin/` that recreates a supply draft from that record,
  moves `block_sources`, firm splits and the copied fields back, and leaves a pure destination
  draft. It runs through `transition_to()` rules and audit, and re-syncs quota usage and
  weekly-plan actuals (both roll up from `block_sources`).
- Allowed only while the merged truck is still a **draft**. After promotion, splitting is
  refused.

This is backend architecture. **It gets its own spec** before any plan; joins made before
the record exists cannot be un-joined.

## 8. Assumptions to confirm

- **A1:** header colours by origin (§4.5). A full shipment shows green "📦 Gaplama".
- **A2:** header shows `export_code`, with `shipment_code` small beneath it.
- **A3:** row label texts stay ours; only the emoji and edge colour come from sera.
- **Q3:** Aktar by typed export code vs a picker (§6).

## 9. Risks

- **Header-height threading (§4.2)** is the one change that can misalign the grid silently.
  It gets dedicated tests and a manual scroll check.
- `SheetCell` is on the permission chain's path. Its sera branch changes only the click
  trigger and the look, never `isEditable`. The every-role test is re-run anyway.
- Parallel work: another session is editing `sera.css` and `TirTakip.tsx`. Phase 1 keeps out
  of both except one prop in `TirlarTab.tsx`.
