# Shipment Detail Page — UI/UX Research

**Date:** 2026-07-20
**Scope:** `/export/shipments/:id` (`frontend/src/pages/export/ShipmentDetail.tsx`)
**Method:** repo read (read-only) + primary-source fetches. Every external claim below was fetched
during this session; nothing is paraphrased from memory. Failed fetches are listed in §5.

---

## 1. Question & scope

**Question:** what is the best UI/UX design for the YGT export shipment detail page?

**Constraints that shape the answer (from this repo, not invented):**

- **Ant Design + React**, ProComponents available (`.claude/rules/frontend-arch.md`).
- **13-step lifecycle** across 7 phases, `docs/DOMAIN.md:24-30` and
  `backend/apps/export/services/phases.py:21-46`.
- **~10 roles with different active windows** (`docs/DOMAIN.md:32-47`); all roles see all
  shipments, the active window is only a "my work" filter.
- **Slow networks in KZ/RU** (CLAUDE.md, auth section). The detail page loads as **one payload**
  (`GET /api/v1/export/shipments/{id}/`, one TanStack query, `staleTime` 30 s —
  `docs/obsidian/screens/shipment-list-vs-sheet.md:186`). So progressive disclosure on this screen
  is about **attention**, not bytes. Any recommendation that adds round-trips is a net loss here.
- **Three languages** (tk / ru / en) — every label is `t(...)`; label text expands and contracts
  materially between them.
- **Mobile targets exist**; the page already branches on `Grid.useBreakpoint()`.

**Out of scope:** the Sheet (`/export/shipments/sheet`) and the List. This note only asks what
belongs on, and how to lay out, the single-record screen.

---

## 2. Current state in this repo (factual)

### 2.1 Structure

`ShipmentDetail.tsx` is a **562-line single component**. Layout, top to bottom:

| Element | Ref |
|---|---|
| `ShipmentDetailHero` — back button, stacked dual code, `StatusTag`, phase `Tag`, idle `Tag`, `FreshnessPill`, right-aligned action cluster (Manifest / Promote / Transition / Cancel / Hard-delete) | `ShipmentDetail.tsx:349`, `components/shipment/ShipmentDetailHero.tsx:155-231` |
| Route subtitle `customer → country` | `ShipmentDetailHero.tsx:229-231` |
| State-aware **guidance line** (task / draft / cancelled / completed / active), colour-coded | `ShipmentDetail.tsx:322-369` |
| 2-column CSS grid, `1fr 340px` on ≥ md, single column below | `ShipmentDetail.tsx:372-379` |
| **Left: lifecycle spine** — 5 `LifecycleStage` rows inside one `Card` | `ShipmentDetail.tsx:383-405` |
| Customs/document expenses `Card` with its own `Table` + footer total | `ShipmentDetail.tsx:408-493` |
| Activity-log link (`/shipments/:id/activity`) | `ShipmentDetail.tsx:496-503` |
| **Right rail (≥ md only): `RouteTimelineRail` + a "Links" card** (Logo Tiger / Trip Management / GPS — all three currently hardcoded placeholders) | `ShipmentDetail.tsx:507-527` |

### 2.2 The five stages and how they map to phases

```
STAGES = [
  destination  ← phases PLAN, PREP     → logisticsBody
  documents    ← phases DOCS           → documentsBody
  loading      ← phases LOAD           → goodsBody
  transit      ← phases TRANSIT, DEST  → transportBody
  sale         ← phases CLOSE          → financeBody
]
```
(`ShipmentDetail.tsx:304-310`.) `activeStageIdx` is the stage containing `shipment.phase`; that
stage gets `defaultOpen`, the others start collapsed (`ShipmentDetail.tsx:312-404`,
`LifecycleStage.tsx:38`).

Field membership comes from `EDIT_FIELD_GROUPS` in `constants/shipmentEditConfig.ts:57-118`:
logistics (5 fields), transport (5), goods (7), finance (3), status (3), notes (1).

### 2.3 Editing model

`DetailFieldRow` renders a fixed **180 px label column** + `FieldEditor`
(`DetailFieldRow.tsx:141-176`). There is **no Save button** anywhere on the page: text/textarea/
number autosave on a 700 ms debounce and flush on row blur; select/date/boolean commit
immediately (`DetailFieldRow.tsx:16-127`). The only save feedback is a small `<Spin>` that appears
while `patch.isPending` (`DetailFieldRow.tsx:173`). Quality checkboxes PATCH a separate endpoint
directly (`ShipmentDetail.tsx:64-71`).

Role gating is coarse: `canEditAnyField = canDo(user, 'shipment', 'edit')` is applied to **every**
group identically (`ShipmentDetail.tsx:100`, `:144-155`). Finer gates exist only for quality,
sales report, variety override, expenses, promote, cancel, hard-delete
(`ShipmentDetail.tsx:85-105`, `ShipmentDetailHero.tsx:49-114`).

### 2.4 Concrete defects and drift found while reading

1. **Stale code comment.** `ShipmentDetail.tsx:157-161` says *"always visible. No accordion —
   operators see everything in one scroll."* The page **is** an accordion: only the active stage is
   `defaultOpen` (`:398`).
2. **Stale documentation.** `docs/obsidian/screens/shipment-list-vs-sheet.md:62-72, 167-170, 177`
   describes tabs (`overview` / `document` / `finance` / `changes`), a `ShipmentEditDrawer`, an
   inline comment thread and a `?tab=` deep-link. None of that exists in the current
   `ShipmentDetail.tsx`. Line 14 of the same file says "5 collapsible sections, **all expanded by
   default**" — also wrong.
3. **The sale section is collapsed exactly when the sale happens.** `sale` (finance + firm splits +
   sales report) is bound to phase `CLOSE` only. But `bardy`, `satylyar`, `satyldy` and `hasabat` —
   the statuses where selling and reporting actually occur — all map to `DEST`
   (`services/phases.py:30-33`), and `DEST` is bound to the **transit** stage. So a sales rep
   opening a shipment that is being sold lands on an auto-opened panel of *transport* fields, with
   the sales report collapsed in the next stage down. Sales rep's active window is steps 7-12
   (`docs/DOMAIN.md:42`).
4. **`cancelled` resolves to `CLOSE`.** `get_phase` returns `'CLOSE'` for any unknown code
   (`services/phases.py:50-54`), so a cancelled shipment auto-opens the finance stage.
5. **Accessibility.** `LifecycleStage` toggles with a bare `<button>` carrying **no
   `aria-expanded`, no `aria-controls`**, and the title is a `<span>`, not a heading
   (`LifecycleStage.tsx:85-123`). See §3.4.
6. **No comments or tasks on this screen.** `CommentsDrawer` is imported only by
   `components/sheet/SheetToolbar.tsx` and `pages/export/ShipmentSheet.tsx`. The detail page's only
   collaboration surface is a text link to `/shipments/:id/activity`
   (`ShipmentDetail.tsx:496-503`), even though `shipment.my_task` is already on the payload and is
   used for the guidance line (`:323-325`).
7. **Deep-linking is impossible.** No URL state at all — a stage cannot be linked to. The original
   spec had `?tab=` (`docs/obsidian/screens/shipment-list-vs-sheet.md:177`).
8. **The right rail vanishes on mobile** (`ShipmentDetail.tsx:507`), taking `RouteTimelineRail`
   with it. Mobile users get no route/timeline view; the collapsed stage dots are the only
   progress cue.
9. **The "Links" card is entirely placeholder** — three hardcoded rows, no data
   (`ShipmentDetail.tsx:510-525`).
10. **Fixed 180 px label column** (`DetailFieldRow.tsx:153`) against tk/ru/en labels; Russian and
    Turkmen labels are typically longer than English.

---

## 3. Findings by theme

### 3.1 Detail-page layout: Ant Design's own template guidance

Ant Design publishes a dedicated detail-page spec. It says to *"Put information in levels and
groups, following the principle of proximity"* and to *"Conclude the closeness of each information
module according to the relevance among them."* It offers three escalating templates: **basic
layout** *"to display information with less content and low complexity"*; **cards** for *"modules
with complex content"*; and tabs — *"When the detail page has large and complex content, it has to
be split into multiple tabs."* It also warns to *"Reduce the use of complex structures, try to use
similar layouts and modules to reduce the interference."*
— https://ant.design/docs/spec/detail-page/

**Applies:** this page is squarely in the "large and complex content" band (24 editable fields +
7 timestamps + 4 checkboxes + 2 tables + a sales-report form). Ant's own escalation says tabs or
steps at this size. The current design chose a *vertical accordion keyed to the process*, which is
closer to Ant's steps template — *"Such templates are suitable for developing and collaborating
processes"* (same page). That is a defensible choice for a 13-step lifecycle, but it is **not** the
template Ant names for this volume of content, and the repo's own sprint plan
(`docs/SPRINT_PLAN.md:16`) originally specified tabs.

`Descriptions` is Ant's designated detail-page primitive — *"Commonly displayed on the details
page"* — and it takes a responsive `column` object (`{ xs: 8, sm: 16, md: 24 }`) for small screens.
— https://ant.design/components/descriptions

`Steps` is justified when *"a given task is complicated or has a certain sequence in the series of
subtasks, we can decompose it into several steps to make things easier"*, and ships a vertical
orientation. — https://ant.design/components/steps

`Anchor` exists *"For displaying anchor hyperlinks on page and jumping between them."*
— https://ant.design/components/anchor

### 3.2 Accordion vs tabs vs one long page

NN/g on accordions is blunt about the failure mode this page may be in: *"Accordions should be
avoided when your audience needs most or all of the content on the page to answer their
questions."* Conversely *"Accordions are more suitable when people need only a few key pieces of
content on a single page."* And on state: *"If you do use accordions, make sure to give people the
capability to open multiple sections at a time so that different chunks of content are readily
available. Items that are opened or closed should remain in that state until the user changes
it."* — https://www.nngroup.com/articles/accordions-complex-content/

**Applies:** an operator on this screen is a *"few key pieces"* user — a document_team member needs
the DOCS fields, a transport user the transport fields. The accordion is the right family. But the
current implementation **fails the persistence half of the guidance**: `LifecycleStage` holds
`open` in local `useState` seeded from `defaultOpen` (`LifecycleStage.tsx:38`), so every navigation
back to the page resets every stage. Multiple sections *can* be open (each stage is independent),
which satisfies the first half.

NN/g on tabs: use them *"When lengthy content has clear groupings"*, *"When there are few content
groupings"*, *"When content has unequal importance"*, and *"When content can be labeled
concisely"*; and critically, only *"When users don't need to simultaneously see information
presented under different tabs"* — because switching to compare *"taxes users' short-term memory,
increases cognitive load and interaction cost, and lowers usability compared to a design that puts
everything on one big page."* — https://www.nngroup.com/articles/tabs-used-right/

**Applies — and argues against reverting to the sprint plan's tabs.** Export operators routinely
need weights (goods) *and* firm splits (finance) *and* timestamps (documents) in view together when
reconciling a truck. Tabs would force exactly the compare-across-panels switching NN/g warns about.
The accordion, which allows several sections open at once, is the better fit. Keep it.

### 3.3 Progressive disclosure — what belongs in the first screenful

NN/g defines progressive disclosure as deferring *"advanced or rarely used features to a secondary
screen, making applications easier to learn and less error-prone."* Which features go first should
be decided by *"task analysis and field studies"* or *"frequency-of-use statistics"*; the initial
display must contain everything users frequently need, but not so much that attention becomes
unfocused. It warns against exceeding **two** disclosure levels — three or more typically produce
poor usability from disorientation.
— https://www.nngroup.com/articles/progressive-disclosure/

**Applies directly to defect §2.4.3.** The page already implements the right mechanism (one
disclosure level, auto-open the relevant stage) but points it at the wrong stage during `DEST`.
Frequency-of-use here is knowable without a study: the role's active window
(`docs/DOMAIN.md:32-47`) and `shipment.my_task` both already encode what this user frequently
needs on this shipment.

Note the level count: hero → stage → *sub-section inside a stage* (the variety block, the
timestamps block, the sales-report form) is arguably already two levels; adding another nested
collapse would cross NN/g's warning line.

### 3.4 Accessibility contract for the disclosure/accordion

W3C WAI-ARIA APG, disclosure pattern: *"When the content is visible, the element with role button
has aria-expanded set to true. When the content area is hidden, it is set to false."*
`aria-controls` is optional but *"refers to the element that contains all the content that is shown
or hidden."* Enter and Space must both *"activate the disclosure control and toggle the visibility
of the disclosure content."* — https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/

APG accordion pattern is stricter: *"The title of each accordion header is contained in an element
with role button"*; *"the header button element has aria-expanded set to true"* when the panel is
visible; *"The accordion header button element has aria-controls set to the ID of the element
containing the accordion panel content"*; *"Each accordion header button is wrapped in an element
with role heading that has a value set for aria-level"*; and *"Each element that serves as a
container for panel content has role region and aria-labelledby with a value that refers to the
button that controls display of the panel."*
— https://www.w3.org/WAI/ARIA/apg/patterns/accordion/

**Applies:** `LifecycleStage.tsx:85-123` meets none of the ARIA requirements. Enter/Space already
work because it is a real `<button>`. This is a small, bounded fix.

### 3.5 Highlights / page header and the two-column split

Shopify Polaris' resource-details pattern is explicit about the column split: *"Put information
that defines the resource object in the primary column"* and *"Put supporting information such as
status, metadata, and summaries in the secondary column."* Grouping rule: *"Group similar content
in the same card."* The page header spans full width and gives access to actions and navigation
relating to the whole page; the secondary column takes one-third of the width, the primary
two-thirds. — https://polaris-react.shopify.com/patterns/resource-details-layout

**Applies:** the current split is `1fr 340px` (`ShipmentDetail.tsx:375`) — close to the
two-thirds/one-third ratio on a typical desktop. The hero matches the full-width page-header rule.
But the secondary column's contents only half-comply: `RouteTimelineRail` is exactly the
"status/summary" content Polaris prescribes; the placeholder Links card (§2.4.9) is neither
supporting information nor real data.

### 3.6 Autosave with no Save button

NN/g examined a settings form that autosaves with no Save button and found it violates
expectations: *"Most users are not this savvy, and even the savviest amongst us are more used to the
pattern of having a Save or Submit button at the end of a form."* Its recommended mitigation is
explicit per-field confirmation: *"One solution would be to display the word Saved beside each
field as it is changed, to tell the user that no further action on their part is required."*
— https://www.nngroup.com/articles/efficiency-vs-expectations/

**Applies:** the page has exactly the criticised shape — 24 autosaving fields, zero Save buttons,
and the only feedback is a transient `<Spin>` **during** the request (`DetailFieldRow.tsx:173`).
On a slow KZ/RU link the spinner is visible for a while and then simply disappears; there is no
persistent "saved" state and no visible failure state in the row. This is the single highest-risk
finding for user trust: an operator who types a weight, sees a spinner vanish, and navigates away
has no evidence the value persisted.

### 3.7 Form layout: single column, label proximity, field count

NN/g form recommendations: *"Multiple columns interrupt the vertical momentum of moving down the
form. Rather than requiring users to visually reorient themselves, keep them in the flow by
sticking to a single column with a separate row for each field."* On labels: *"Labels should be
close to the fields they describe (immediately above the field for mobile and shorter desktop
forms, or next to the field for extremely long desktop forms)."* On length: remove fields whose
information can be *"(a) derived in some other way, (b) collected more conveniently at a later
date, or (c) simply omitted."*
— https://www.nngroup.com/articles/web-form-design/

**Applies:** `DetailFieldRow` is already single-column with side labels — correct for a long
desktop form by NN/g's own carve-out. The 180 px fixed label column (`DetailFieldRow.tsx:153`) is
the risk: it is a hard-coded width against three languages. On mobile, NN/g's guidance flips to
labels *above* the field; `DetailFieldRow` never does this.

### 3.8 GOV.UK summary list — a contrast, not a template

GOV.UK: *"Use a summary list to show information as a list of key facts"*, typically for metadata
or *"summarizing user responses at the end of a form journey, particularly through the check answers
pattern"*, with the rule that when a user goes back to change an answer, *"make sure information
they've already entered is pre-populated."* It is not for tabular data and requires key-value
content (`<dl>`). — https://design-system.service.gov.uk/components/summary-list/

**Marked as a partial/contrast fit.** The check-answers model is *read-first, edit-on-demand*.
This shipment page is the opposite — always-editable inline fields with no submission moment. The
one transferable idea is the **read-mode default** for fields the current role cannot edit, which
the page already does via `readOnly` (`DetailFieldRow.tsx:157-160`). Do not restructure the page
around check-answers.

### 3.9 Progress indicators — checked and rejected as a source

NN/g's progress-indicator article is about **wait-time feedback for operations** — *"Use a progress
indicator for any action that takes longer than about 1.0 second"*, looped animation for fast
actions, percent-done for 10 s+. — https://www.nngroup.com/articles/progress-indicators/

**Does not apply** to lifecycle stage indicators. Recorded here so the distinction is explicit and
nobody cites it for the wrong thing. (It *does* bear on §3.6: a save that takes over a second on a
KZ link warrants visible feedback — which the `<Spin>` provides, but only while pending.)

---

## 4. Recommendations for this screen, ranked

Ranked by (user harm avoided) ÷ (effort).

### R1 — Fix which stage auto-opens during `DEST`. **Effort: XS (tactical) / M (correct). Payoff: high.**
Today `DEST` opens the **transit** stage, so a sales rep working a shipment at `satylyar` lands on
transport fields with the sales report collapsed one stage down. Two options, and the choice is a
product decision, not a free win:

- **R1a (tactical, XS):** bind `sale` to `['DEST', 'CLOSE']`, `transit` to `['TRANSIT']`, and
  handle `cancelled` explicitly instead of letting it fall through to `CLOSE`
  (`services/phases.py:50-54`). **Own the trade-off:** `DEST` is a *shared* window —
  `bardy` is step 9, and per `docs/DOMAIN.md:42` transport's active window is 1–9 while
  sales_rep's is 7–12. So this prioritises the sale event over transport's tail-end fields; a
  transport user at `bardy` would then land on finance and must click once to reach transport.
  Defensible, because selling is the dominant activity across `bardy`/`satylyar`/`satyldy`/
  `hasabat` while transport's involvement ends at `bardy`.
- **R1b (correct, M):** make auto-open = **role's active window ∩ shipment phase** rather than
  phase alone. This is R9's mechanism applied to stage selection, and it dissolves the trade-off
  instead of picking a side. It also answers the open question in §5.1.

*Ties to:* §3.3 (progressive disclosure: the initial display must contain what users frequently
need) and defects §2.4.3–4. Prefer R1b if R9 is being done anyway; R1a is the stopgap.

### R2 — Add persistent per-field save confirmation and a visible error state. **Effort: S. Payoff: high.**
Replace the transient `<Spin>` with a three-state indicator on the row: pending → **"Saved"** →
error-with-retry. NN/g's literal recommendation is *"display the word Saved beside each field"*.
*Ties to:* §3.6. Highest-risk finding on slow networks; scoped to `DetailFieldRow.tsx:141-176`.

### R3 — Make `LifecycleStage` ARIA-conformant. **Effort: XS. Payoff: medium.**
Add `aria-expanded`, `aria-controls` + panel `id`, wrap the title in a heading with `aria-level`,
and give the panel `role="region"` + `aria-labelledby`.
*Ties to:* §3.4, defect §2.4.5. Purely additive, ~10 lines in `LifecycleStage.tsx`.

### R4 — Persist stage open/closed state and add a deep-link. **Effort: S. Payoff: medium.**
NN/g: *"Items that are opened or closed should remain in that state until the user changes it."*
Lift `open` out of `LifecycleStage`'s local state into `useSearchParams` (`?stage=documents`,
repeatable) — which simultaneously restores the deep-linking the original spec had
(`?tab=`, obsidian:177) and satisfies the repo's own rule that URL-reflected filters live in
`useSearchParams` (`.claude/rules/frontend-arch.md`, state-management table).
*Ties to:* §3.2, defects §2.4.7. Adds no network round-trips.

### R5 — Bring comments/tasks onto the detail page. **Effort: M. Payoff: high.**
Today a shipment's conversation is reachable only from the Sheet. `shipment.my_task` is already on
the payload; the guidance line already reads it (`ShipmentDetail.tsx:323-325`) but is a dead end.
Reuse `components/sheet/CommentsDrawer` scoped to `(shipment_id, field_key=null)` from a hero
button, plus a per-row comment affordance on `DetailFieldRow` (the field-key scoping the drawer
needs already exists).
*Ties to:* §3.5 (Polaris — supporting information belongs in the secondary column; a per-shipment
thread is exactly that) and defect §2.4.6. Larger because it needs a role/permission pass and i18n
keys in all three files.

### R6 — Fix the label column for i18n and mobile. **Effort: S. Payoff: medium.**
Replace the fixed `flex: '0 0 180px'` with a min/max range on desktop, and stack the label above
the field below `md` — NN/g: labels *"immediately above the field for mobile"*.
(Ant's `Descriptions` is the component Ant designates for detail pages and takes a responsive
`column` object — but it is **read-only**, so swapping `DetailFieldRow` for it would drop inline
autosave. If a component swap is wanted, the editable equivalent is ProComponents'
*ProDescriptions*, which I did **not** fetch and therefore do not cite. The label-column fix stands
on its own without any swap.)
*Ties to:* §3.7, defect §2.4.10.

### R7 — Give mobile a route/timeline surface. **Effort: S–M. Payoff: medium.**
`RouteTimelineRail` is dropped entirely below `md` (`ShipmentDetail.tsx:507`). Either render it
collapsed above the spine on mobile, or use a horizontal `Steps` — Ant justifies Steps for exactly
*"a given task ... has a certain sequence in the series of subtasks"*.
*Ties to:* §3.1, defect §2.4.8.

### R8 — Delete or implement the placeholder Links card. **Effort: XS. Payoff: low–medium.**
Three hardcoded rows with no backing data (`ShipmentDetail.tsx:510-525`) occupy prime secondary-
column space. Polaris reserves that column for *"status, metadata, and summaries"* — placeholders
aren't that.
*Ties to:* §3.5, defect §2.4.9.

### R9 — Role-scope the field groups, don't just gate edit/read globally. **Effort: M. Payoff: medium.**
`canEditAnyField` is one boolean applied to all six groups (`ShipmentDetail.tsx:100`). The backend
already returns `editable_fields` per role×status (obsidian:141, 158). Driving `DetailFieldRow`'s
`readOnly` from `editable_fields` per key — rather than one page-wide boolean — is the
frequency-of-use signal NN/g asks for, already computed server-side.
*Ties to:* §3.3.

### R10 — Do NOT convert to tabs. **Effort: 0 (a decision). Payoff: avoids a regression.**
`docs/SPRINT_PLAN.md:16` still specifies tabs and `docs/obsidian/screens/shipment-list-vs-sheet.md`
still documents them. NN/g's tab rule — use tabs only *"When users don't need to simultaneously
see information presented under different tabs"* — is violated by the reconciliation workflows on
this screen. Record the accordion as the decision and fix the two stale docs (§2.4.1–2) instead.

---

## 5. What I could not verify / open questions

**Fetches that failed (not paraphrased from memory):**
- `https://www.lightningdesignsystem.com/guidelines/record-detail/` → **HTTP 404**. A search
  restricted to `lightningdesignsystem.com` returned only builder-panel and layout pages, no
  record-detail or highlights-panel guidance. **No Salesforce claim appears in this document.**
- `https://archive-2_5_2.lightningdesignsystem.com/guidelines/record-detail/` → DNS failure
  (`ENOTFOUND`).
- Not attempted, so not cited: Atlassian Design System, IBM Carbon, Material Design 3. Their
  omission is a scope choice (targeting the decisions this screen has already made), not a finding
  that they lack guidance.

**Open questions this research cannot settle:**
1. **Which stage should open for a given role?** NN/g says decide by task analysis or
   frequency-of-use statistics. The repo has neither for this screen. R1 fixes an outright
   mis-mapping; the deeper question — should a document_team user always land on the DOCS stage
   regardless of the shipment's phase? — needs observation of real usage.
2. **Is the accordion actually being used, or are operators expanding everything every time?**
   Untestable without instrumentation. It decides whether R4 (persist state) is a convenience or a
   necessity.
3. **Do any users reach this page on mobile in practice, and in which roles?** R7's priority hangs
   on this.
4. **Should comments be per-field on Detail, or is per-shipment enough?** The Sheet's per-cell model
   exists; whether it maps onto the Detail page's grouped rows is a product decision, not a
   research finding.
5. **`sales_report` and the DEST/CLOSE boundary** — R1 assumes the sale stage should open during
   DEST. Confirm with the export manager that this matches how they work, since the status machine
   and the real-world sale are known to be out of sync (`api-contract.md`, sales-report section:
   "system status lags the real sale").
6. **Ant Design's detail-page spec is translated from Chinese** and is terse; its distinction
   between "cards" and "tabs" templates is illustrated more than defined. I quoted only the
   sentences that were unambiguous.

---

## 6. Sources

| URL | Authoritative for |
|---|---|
| https://ant.design/docs/spec/detail-page/ | Ant Design's own detail-page ("详情页") layout templates: basic vs cards vs tabs vs steps; information grouping by proximity |
| https://ant.design/components/descriptions | `Descriptions` "When To Use" (detail pages) and responsive `column` config |
| https://ant.design/components/steps | `Steps` "When To Use"; vertical orientation |
| https://ant.design/components/anchor | `Anchor` "When To Use" |
| https://www.nngroup.com/articles/accordions-complex-content/ | When accordions suit / don't suit complex desktop content; multiple-open and state-persistence guidance |
| https://www.nngroup.com/articles/tabs-used-right/ | Conditions for using tabs; the cost of comparing content across tabs |
| https://www.nngroup.com/articles/progressive-disclosure/ | Definition of progressive disclosure; choosing the initial display by frequency of use; the two-level limit |
| https://www.nngroup.com/articles/efficiency-vs-expectations/ | Autosave without a Save button; the "display the word Saved beside each field" mitigation |
| https://www.nngroup.com/articles/web-form-design/ | Single-column form layout; label proximity/placement; removing unnecessary fields |
| https://www.nngroup.com/articles/progress-indicators/ | Wait-time progress feedback thresholds — cited in §3.9 as **not applicable** to lifecycle indicators |
| https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/ | ARIA contract for a disclosure button: `aria-expanded`, `aria-controls`, Enter/Space |
| https://www.w3.org/WAI/ARIA/apg/patterns/accordion/ | ARIA contract for accordions: heading wrapper + `aria-level`, `aria-controls`, panel `role="region"` + `aria-labelledby` |
| https://polaris-react.shopify.com/patterns/resource-details-layout | Primary vs secondary column contents; card grouping; page header scope; 2/3–1/3 width split |
| https://design-system.service.gov.uk/components/summary-list/ | Summary list / check-answers pattern — cited in §3.8 as a **contrast**, not a template for this screen |

**Repo sources:** `CLAUDE.md`; `.claude/rules/frontend-arch.md`; `.claude/rules/api-contract.md`;
`docs/DOMAIN.md`; `docs/SPRINT_PLAN.md:16`; `docs/obsidian/screens/shipment-list-vs-sheet.md`;
`frontend/src/pages/export/ShipmentDetail.tsx`;
`frontend/src/components/shipment/{ShipmentDetailHero,LifecycleStage,DetailFieldRow}.tsx`;
`frontend/src/constants/shipmentEditConfig.ts`; `backend/apps/export/services/phases.py`;
`backend/apps/export/serializers.py`.
