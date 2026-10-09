# Agent market sales (bazaar CRM) — design

**Date:** 2026-10-08
**Status:** design approved in chat, spec awaiting review — NOT implemented
**Branch:** `feat/agent-market` (worktree `D:/projects/yigit_platform-market`)
**Scope:** new Django app `market` + new roles in `core` + `SalesReport` auto-fill in `export` + new frontend section
**Source:** the standalone artifact «Продажа помидоров», studied in full in
[`docs/research/tomato-sales-app-study.md`](../../research/tomato-sales-app-study.md) (formulas, validations, UI texts).
This spec re-uses that study and only records what differs or what the platform adds.

## Problem

A YGT truck arrives at the destination market (KZ / RU) and is sold by our **agent**: a firm already in
the platform as `core.Customer` (linked by `Shipment.customer`). The agent has its own sellers, its own
buyers and its own selling costs. Today all of that is on paper. The sales rep later types **one summary**
per truck into `SalesReport` (kg × price rows, expense rows, rate), so the platform knows nothing about
individual sales, buyer debts, spoilage or which seller sold what.

A standalone artifact already does the selling journal well (boxes / pallets / whole truck, weight minus
tare, debt sales with partial payments, spoilage, per-truck costs, owner panel). It lives outside the
platform, has no link to shipments, no server-side stock check and no analytics.

Goal: agents' sellers record every sale on their phone **inside the platform**; the platform shows profit
per truck, debts and market analytics, and builds `SalesReport` from the journal instead of hand entry.

## Decisions (brainstorm 2026-10-07/08)

| # | Decision |
|---|---|
| Q1 | Goals: profit per truck, debts + management analytics, paper → electronic for the agent's sellers/buyers/costs |
| Q2 | **The agent's sellers type sales themselves**, on a phone at the bazaar → external users of the platform |
| Q3 | Now: one truck = one agent = one seller. Later maybe several sellers per truck — schema keeps "who recorded it" on every entry, no multi-seller logic now |
| Q4 | Agent's pay (commission) is one of the agent's expense lines; goods and money are ours |
| Q5 | **The agent logs in** (artifact's "owner"): sees its trucks, assigns sellers, manages its team, sees its panel |
| Q6 | A truck appears **automatically** from the shipment; the agent may also open it **before** the rep marks arrival — but only from its own shipments list. No trucks without a `Shipment` |
| Q7 | `SalesReport` is **built from the journal**; approval stays as today; manual entry stays only for shipments without a journal |
| Q8 | Phase 1 profit = **sales − agent's expenses**. Our customs / freight / production cost → phase 2 |
| Q9 | First release = all five parts A–E, on a feature branch in a worktree |
| Q10 | New app `market` (not inside `export`) |
| Q11 | New roles `agent`, `agent_seller`; the existing unused `seller` role is not touched |
| Q12 | First sale → `satylyar` automatically. The **lot** closes by itself at 0 boxes left (no close button — Gurban's rule in the artifact chat). `satyldy` is **not** automatic: the agent presses «Отчёт готов» on a closed lot (2026-10-08) |
| Q18 | The "managers" in the artifact chat = our agents (`Customer`); the artifact's owner = YGT side. No separate agent-manager role |
| Q20–21 | Phone part = **separate light app** at `/m/` (second Vite entry, no Ant Design), installable **PWA**, responsive phone / tablet / desktop in the artifact's design; all rules server-side so a React Native app can follow |
| Q19 | The agent **does not sell** (as in the chat): no sales / spoilage / expenses. It sees everything of its customer, assigns sellers, corrects receipt, manages the team, deletes a seller's wrong entry, accepts payments, presses «Отчёт готов». A seller who scans the truck's pallet QR on an unassigned lot is **assigned automatically** |
| Q13 | A debt sale **requires** a buyer |
| Q14 | Excel export in release 1: per-truck table and debts |
| Q15 | `SalesReport.weight_rejected_kg` = loaded − sold (as today). Spoilage from the journal is shown separately in analytics; the rest is shrinkage (усушка) |

## Parts

| Part | Content |
|---|---|
| A | Agent & seller logins, bazaars, roles, permissions, data scoping |
| B | Truck journal: lot per shipment, sales, spoilage, expenses, server stock check, status driving |
| C | Buyers, debt sales, payments with FIFO allocation, payment undo |
| D | Agent panel (phone) + our analytics (desktop) + Excel |
| E | `SalesReport` built from the journal, frozen after approval |

## 1. Dependency position

`core ← greenhouse ← export ← market ← contracts ← finance`

- `market` imports `core` (Customer, User, Country, City) and `export` (Shipment, SalesReport,
  ExpenseCategory, report services). Nothing in `export` / `core` imports `market`.
- `export` learns about the journal only through two **own** fields on `SalesReport`, written by `market`:
  `source` (`manual` | `journal`, default `manual`) and `journal_open` (bool, default false). The manual save
  endpoint refuses line/expense edits when `source = journal` (Kurs and notes stay editable); the approve
  endpoint refuses while `journal_open = true`. This keeps the arrow one-way.
- No Django signals. Everything runs from explicit service calls in `market/services/`.

## 2. Data model (`backend/apps/market/models/`, package with `__init__.py` re-exports)

All money and weight: `DecimalField(max_digits=12, decimal_places=2)`. Weight is kept to 0.01 kg
(the artifact used 0.001; 0.01 is enough for bazaar scales and matches the platform rule).
Text with Cyrillic content: `db_collation='Cyrillic_General_CI_AS'`. Reference FKs: `on_delete=PROTECT`.
No JSONField / ArrayField.

### Bazaar
| Field | Type | Note |
|---|---|---|
| customer | FK `core.Customer` | the agent |
| name | Char(60), Cyrillic collation | unique per customer |
| city | FK `core.City`, null | optional |
| is_active | bool | soft delete |

### AgentMember
| Field | Type | Note |
|---|---|---|
| user | OneToOne `core.User` | role is `agent` or `agent_seller` |
| customer | FK `core.Customer` | which agent this login belongs to |
| bazaar | FK Bazaar, null | sellers only |

### Lot — the truck being sold (one per Shipment)
| Field | Type | Note |
|---|---|---|
| shipment | OneToOne `export.Shipment`, PROTECT | product comes from `shipment.product_type` |
| seller | FK `core.User`, null | must be an `agent_seller` of the same customer |
| boxes_received | int ≥ 1 | default `shipment.box_count`; agent corrects at receipt; never below boxes already used |
| boxes_per_pallet | int ≥ 1 | default `box_count // pallet_count` when both set, else agent enters |
| tare_g | int 0..20000 | weight of one empty box, default 450 |
| default_price_kg | Decimal, null | prefill for the first sale |
| currency | Char(3) | from `shipment.country.currency` at creation; KZT / RUB in release 1 |
| opened_at / opened_by | datetime / FK User | |
| closed_at | datetime, null | set automatically when `left = 0`; cleared automatically when boxes free up |
| reported_at / reported_by | datetime / FK User, null | the agent's «Отчёт готов» |

### Sale
| Field | Type | Note |
|---|---|---|
| lot | FK Lot, PROTECT | |
| unit | Char choices `box` / `pallet` / `truck` | |
| qty | int | boxes, or pallets, or 1 for whole truck |
| boxes | int ≥ 1 | boxes taken off the truck |
| gross_kg | Decimal > 0 | scale weight with boxes, required |
| tare_g | int | copy of `lot.tare_g` at sale time |
| net_kg | Decimal > 0 | `gross_kg − boxes × tare_g / 1000`, quantized 0.01 |
| price_kg | Decimal > 0 | |
| calc_total | Decimal | `round(net_kg × price_kg, 2)` |
| total | Decimal > 0 | = calc_total unless the seller typed another amount |
| paid_on_spot | bool | true = «Оплачено», false = «В долг» |
| buyer | FK Buyer, null | **required when `paid_on_spot = false`** |
| sold_at / created_by | datetime / FK User | `created_by` is what enables multi-seller later |

### Spoilage
| Field | Type | Note |
|---|---|---|
| lot | FK Lot | |
| boxes | int ≥ 0 | |
| gross_kg | Decimal, null | optional |
| tare_g | int | copy |
| net_kg | Decimal ≥ 0 | 0 when no weight |
| recorded_at / created_by | | |
At least one of `boxes > 0` or `gross_kg > 0`.

### LotExpense
| Field | Type | Note |
|---|---|---|
| lot | FK Lot | allowed after close too |
| category | FK `export.ExpenseCategory`, PROTECT | existing reference table |
| label | Char(40), Cyrillic collation, blank | required for the "other" category |
| amount | Decimal > 0 | in lot currency |
| recorded_at / created_by | | |

Category mapping from the artifact: Комиссия → existing `INTERES`, Простой → existing `PROSTOY`.
Added by data migration if missing: Кара, Плёнка, Заезд, Парковка, and an "other" code (reuse one if it
already exists). Names in `name_ru` / `name_tk` / `name_en`.

### Buyer
| Field | Type | Note |
|---|---|---|
| customer | FK `core.Customer` | buyers belong to the agent, not the seller |
| name | Char(60), Cyrillic collation | unique per customer (CI collation makes it case-insensitive) |
| phone | Char(30), blank | |

### Payment / PaymentAllocation
| Model | Fields |
|---|---|
| Payment | buyer FK, amount Decimal > 0, currency Char(3), paid_at, created_by |
| PaymentAllocation | payment FK (CASCADE), sale FK (PROTECT), amount Decimal > 0 |

Derived, never stored: `due(sale) = 0 if paid_on_spot else total − Σ allocations`.
No stored per-lot totals: all lot / panel / analytics numbers are DB aggregates. The only stored rollup is
`SalesReport` (part E).

## 3. Roles, permissions, scoping (part A)

- `ROLE_CHOICES` += `agent` («Агент»), `agent_seller` («Продавец агента»). Follow the full role touch list
  (garawul spec `2026-09-29-garawul-gate-design.md` §1.6/§2.3): choices AlterField migrations, seed +
  **data migration** for page/resource rows (prod runs `migrate`, not seed — pattern `core/0067`),
  `seed_test_users.py`, comments `_VALID_ROLES`, Sheet `WHO_TO_ROLE` etc., FE `constants/roles.ts`,
  `types/index.ts`, i18n ×3, `roleColors.ts`, `UsersPage.tsx`, `StaffPageAccessPage.tsx`,
  `TaskCardEditor.helpers.ts`, hardcoded role tuples in views.
- New roles get **no** existing pages (all seeded `is_visible=False`) except the new market pages.
- Pages (dotted, like `export.gate`): `market.home` (phone shell), `market.team` (agent), `market.agents`
  (desktop agent logins), later `market.panel` (agent) and `market.analytics` (desktop). Resources:
  `market_agent`, `market_team`, later `market_lot`, `market_sale`, `market_payment`.
- External roles are fenced in `CookieJWTAuthentication`: they may call only `/api/v1/auth/` and
  `/api/v1/market/` (403 elsewhere), so a view with loose read permissions cannot leak internal data.

| Who | Sees | Writes |
|---|---|---|
| `agent_seller` | lots where `seller = me` | sales, spoilage, expenses, payments on own lots; buyers of own customer; claims an unassigned lot by QR (§4) |
| `agent` | all lots / buyers / payments of `member.customer` | **no selling** (no sale / spoilage / expense create). Assign seller, edit lot receipt fields, delete a wrong entry, accept / undo payments, «Отчёт готов», team (bazaars, seller logins) |
| `sales_rep` | lots of customers where `Customer.sales_rep = me` | read only |
| `boss`, `admin`, `export_manager`, `director` | everything | read only (admin also manages agent logins) |

- Scoping is enforced in every market queryset (list **and** detail — unlike the shipment detail routes,
  which are deliberately unscoped). External users must never reach export endpoints: they have no export
  page/resource grants, and the shipment list scoping does not include them.
- Agent logins are created by admin / sales rep (user + `AgentMember`). Seller logins are created by the
  agent on its team screen: username, password, full name, bazaar; deactivate = `is_active=False`;
  password reset by the agent. Auth is the existing httpOnly-cookie JWT.

## 4. Lot lifecycle and shipment status (part B)

**Which shipments an agent sees:** `shipment.customer = member.customer`, status phase TRANSIT, BORDER or
DEST (from `yola_chykdy` onward), plus their closed lots for history. Sorted: arrived first, then in transit.

**Lot creation:** on first open by the agent, or by a seller scanning the truck's QR (get-or-create in a
service, inside a transaction, shipment row locked). No signal, no batch job.

**QR claim (Q19)** — reuse the existing pallet label (`docs/obsidian/processes/pallet-qr-scan.md`): it
encodes `{base}/scan/{shipment id}`, so no new QR is printed.
- `/scan/:id` checks the role first: `agent_seller` / `agent` go to the market lot screen; every other role
  keeps today's scan page. The export scan endpoint is never called for market roles (they have no
  `shipment.can_view`).
- Seller scans a shipment of **its own customer**: lot created if missing; if `lot.seller` is empty it becomes
  this seller (audited); if it is this seller, the lot just opens; if it is another seller →
  403 «Машина назначена другому продавцу».
- Shipment of another customer → 404 (do not reveal it exists).
- The agent can still reassign the seller at any time.

**Status driving (Q12)** — through the existing operator-entered lifecycle fields, which `Shipment.save()`
→ `auto_advance_if_ready` turns into `transition_to()` calls (status is never written directly).
Writing these fields from a service is allowed: AD-1 is retired — `docs/ADR.md` ADR-010 "2026-05 amendment"
makes all eight lifecycle timestamps, incl. `arrived_at`, `sale_started_at`, `sale_ended_at`,
operator-entered; `transition_to()` no longer stamps any of them.
- first sale on a lot → set `arrived_at` if empty and `sale_started_at` if empty → cascade to `satylyar`;
- **Lot close is automatic** (artifact rule: no close button): the write that makes `left = 0` sets
  `closed_at` and hides the sell form; deleting an entry or raising `boxes_received` clears it again.
  Closing the lot does **not** touch the shipment status.
- `satyldy` is the **agent's action**: on a closed lot the agent presses «Отчёт готов» → set `reported_at`
  and `sale_ended_at` → `satyldy`, and the report is built (§7). Refused (400 «Сначала продайте или
  спишите остаток: N ящиков») while `left > 0`. A closed but unreported lot shows «Всё продано — нажмите
  «Отчёт готов»».
- **Verify during implementation:** from statuses 4–8 the cascade may stop on steps that need other
  fields (e.g. the transshipment question), and `bardy → satylyar` also needs `city` filled on the Sheet
  (pallet-qr-scan doc). If so the journal still works and the rep finishes those steps;
  write a test that pins down the exact behaviour for a lot opened at `barysh_gumrugi`.
- After «Отчёт готов» sales and spoilage stay deletable only while the report is not approved (to fix a
  mistake). A delete that frees boxes reopens the lot and sets `SalesReport.journal_open = true` (§7), so the
  stale report cannot be approved; the shipment status is **not** moved back. When the lot closes again the
  agent presses «Отчёт готов» again: the report is rebuilt, `journal_open` cleared, `sale_ended_at`
  overwritten. Expenses stay allowed until approval.

**Journal rules** (formulas exactly as the study §4, with Decimal):
- `used = Σ sale.boxes + Σ spoilage.boxes`; `left = boxes_received − used`.
- Every sale / spoilage create locks the lot row (`select_for_update`) and rejects `boxes > left`
  (400 with a Russian message). Two sellers at once cannot oversell.
- pallet: `boxes = qty × boxes_per_pallet`, `qty ≤ left // boxes_per_pallet`. truck: `boxes = left`.
- Sale validations: `gross_kg` required; `net_kg > 0`; `price_kg > 0`; `buyer` required for debt.
- Correction = delete + re-enter (author or agent), plus the 7-second «Отменить» toast which calls delete.
- No create / delete of sales or spoilage after the lot's `SalesReport` is approved. Payments stay allowed.
- Market writes are **exempt** from the season-close freeze (`SeasonNotClosed`): a truck may still be selling
  after the season closes (user decision 2026-10-08). List the market endpoints in `tests_season_optout.py`.
  Reads still use `SeasonScopedMixin` with `season_field='shipment__season'`.

## 5. Debts and payments (part C)

- Buyer picker in the sale form: autocomplete over the agent's buyers; a new name creates the buyer.
- «Принять оплату» on a buyer: amount prefilled with the full debt in one currency, capped at the debt
  ("Это больше долга. Запишу X."). Allocation is FIFO over the buyer's unpaid sales by `sold_at`, across all
  lots of the agent, in one transaction (`select_for_update` on those sales).
- Undo / delete payment = delete the `Payment`; allocations cascade; debts come back. (The artifact could
  not undo «Отметить оплату»; the platform can.)
- «Отметить оплату» on a single sale = a payment of exactly that sale's due, allocated to it.
- KZT and RUB are never summed.

## 6. Panels, analytics, Excel (part D)

**Agent panel** (phone, agent role) — as the study §3.9 minus managers and demo: period today / yesterday /
7 days; KPIs after-costs, sales, costs, net kg, avg price, buyer debt, boxes left, spoilage; seller cards
with last-entry status and their open lots; lots on sale oldest first with "N-й день"; top debtors.

**Our analytics** (desktop page in `AppLayout`, sales_rep scoped to own customers):
1. Per lot: shipment code, agent, product, kg loaded (`shipment.weight_net`) / sold / spoiled / shrinkage
   (loaded − sold − spoiled), sales, agent expenses, **profit = sales − expenses**, avg price, debt left,
   days on sale.
2. Agent ranking for the period: profit, avg price, loss %, days to sell out.
3. Prices: avg price per kg by city / bazaar per day.
4. Debts by agent and buyer, aged 0–7 / 8–30 / 30+ days.
- Filters: period, agent, country, product. Charts with the existing ECharts setup.
- Money is shown in local currency, KZT and RUB in separate blocks. USD only for lots whose `SalesReport`
  is approved (the rate is set at approval).
- Day boundaries: KZ `Asia/Almaty`, RU `Europe/Moscow` (mapping by country code in one helper).
- Excel (`openpyxl`, already a dependency): per-lot table and debts, same filters, `?format=xlsx`.

## 7. SalesReport from the journal (part E)

Service `market.services.report.build_sales_report(lot, user)` runs when the agent presses «Отчёт готов»
and again on every journal write to a reported lot whose report is not approved:
- `source = journal`, `journal_open = lot is open`, `currency = lot.currency`, `weight_loaded_kg = shipment.weight_net`,
  `weight_sold_kg = Σ sale.net_kg`, `weight_rejected_kg = loaded − sold` (Q15).
- Line items: sales grouped by `price_kg` → one row per price (`quantity_kg = Σ net_kg`,
  `amount_local = Σ total`). Manual totals that differ from the formula stay in `amount_local`.
- Expenses: one row per category (`Σ amount`, label for "other").
- Totals via the existing `_recompute_totals` logic (reuse the export service, do not duplicate it).
- After building, call `export.services.task_rules.close_sales_report_task(shipment, user)` exactly like the
  manual save does — otherwise the rep's «Hasabat doldur» task never closes.
- Rate (Kurs), notes and approval stay manual through the existing endpoints. After approval the lot
  journal is frozen (§4).
- Manual `SalesReport` entry is unchanged for shipments without a lot.
- Created rows: `SalesReportLineItem` / `SalesReportExpense` one by one or with `batch_size=500`; mind the
  mixed None/Decimal MSSQL rule (`.claude/rules/mssql-compat.md`).

## 8. API (`/api/v1/market/…`, field names per `api-contract` skill — check it before writing serializers)

| Endpoint | Purpose |
|---|---|
| `GET lots/` · `GET lots/{id}/` | scoped lists (open / closed / in transit), lot detail with computed totals |
| `POST lots/open/` `{shipment_id}` | get-or-create the lot; a seller calling it on an unassigned lot claims it (QR) |
| `PATCH lots/{id}/` | agent: seller, boxes_received, boxes_per_pallet, tare_g, default_price_kg |
| `POST/DELETE lots/{id}/sales/` | sale create / delete |
| `POST/DELETE lots/{id}/spoilage/` | spoilage create / delete |
| `POST/DELETE lots/{id}/expenses/` | batch create (one sheet = several rows) / delete |
| `GET/POST buyers/` | autocomplete + create |
| `GET debts/` · `POST payments/` · `DELETE payments/{id}/` | debts grouped by buyer and currency; FIFO payment; undo |
| `GET/POST/PATCH team/bazaars/`, `team/sellers/` | agent team screen |
| `GET/POST/PATCH agents/` | admin / sales rep: create an agent login (user + `AgentMember`) for a Customer |
| `GET panel/?period=` | agent panel aggregates |
| `GET analytics/lots|agents|prices|debts/?…&format=xlsx` | our analytics + Excel |

All writes accept the existing idempotency key header (phones on bad networks retry).

## 9. Frontend

- **Separate market app** (user decision 2026-10-08): a second Vite entry in the same `frontend/` project —
  `frontend/m.html` + `src/market-app/` — built as its own light bundle (**no Ant Design**), served at `/m/`
  on the same origin (same cookie login, no CORS). It reuses `services/api.ts`, i18n and types. Its own
  login screen `/m/login`; a 401 inside `/m/` goes there, not to the main `/login`.
  Screens: lots list, lot screen with the sell form, spoilage, expenses sheet, debts, payment sheet; agent
  also gets team and panel. The agent's lot screen has no sell form.
- The main app never renders for external roles: an `ExternalRoleGate` around `AppLayout` and the main
  login send them to `/m/` with a full page load. The existing pallet label opens `/scan/{id}` in the main
  app; for external roles that route forwards to `/m/scan/{id}` (QR claim, §4).
- **PWA:** `public/m/manifest.webmanifest` (`name` «YGT Продажа», `start_url`/`scope` `/m/`,
  `display: standalone`, PNG icons 192/512 + maskable, `apple-touch-icon` for iPhone) and a minimal
  service worker `public/m/sw.js` (scope `/m/`) with **no caching** — online-only, it exists only so Android
  offers «Установить». Requires HTTPS (beta has it).
- **Design = the artifact** (study §7): its colour tokens (tomato red, vine green, crate amber, light + dark
  via `prefers-color-scheme`), Sofia Sans / Sofia Sans Condensed, 64–76 px targets, stepper, live thousands
  spacing, price remembered from the last sale, sheets pinned to the top so the keyboard does not cover them,
  undo toasts, truck drawing with pallets, Russian plurals.
- **Responsive like the artifact:** phone 1 column; lists 2 columns from 760 px, 3 from 1100 px; container
  ≤ 1200 px; lot screen two columns from 1000 px (form left, totals + list right); sell form fields side by
  side from a 520 px container (iPad); 16 px side gutter, no horizontal scroll.
- **Ready for a React Native app later:** every rule (stock, net weight, debts, FIFO, lot close) is decided
  by the server; the phone only previews numbers. A native app reuses the same `/api/v1/market/` API; it
  will need a token login instead of the cookie (ADR-009 "Mobile CRM will need separate token flow") — not
  built now.
- Texts in `src/i18n/{ru,tk,en}.json`; Russian is the agents' language. Shipment wording rule: never the
  word "draft" in UI.
- **Desktop page** «Продажи агентов» inside `AppLayout` for our roles (analytics + Excel buttons).
- Agent logins: admin / sales rep create them on a small «Логины агентов» tab of the desktop page
  (`agents/` endpoint), not on the generic Users page.

## 10. Rollout

- Branch `feat/agent-market` in its own worktree; one commit per logical unit; merge only on the user's
  word.
- Migrations: `core`: role choices + permission data migration. `export`: `SalesReport.source` and
  `journal_open` (NOT NULL **with DB defaults** `'manual'` / false — beta runs old code on the same DB).
  `market/0001` + category data migration.
- **The local DB is shared with main and beta.** While the branch lives, its migrations are **not** applied to
  the shared DB: tests run on a private test DB (`TEST_DB_NAME=… --noinput`). The usual "apply migrations
  yourself" habit does not apply on this branch. Migrations are applied only at merge time.
- At merge: re-check numbers against main (`ls migrations | tail -3`, `git log origin/main`); renumber only the
  branch's **unapplied** migrations, or add a `--merge` migration.
- After merge, and again after the beta deploy, re-run the permission seed: a permissions-page Save from code
  that does not know the `market_*` page codes deletes their rows (the `tir_takip` incident, 2026-09-16).
- Docs: `docs/obsidian/` module + roles notes, `CHANGELOG.md`, `BUILD_TEST_LOG.md`, `api-contract` skill.

## 11. Testing (TDD, backend first)

- Oversell rejected, including two concurrent sale requests on one lot.
- pallet / truck / spoilage box arithmetic; net-weight and tare validations; debt sale without buyer → 400.
- FIFO allocation across lots; capped overpayment; payment delete restores debts.
- QR claim: unassigned → assigned to the scanner; own → opens; other seller's → 403; other customer → 404.
- Agent cannot create sales / spoilage / expenses (403) but can delete them and take payments.
- Scoping: seller sees only own lots; agent only its customer; sales_rep only own customers; external roles
  get 403 on export endpoints.
- First sale sets `arrived_at` / `sale_started_at` and the status advances through `transition_to`
  (incl. a lot opened at `barysh_gumrugi`); `left = 0` closes the lot but does **not** set `satyldy`;
  «Отчёт готов» does and is refused while `left > 0`; a delete after it reopens the lot, keeps the status
  and blocks approval.
- `build_sales_report` output; rebuild after a late expense; frozen after approval; manual endpoint refuses
  line edits when `source = journal`; approve refused after a reopen (`journal_open`); the «Hasabat doldur»
  task closes.
- After the role changes: run `TestEveryRoleCanEditItsOwnSheetRow` (real seed data, every role).
- Frontend: vitest for the sell form maths and the payment sheet. Browser checks only after hours (shared DB).

## 12. Out of scope (phase 2+)

Our customs / freight / production cost in profit; several sellers per truck (logic); agent managers;
offline mode; a new market QR (the existing pallet label is reused); editing a saved sale; goods not shipped by YGT; USD before approval; currencies
other than KZT / RUB in the UI.

## 13. Open items

1. «Кара» — kept as a category named «Кара» (user OK 2026-10-08).
2. Season freeze — resolved: market writes exempt (§4).
3. Reopening — resolved: lot reopens by itself; status stays; report approval blocked until the next
   «Отчёт готов» (§4).
4. «Отчёт готов» with boxes left — resolved: refused (400) until `left = 0` (user 2026-10-08).
