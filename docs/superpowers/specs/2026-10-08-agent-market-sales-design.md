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
| Q12 | The journal drives shipment status: first sale → `satylyar`, truck sold out → `satyldy` |
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
- `export` learns about the journal only through its **own** field `SalesReport.source`
  (`manual` | `journal`, default `manual`), written by `market`. The manual save endpoint refuses line/expense
  edits when `source = journal` (Kurs, notes and approval stay editable). This keeps the arrow one-way.
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
| closed_at | datetime, null | set when sold out; cleared on reopen |

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
- Pages: `market_home` (phone shell), `market_team` (agent), `market_panel` (agent),
  `market_analytics` (desktop). Resources: `market_lot`, `market_sale`, `market_payment`, `market_team`.

| Who | Sees | Writes |
|---|---|---|
| `agent_seller` | lots where `seller = me` | sales, spoilage, expenses, payments on own lots; buyers of own customer |
| `agent` | all lots / buyers / payments of `member.customer` | everything the seller can + assign seller, edit lot receipt fields, team (bazaars, seller logins) |
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

**Lot creation:** on first open by the agent or seller (get-or-create in a service, inside a transaction).
No signal, no batch job.

**Status driving (Q12)** — through the existing operator-entered lifecycle fields, which `Shipment.save()`
→ `auto_advance_if_ready` turns into `transition_to()` calls (status is never written directly):
- first sale on a lot → set `arrived_at` if empty and `sale_started_at` if empty → cascade to `satylyar`;
- lot sold out (`used ≥ boxes_received`) → set `closed_at` and `sale_ended_at` → `satyldy`.
- **Verify during implementation:** from statuses 4–8 the cascade may stop on steps that need other
  fields (e.g. the transshipment question). If so the journal still works and the rep finishes those steps;
  write a test that pins down the exact behaviour for a lot opened at `barysh_gumrugi`.
- Reopen (an entry deleted on a closed lot, or `boxes_received` raised) clears `lot.closed_at`; it does
  **not** move the shipment status back. The next sell-out overwrites `sale_ended_at`.

**Journal rules** (formulas exactly as the study §4, with Decimal):
- `used = Σ sale.boxes + Σ spoilage.boxes`; `left = boxes_received − used`.
- Every sale / spoilage create locks the lot row (`select_for_update`) and rejects `boxes > left`
  (400 with a Russian message). Two sellers at once cannot oversell.
- pallet: `boxes = qty × boxes_per_pallet`, `qty ≤ left // boxes_per_pallet`. truck: `boxes = left`.
- Sale validations: `gross_kg` required; `net_kg > 0`; `price_kg > 0`; `buyer` required for debt.
- Correction = delete + re-enter (author or agent), plus the 7-second «Отменить» toast which calls delete.
- No create / delete of sales or spoilage after the lot's `SalesReport` is approved. Payments stay allowed.
- Writes go through `SeasonNotClosed` like every shipment child (see open item 2).

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

Service `market.services.report.build_sales_report(lot)` runs when the lot closes and again on every
journal write to a closed lot while the report is not approved:
- `source = journal`, `currency = lot.currency`, `weight_loaded_kg = shipment.weight_net`,
  `weight_sold_kg = Σ sale.net_kg`, `weight_rejected_kg = loaded − sold` (Q15).
- Line items: sales grouped by `price_kg` → one row per price (`quantity_kg = Σ net_kg`,
  `amount_local = Σ total`). Manual totals that differ from the formula stay in `amount_local`.
- Expenses: one row per category (`Σ amount`, label for "other").
- Totals via the existing `_recompute_totals` logic (reuse the export service, do not duplicate it).
- Rate (Kurs), notes and approval stay manual through the existing endpoints. After approval the lot
  journal is frozen (§4).
- Manual `SalesReport` entry is unchanged for shipments without a lot.
- Created rows: `SalesReportLineItem` / `SalesReportExpense` one by one or with `batch_size=500`; mind the
  mixed None/Decimal MSSQL rule (`.claude/rules/mssql-compat.md`).

## 8. API (`/api/v1/market/…`, field names per `api-contract` skill — check it before writing serializers)

| Endpoint | Purpose |
|---|---|
| `GET lots/` · `GET lots/{id}/` | scoped lists (open / closed / in transit), lot detail with computed totals |
| `POST lots/open/` `{shipment_id}` | get-or-create the lot |
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

- **Phone shell `/m`** outside `AppLayout`, like `/scan/:id` (`App.tsx`, `pages/scan/ScanPage.tsx`):
  lots list, lot screen with the sell form, spoilage, expenses sheet, debts, payment sheet; agent also gets
  team and panel. `IndexRoute` sends `agent` / `agent_seller` to `/m`.
- Follow the artifact's UX (study §7): 64–76 px targets, stepper, live thousands spacing, price remembered
  from the last sale, sheets pinned to the top so the keyboard does not cover them, undo toasts, truck
  drawing with pallets, Russian plurals.
- Texts in `src/i18n/{ru,tk,en}.json`; Russian is the agents' language. Shipment wording rule: never the
  word "draft" in UI.
- **Desktop page** «Продажи агентов» inside `AppLayout` for our roles (analytics + Excel buttons).
- Agent logins: admin / sales rep create them on a small «Логины агентов» tab of the desktop page
  (`agents/` endpoint), not on the generic Users page.

## 10. Rollout

- Branch `feat/agent-market` in its own worktree; one commit per logical unit; merge only on the user's
  word.
- Migrations: check numbers are free right before writing (parallel sessions). `core`: role choices +
  permission data migration. `export`: `SalesReport.source` (NOT NULL **with a DB default** `'manual'` —
  beta runs old code on the same DB). `market/0001` + category data migration.
- Docs: `docs/obsidian/` module + roles notes, `CHANGELOG.md`, `BUILD_TEST_LOG.md`, `api-contract` skill.

## 11. Testing (TDD, backend first)

- Oversell rejected, including two concurrent sale requests on one lot.
- pallet / truck / spoilage box arithmetic; net-weight and tare validations; debt sale without buyer → 400.
- FIFO allocation across lots; capped overpayment; payment delete restores debts.
- Scoping: seller sees only own lots; agent only its customer; sales_rep only own customers; external roles
  get 403 on export endpoints.
- First sale / sell-out set the lifecycle fields and the status advances through `transition_to`
  (incl. a lot opened at `barysh_gumrugi`).
- `build_sales_report` output; rebuild after a late expense; frozen after approval; manual endpoint refuses
  line edits when `source = journal`.
- After the role changes: run `TestEveryRoleCanEditItsOwnSheetRow` (real seed data, every role).
- Frontend: vitest for the sell form maths and the payment sheet. Browser checks only after hours (shared DB).

## 12. Out of scope (phase 2+)

Our customs / freight / production cost in profit; several sellers per truck (logic); agent managers;
offline mode; QR codes; editing a saved sale; goods not shipped by YGT; USD before approval; currencies
other than KZT / RUB in the UI.

## 13. Open items

1. «Кара» — meaning unknown; added as a category named «Кара» until the user explains.
2. Season close freezes market writes (`SeasonNotClosed`). A truck still selling when the season is closed
   would be blocked — confirm with the user whether market writes should be exempt.
3. Reopening a lot does not move the shipment status back from `satyldy` (§4).
