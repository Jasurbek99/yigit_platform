# Sera Bütçe — page build brief (read fully)

You are building **ONE page** of a UI-only prototype module ("Sera Bütçe") in the YGT
React frontend at `d:\projects\yigit_platform\frontend`. The module clones screens from
another app, adapted to our **Ant Design v6 + inline-style** conventions.

**MOCK DATA ONLY** — no API calls, no data-fetching hooks. **Hardcode Turkmen/Turkish
labels** — NO i18n, NO `t()`, NO translation files.

## Your task
Replace the stub file you are assigned with a full implementation of your page, matching
the reference screenshot's layout, sections, tables, and figures.

## Read FIRST (in this order)
1. Your reference **screenshot** (Read tool renders PNGs visually) + your **DOM snapshot**
   `.md` (exact labels + numbers). Paths given in your task.
2. Style exemplars — match these conventions exactly:
   - `frontend/src/pages/sera/pages/butce/ButceDashboard.tsx`
   - `frontend/src/pages/sera/pages/SeraAnaSayfa.tsx`
3. The shared primitives you will reuse (read the files for exact props).

## Shared primitives (REUSE — do not reinvent)
- `@/pages/sera/seraTheme` → `SERA` (colour tokens) + `fmtNum / fmtKg / fmtUsd / fmtDtm / fmtPct`
  (tr-TR number formatting: dot thousands).
- `@/pages/sera/components/SeraPageHeader` — coloured banner. Props: `icon, title, subtitle?,
  accent?, accentDark?, extra?, year?, showPdf?`.
- `@/pages/sera/components/SeraCard` — white rounded surface. Props: `title?, extra?, children,
  padding?, style?`.
- `@/pages/sera/components/SeraStatCard` — KPI tile. Props: `label, value, sub?, icon?, accent?, tint?`.
- `@/pages/sera/components/SeraChipSelector` → `SeraBlockSelector`, `SeraMonthSelector`
  (use only if your page has block / month chip selectors). Props: `selected, onChange, title?`.
- `@/pages/sera/components/SeraMatrixTable` + `type MatrixRow` — horizontally-scrollable
  comparison table. Props: `headers: string[], rows: MatrixRow[], footer?: MatrixRow, numeric?, minWidth?`.
  `MatrixRow = { label, cells: ReactNode[], bold?, indent?, groupHeader?, labelColor? }`.
- `@/pages/sera/mock/seraData` — shared blocks / totals / monthly figures. **Reuse these when
  your page shows the same data** (blocks list, 2026 totals, monthly channel figures).
- Charts: `import { EChart } from '@/components/EChart'` — ONLY line/pie/bar series are
  registered. Spread readonly arrays into mutable ones: `data: [...arr]`. Pass `ariaLabel`.
- Icons: `@tabler/icons-react` (size 15–22).

## Rules (STRICT)
1. **Overwrite ONLY your assigned stub file.** You MAY create ONE new page-specific mock file
   at `@/pages/sera/mock/<yourMockName>.ts`. Do **NOT** edit `App.tsx`, `AppLayout.tsx`,
   `seraData.ts`, `seraNav.ts`, or any shared component/theme file (you may READ them).
2. Keep the **default export** and its component name exactly as in the stub (the router imports it).
3. Banner `accent`: match the source page's banner colour (see screenshot). Pomidor = red
   (`SERA.red`/`SERA.redDark`); most Bütçe pages = green (default). Personel = pink, etc. —
   eyeball the screenshot.
4. Use **exact numbers + labels** from the DOM snapshot. Format numbers with the `fmt*` helpers.
5. Layout shape: page root = `<div style={{ display:'flex', flexDirection:'column', gap:16 }}>`
   containing `SeraPageHeader` then `SeraCard` / table / stat-grid sections.
6. Interactive filters may use local `useState` for visual state but need not recompute the data
   — rendering the full mock dataset is acceptable for this prototype.
7. **Must pass typecheck.** When done run:
   `cd d:/projects/yigit_platform/frontend && npx tsc --noEmit --ignoreDeprecations 5.0 2>&1 | grep -i "<yourFileBasename>"`
   and fix any errors in YOUR file until that grep is empty.

## Report back
One line: file written + typecheck clean (yes/no) + any source detail you couldn't replicate.
