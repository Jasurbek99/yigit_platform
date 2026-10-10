---
title: Agent Market (Parts A–C)
tags: [process, backend, frontend, market, agent, pwa]
related: [[../roles/agent]], [[../roles/agent-seller]], [[permissions-system]], [[authentication]]
---

# Agent Market (Parts A–C)

Bazaar sales for outside agents (customers) and their sellers. Spec: `docs/superpowers/specs/2026-10-08-agent-market-sales-design.md`. Plans: `docs/superpowers/plans/2026-10-08-agent-market-a-foundation.md` (Part A, branch `feat/agent-market`) and `docs/superpowers/plans/2026-10-09-agent-market-b-lots-sales.md` (Part B, branch `feat/agent-market-b`) and `docs/superpowers/plans/2026-10-10-agent-market-c-payments-debts.md` (Part C, branch `feat/agent-market-c`).

## What Part A does

- Two external roles, `agent` and `agent_seller` (see [[../roles/agent]], [[../roles/agent-seller]]).
- A **fence**: external roles reach only `/api/v1/auth/` and `/api/v1/market/` (below).
- Our staff create **agent logins** on the desktop page `/market/agents`.
- A separate phone app at `/m/` (second Vite entry `m.html`, `src/market-app/`): own login `/m/login`, Russian by default, no antd, installable as a PWA. Screens: home (placeholder «Машин пока нет») and «Команда» (agent only: bazaars + seller logins).

Part B (lots, sales, spoilage, expenses, status driving, QR claim, phone screens) is described under «Part B» below.

**Not built yet (Parts C–E):** payments / FIFO allocation / debts screen (C); agent panel, our analytics, Excel (D); «Отчёт готов», SalesReport build, `journal_open` (E).

## The fence

External roles (`EXTERNAL_ROLES = {agent, agent_seller}` in `apps/core/models/user.py`) are cut off from the rest of the platform in two places:

1. **REST** — `CookieJWTAuthentication.authenticate` (`apps/core/authentication.py`) raises 403 when the user's role is external and `request.path` does not start with `/api/v1/auth/` or `/api/v1/market/` (`EXTERNAL_ALLOWED_PREFIXES`). Fail-closed on the path.
2. **WebSocket** — `AppConsumer.connect` (`apps/core/consumers.py`) closes with code **4403** for external roles before `accept()` (4401 stays "not authenticated"). A future consumer must repeat the check.

Frontend mirror (UX only): `ExternalRoleGate` wraps the main app and sends external roles to `/m/`; the main `LoginPage` does the same after login (before any `?next=`). The market login sends non-external users to `/`.

## Pages, resources, grants

New page codes: `market.home`, `market.team` (phone shell), `market.agents` (desktop, staff). New resources: `market_agent` (agent logins), `market_team` (bazaars + seller logins). Seeded by `seed_permissions` and data migration `core/0076_seed_agent_market_perms`.

| Role | Pages | Resources |
|------|-------|-----------|
| `agent` | `market.home`, `market.team` (nothing else, not even the universal pages) | `market_team` VCRUD |
| `agent_seller` | `market.home` | `market_team` all-denied row |
| `sales_rep` | + `market.agents` | `market_agent` view / create / edit |
| `admin` | every page except the phone pages (`market.home` / `market.team` subtracted; `market.agents` visible) | full CRUD on both |
| `boss`, `director`, `export_manager`, `document_team` | `market.agents` (phone pages subtracted) | view only (spec §3; boss too, unlike his usual full CRUD) |
| everyone else | none | none |

Why `agent_seller` has an explicit all-denied `market_team` row: the admin matrix GET builds from existing rows and PUT rejects a matrix missing any role, so a role with zero resource rows would break `/admin/permissions` Save for everyone.

External roles are also kept out of the Fleet Map and Tır Takip every-role loops. See [[permissions-system#External roles and the fence (agent market, 2026-10)]].

## Data

App `market` (migration `market/0001_initial`, depends on `core/0076`):

- `Bazaar` — `customer` FK (PROTECT), `name` (unique per customer, Cyrillic collation), `city` FK (nullable), `is_active`. Table `market_bazaars`.
- `AgentMember` — `user` 1:1, `customer` FK (PROTECT), `bazaar` FK (nullable, sellers only). Table `market_agent_members`.
- `apps/market/services/` (views only call these): `build_me_payload(user)` (`/me/` body), `own_team_customer(user)` (team writes: only the agent itself, else `MarketAccessError`), `check_customer_in_scope(user, customer)` (agent-login create: a sales rep only for his own customers). `RussianMixin` turns `MarketAccessError` into a 403 with its Russian message.
- `apps/market/serializers/logins.py`: `LoginSerializerMixin`, shared by agent and seller logins (username read-only on update, password rules, `set_password` on create / update).
- `apps/market/scoping.py`: `customer_ids_for(user)` — agent / seller: own customer; `sales_rep`: customers where he is the rep; admin / boss / director / export_manager / document_team / superuser: `None` (all); others: none. `member_of(user)`.

## Endpoints (`/api/v1/market/`)

Shapes are in the `api-contract` skill. Part C adds `GET /debts/`, `POST /payments/`, `DELETE /payments/{id}/`, `POST /sales/{id}/mark-paid/`.

- `GET|POST|PATCH /agents/` — agent logins (staff; scoped by `customer_ids_for`; resource `market_agent`).
- `GET|POST|PATCH /team/bazaars/`, `/team/sellers/` — resource `market_team`. Reads scoped; **writes only by the agent himself** (staff get 403 on write).
- `GET /me/` — role, username, first name, customer, bazaar of the caller (the `/m/` header reads its name from here).

## Rules and gotchas

- **Agent logins are created only via `/market/agents/`** (the desktop page), not on the Users page — only that path creates the `AgentMember` row. An agent login with no `AgentMember` sees nothing.
- `core` cannot import `market`, so `seed_test_users` cannot make agent test logins; add a `market` management command in Part B if needed.
- **Branch migrations (core 0075 / 0076, export 0099, market 0001) are NOT applied to the shared DB until the branch is merged.** Beta runs old code on the same DB.
- After merge **and** after the beta deploy, re-run the permission seed (`seed_permissions` only creates missing rows).
- **Passwords are never trimmed and never start or end with a space.** Login (`LoginSerializer`) trims what it receives, so a stored password with a phone keyboard's trailing space could never be typed back. `/market/agents/` and `/market/team/sellers/` reject such a password with 400 (`apps/market/passwords.py`), and the `/m/` inputs turn off autocorrect / autocapitalise / spellcheck.
- **Login changes are audited** in `AuditLog` via `create_audit_entry` (`model_name` `AgentLogin` / `SellerLogin`, actions `create` / `update`): login created, `password reset`, `is_active → True|False`. The password itself is never logged.
- **Market responses are Russian.** `LANGUAGE_CODE` is `tk` and there is no `LocaleMiddleware`, so every market view inherits `RussianMixin` (`apps/market/views/base.py`, `translation.override('ru')` around `dispatch`, Http404 → DRF `NotFound`). Our own messages are written in Russian in code (no `locale/` catalog).
- **A password change does not end the old phone session**: the access token lives up to 8 h. To cut access at once, disable the login (both «Сменить пароль» sheets say so).
- Staff rosters skip `EXTERNAL_ROLES`: @mention autocomplete (users and roles), team KPI and the worklog team list; frontend role pickers use `STAFF_ROLE_CHOICES`.
- Every reference list an agent's phone needs (expense categories, buyers, the agent's trucks) is served under `/api/v1/market/` (Part B) — everything else stays behind the fence.

## Part B — lots, sales, spoilage, expenses

Spec: `docs/superpowers/specs/2026-10-08-agent-market-sales-design.md`. Code: `backend/apps/market/` (`models/lots.py`, `services/{lots,entries,status,totals,reference}.py`, `serializers/{lots,entries}.py`, `views/{lots,entries}.py`), phone UI `frontend/src/market-app/`. Endpoint shapes: `api-contract` skill, «Agent market: Part B».

### Data (migrations `market/0002`–`0004`, `core/0077`)

- `Lot` — one per shipment (`shipment` 1:1, related name `market_lot`): `seller` (nullable User), `boxes_received`, `boxes_per_pallet`, `tare_g` (default 450), `default_price_kg`, `currency`, `opened_at` / `opened_by`, `closed_at`, `receipt_confirmed`.
- `Buyer` — per customer (agent), name unique per customer, case-insensitive. Used by debt sales.
- `Sale` (`unit` box / pallet / truck, `qty`, `boxes`, `gross_kg`, `tare_g`, `net_kg`, `price_kg`, `calc_total`, `total`, `paid_on_spot`, `buyer`), `Spoilage` (`boxes`, `gross_kg`, `tare_g`, `net_kg`), `LotExpense` (`category`, `label`, `amount`). The tare is copied onto each entry, so a later tare change does not rewrite history.
- `market/0003_market_expense_categories` get-or-creates four `ExpenseCategory` rows (`KARA`, `PLYONKA`, `ZAEZD`, `PARKOVKA`). Its reverse deletes them: roll back **only before use** (ProtectedError once an expense uses one).
- `market/0004_lot_receipt_confirmed` adds `Lot.receipt_confirmed`. No DB-level DEFAULT: the market lot tables are new in Part B and beta runs Part A code that never inserts into them.
- `core/0077_market_lot_resource` seeds the `market_lot` grants (frozen snapshot, test DBs skipped, reversible).

### Which trucks, which lots

- Trucks an agent may open: his customer's live shipments in `yola_chykdy`, `serhet_gechdi`, `dest_entry`, `barysh_gumrugi`, `transshipment`, `bardy`, `satylyar`, `satyldy` (`VISIBLE_STATUS_CODES`). Drafts and earlier statuses are invisible (404).
- **The lots lists are not season-scoped.** A lot is sold off whatever the season; a closed season does not hide it.
- `lots_for(user)`: a seller sees only the lots assigned to him; an agent every lot of his customer; staff the lots of the customers `customer_ids_for` gives them.

### Lot lifecycle

1. **Open.** The agent opens a truck from «В пути и прибывшие» (`POST /market/lots/open/`, 201 created / 200 already open). Defaults come from the shipment: `boxes_received = box_count`, `boxes_per_pallet = box_count // pallet_count` (at least 1; 1 without a pallet count), currency from the destination country (else `KZT`).
2. **Receipt.** A shipment with no box count opens with a placeholder of 1 box, one with no pallet count with 1 box per pallet; either way `receipt_confirmed = false`, so `needs_receipt = true`. The agent sets the real values in «Приёмка» (`PATCH`); any PATCH that sends `boxes_received` or `boxes_per_pallet` sets `receipt_confirmed = true`, even when it repeats the placeholder. `needs_receipt` is a **stored flag**: expenses and later `shipment.box_count` edits do not change it. While it is true the seller sees the card «Пусть агент укажет, сколько ящиков пришло.» instead of the sell form, and the server refuses sales and spoilage with that message.
3. **Claim by QR.** The seller scans the pallet QR (`/scan/{id}`, the same QR staff use). The main app's `ScanPage` forwards `agent` / `agent_seller` to `/m/scan/{id}`; a logged-out seller goes to the main login with `?next=/scan/{id}`, and after login `LoginPage` sends an external role to `/m/scan/{id}` (any other `next` still means `/m/`); the market login also keeps `?next=/m/scan/{id}`. `/m/scan/{id}` calls `POST open/`: an unassigned lot becomes his, his own lot opens, another seller's lot answers 403 «Машина назначена другому продавцу.»; a seller of another agent gets 404. The agent can also assign or clear the seller (`seller_id`, an active seller of his own customer only: «Такого продавца у агента нет.»).
4. **Auto close / reopen.** `refresh_closed` runs after every sale / spoilage create or delete and after a receipt PATCH: `left = boxes_received − sold − spoiled`; `left <= 0` sets `closed_at`, freeing boxes (a delete, or a higher `boxes_received`) clears it. Raising `boxes_received` is the only way to reopen an undercounted truck, so the **agent controls stay on a closed lot**.
5. **Receipt rules.** `boxes_received ≥ 1` («Не меньше 1.») and not below what is already used («Уже продано или списано: N ящиков. Меньше поставить нельзя.»); `tare_g` 0..20000 («От 0 до 20000 г.»); `default_price_kg ≥ 0`.

### Stock lock

Every sale / spoilage / expense create and every delete runs in `transaction.atomic()`: scope check, **row lock on the lot** (`select_for_update`, plain pk lookup, no joins), then `left` is read **after** the lock. Two phones selling the last boxes at once: the second waits, reads `left = 0` and gets «Машина закрыта. Ящиков не осталось.» (400), never a 500. Lock order is Shipment → Lot (`open_lot` takes both, everything else only the Lot), so a QR claim cannot overwrite a seller the agent set meanwhile. Test: `tests/test_stock_race.py` (two threads on MSSQL; without the lock one of them dies as the deadlock victim, error 1205).

### Sale rules (`services/entries.py::create_sale`)

Only the lot's seller records entries; the agent gets 403 «Продажи записывает продавец этой машины.» (spec Q19). Check order: seller → approved report → on the road → needs_receipt → closed → stock → weight → price → buyer.

| Rule | Message (field) |
|---|---|
| Approved SalesReport on the shipment | «Отчёт по машине утверждён — изменить продажи нельзя.» |
| Truck still `yola_chykdy` / `serhet_gechdi` / `dest_entry` | «Машина ещё в пути — продавать можно после таможни назначения.» |
| `needs_receipt` | «Пусть агент укажет, сколько ящиков пришло.» |
| `closed_at` set or `left <= 0` | «Машина закрыта. Ящиков не осталось.» |
| box / pallet `qty < 1` | «Не меньше 1.» (`qty`) |
| More boxes than left | «В машине осталось только N ящиков» (`qty`) |
| More pallets than whole pallets left | «Больше нельзя: целых паллет осталось N (M ящиков)» (`qty`) |
| Pallet sale with less than one whole pallet left | «На целую паллету не хватает. Осталось N ящиков.» (`qty`) |
| No / zero scale weight | «Напишите вес с весов.» (`gross_kg`) |
| Net weight ≤ 0 | «Вес меньше, чем весят пустые ящики (N ящиков по T г).» (`gross_kg`) |
| No / zero price | «Напишите цену за 1 кг.» (`price_kg`) |
| Debt sale without a buyer | «Укажите покупателя.» (`buyer_id`) |
| Buyer is not the customer's | «Покупатель не найден.» (`buyer_id`) |

- **Units.** A whole-truck sale takes everything left (`qty = 1`, `boxes = left`); a pallet sale takes `qty × boxes_per_pallet` boxes.
- **Weight minus tare.** `net_kg = gross_kg − boxes × tare_g / 1000` (to 0.01): the scale weight includes the empty boxes.
- **Total.** `calc_total = net_kg × price_kg`. A manual `total > 0` overrides `total` while `calc_total` stays (the lot screen shows the formula difference).
- **Debt sale** (`paid_on_spot = false`): `buyer_id` required; the phone get-or-creates the buyer first (`POST /market/buyers/`). A paid sale may still carry a buyer. The lot's `debt_total` is what the debt sales still owe after the Part C payments (see «Part C»).
- **Undo.** The author-seller (while he is still the lot's seller) or the agent deletes an entry; anyone else gets 403 «Удалить запись могут её автор или агент.». The 7-second «Отменить» toast on the phone is a DELETE.

### Spoilage and expenses

- **Spoilage** (`boxes ≥ 0`, optional `gross_kg`): seller only, same approved-report / on-the-road / receipt / closed checks as a sale. «Укажите ящики или вес.» when both are empty; boxes above `left` → «В машине осталось только N ящиков» (`boxes`); a weight below the tare → «Вес меньше, чем весят пустые ящики…» (`gross_kg`). Weight alone (0 boxes) is allowed and leaves `left` unchanged. An empty weight is sent as `null`, never `0`.
- **Expenses** (one sheet = several rows, seller only): allowed on the «ждёт приёмки» card, while the truck is on the road, **on closed lots**, and **after the SalesReport is approved** (this changed in Part C: the freeze now covers expenses and the receipt too, see «Part C»). Messages: «Добавьте хотя бы один расход.», «Такой статьи расходов нет.» (`category_id`; also an inactive category, as in the reference list), «Напишите сумму.» (`amount ≤ 0`), «Напишите, на что потрачено.» (`label`, required for `OTHER`). Every row is checked before any is saved; rows are created one by one (MSSQL Decimal batch rule). Labels come from `GET /market/expense-categories/` (the market's own, e.g. `INTERES` shows as «Комиссия»).
- Deleting a sale, spoilage or expense entry after an approved report → 400 «Отчёт по машине утверждён…» (expenses since Part C). Not built: «a delete sets `SalesReport.journal_open`» (Part E; the field does not exist yet).

### Status driving (`services/status.py::drive_first_sale`)

The lot's first sale schedules `drive_first_sale` with `transaction.on_commit`, so the sale is already saved: **any failure is logged and swallowed, a sale is never lost.** It fills only fields that are still empty:

- `arrived_at` — only while the truck is at `barysh_gumrugi` or `transshipment`.
- `sale_started_at` — always.
- `city` — from the **bazaar of the seller who recorded the first sale** (`Lot` has no bazaar field), when that bazaar has a city.

Then a plain `Shipment.save()`; the status itself is never set here (AD-1 is retired, ADR-010 2026-05 amendment): auto-advance moves it through `transition_to()`. With `arrived_at`, `sale_started_at` and a city present, `barysh_gumrugi` → `bardy` → **`satylyar`** in one save, and the Sheet shows «Продаётся». **With no city anywhere** (neither on the shipment nor on the bazaar) the truck stays at `bardy` until the operator fills the city. The filled fields are audited. A re-run changes nothing (a new first sale after all sales were deleted is harmless).

- **Closed season skips status driving** (`assert_season_open`): the sale is saved, the shipment is left alone.
- **No sale or spoilage before destination customs** (`yola_chykdy` / `serhet_gechdi` / `dest_entry`): a sale there would later make the status jump steps. Opening the lot, receipt, seller assignment and expenses stay allowed; the rep marks destination customs, then the seller can sell.
- **An approved SalesReport freezes sales, spoilage, expenses and the receipt** (create and delete; since Part C — Part B froze only sales and spoilage).

### Roles on `market_lot`

| Role | Grant | What it does |
|------|-------|----------------|
| `agent` | VCRUD | all lots of his customer; opens trucks; receipt / seller PATCH (also on closed lots); deletes any entry; **cannot** sell, write off or add expenses (403) |
| `agent_seller` | VCRUD | only lots assigned to him; opens by QR (claims an unassigned lot); sells, writes off, adds expenses; deletes his own entries; `/market/shipments/` → 403 |
| `sales_rep`, `director`, `export_manager`, `document_team`, `boss` | VIEW | read the lots of the customers `customer_ids_for` gives them; `POST open/` → 403 «Машину открывают агент и его продавцы.» |
| `admin` | VCRUD | the grant opens the gate; the services still refuse everything that is not an agent / seller action |

The grant is only the gate (`DynamicResourcePermission`, resource `market_lot`); who may do what on a lot is decided in the services. Boss gets VIEW (spec §3, an exception to his usual full CRUD) plus the `'*'` field row. See [[permissions-system#External roles and the fence (agent market, 2026-10)]].

### Phone screens (`/m/`)

- **Home** — «Открытые машины» (`LotCard`: seller name for the agent, truck rig, left line, paid / debt / costs / spoiled), agent only «В пути и прибывшие» («Открыть»), «Закрытые машины». Empty state «Машин пока нет».
- **Lot screen** `/lots/:id` — left column (slot `lot-form`): seller → `SellForm` (unit box / pallet / truck, qty stepper, weight with tare hint, price + total, paid / debt toggle, buyer on debt, «Испорчено» and «Расходы по машине» sheets), or the «Машина ещё в пути — продавать можно после таможни назначения.» card while the lot's `on_the_road` is true (`yola_chykdy` / `serhet_gechdi` / `dest_entry`, checked before the receipt), or the «ждёт приёмки» card, or the «Машина закрыта» card — every card keeps «Расходы по машине»; agent → «Приёмка» and «Продавец». Right column: stats and the entry list grouped by day with day totals; each row has «Удалить».
- **`/m/scan/:id`** — the QR claim (lifecycle step 3).
- **Team** (agent) — «Изменить» on a bazaar (name, `is_active`), «Базар» on a seller (move to another active bazaar).
- **Shared** — `Sheet` moves focus in, traps Tab, keeps one scroll lock for stacked sheets, only the top sheet takes Escape; 7 s «Отменить» toasts; login errors in Russian («Неверный логин или пароль», «Нет связи…»); numbers use a no-break space and decimal comma, dates are `ru-RU` in every language.
- **Idempotency.** Every create sends an `Idempotency-Key`; the sell form disables save until the post-success re-render (700 ms cooldown). A 400 / 403 frees the key; a retry after a lost answer replays the original sale. Core `@idempotent` records a *raised* exception as a replayed 500, so market views wrap the method in `answers_errors`, which turns market exceptions into their 400 / 403 / 404 before the decorator sees them. Core views outside the market still have the old behaviour. A 5xx on a sale / write-off / expenses save may have come after the commit: the hook refetches the lot detail and the form says «Проверьте список — продажа могла сохраниться.» («…запись могла сохраниться.» in the two sheets); the key is kept.

### Known gaps (Part B)

- After a server 500 on a sale the form keeps its key, so later saves replay the stored 500 until the page is reloaded (core `@idempotent`); the refetched list shows whether it was saved. A 5xx from the debt-buyer create before the sale shows the same «Проверьте список…» text.
- The lots list reads page 1 only (`page_size=200`). `ScanPage.tsx` is over 150 lines. Turkmen strings need a native review.
- Net × price can overflow `Decimal(12,2)` for absurd values (500). `lots_for` does not exclude soft-deleted shipments (`open_lot` does).
- The full list: `docs/superpowers/plans/2026-10-08-agent-market-a-followups.md`, «Still open after Part B».

### Deploy of Part B

- `migrate core market` (core `0077`, market `0002` / `0003` / `0004`). Not applied to the shared DB until the branch is merged: beta runs the old code on the same DB.
- Rebuild the **frontend image** (new `/m/` screens, the `ScanPage` / `LoginPage` forwards, the `apple-touch-icon` link in `index.html`).
- `seed_permissions` after the beta deploy (it only creates missing rows; the `0077` migration already seeds `market_lot` on a real DB).

## Part C — payments and debts

Plan `docs/superpowers/plans/2026-10-10-agent-market-c-payments-debts.md`, branch `feat/agent-market-c`. A debt sale is paid later in parts; the buyer's debt is derived, never stored.

### Data (migration `market/0005_payments`)

- `Payment` (`market_payments`): buyer (PROTECT), `currency`, `amount`, `paid_at` (auto), `created_by`. `PaymentAllocation` (`market_payment_allocations`): payment (CASCADE) → sale (PROTECT) → `amount`.
- **A sale's due is never stored:** `due = total − Σ allocations` (never negative; 0 for a paid-on-spot sale). Deleting a payment cascades its allocations, so the sales owe again by themselves. `services/dues.py`: `sale_paid`, `sale_due`, `with_allocated`, `debt_sales`.
- **Lot totals are clamped per sale** (`services/totals.py`): `debt_total = Σ max(0, total − allocated)`, `paid_total = Σ spot totals + Σ min(allocated, total)`, so `debt_total == Σ sale_due` and an over-allocated row can never hide another sale's debt. The sale payload gets `paid_amount` and `due`.

### Rules (`services/payments.py`)

- **Who.** Only the agent and his sellers pay, mark and undo. Staff read the debts; a payment write by staff is 403 (`NOT_MARKET_MEMBER`).
- **Scope = the payer's visibility.** A seller's payment covers only sales on his own lots; the agent's covers every lot of his customer. A second seller of the same agent does not see the first seller's buyer in «Долги»; the agent sees all.
- **FIFO.** A payment is spread over the buyer's unpaid sales in scope, oldest `sold_at` first, **one currency at a time** (KZT and RUB are never summed).
- **Cap.** The recorded amount is at most what the scoped sales owe in that currency; the answer carries the recorded amount. Nothing due → 400 «У покупателя нет долга.»; amount empty or ≤ 0 → 400 `{amount}` «Напишите сумму.».
- **Locks.** Buyer row first, then every target sale row (plain pk lookup), then the dues are read fresh; each allocation ≤ what its sale owes at that moment. Entry deletes lock Lot → Sale and never a Buyer: no cycle. Allocations are created one by one (MSSQL Decimal batch rule).
- **«Отметить оплату»** (`POST sales/{id}/mark-paid/`): a payment of one debt sale's whole due. Allowed for the customer's agent or the lot's seller; same customer but neither → 403 «Эту продажу вы не видите.», another customer → 404, a spot sale / no buyer / already paid → 400 «У покупателя нет долга.». Works on closed lots too (debts outlive the truck).
- **Undo** (`DELETE payments/{id}/`): the payment's author or the agent; another seller of the same agent gets 403 «Отменить оплату могут её автор или агент.», another agent's team 404.
- **A sale with an allocation can't be deleted:** 400 «По этой продаже уже есть оплата — сначала отмените оплату.» (checked after the permission and the approval freeze).
- **Payments and their undo are allowed after the SalesReport is approved:** the report counts sales, not collections, so no `check_report_open` in any payment path.
- Payment create, mark and undo are audited as `MarketPayment`; POST / DELETE take `Idempotency-Key`.

### Approval freeze, now wider

`check_report_open(lot)` (`services/lots.py`) guards `create_sale`, `create_spoilage`, `create_expenses`, `delete_entry` (every kind) and `update_lot` (receipt and seller PATCH). After the export manager approves the SalesReport all of them answer 400 «Отчёт по машине утверждён — продажи, списания, расходы и приёмку менять нельзя.». Payments are not frozen. The seller's QR claim of an unassigned lot still works after approval (read-like; the lot can't sell anyway).

### Receipt asks for boxes per pallet

While `needs_receipt` the «Приёмка» sheet blanks «Ящиков в паллете» (it used to keep the placeholder 1, so pallet sales took 1 box) and always sends `boxes_per_pallet` with the PATCH; save is blocked while it is empty. The seller card says «Пусть агент укажет, сколько ящиков и паллет пришло.».

### Phone screens (`/m/`)

- **«Долги» tab** (route `/debts`; the tab bar now shows for every market user: «Машины» / «Долги», the agent also «Команда»). `DebtsScreen`: «Всего должны» (one amount per currency), a card per buyer × currency with the due, «Принять оплату», the unpaid sales oldest first («Вся машина (68 ящиков)», «из 300 000 ₸» when part-paid), «Оплаты» (latest 10 touching the scope) each with «Удалить» (confirm sheet).
- **`PaymentSheet`:** amount prefilled with the due; live hint «Это больше долга. Запишу X.» / «Долг будет закрыт полностью.» / «Останется долг: X»; sends `min(typed, due)`; toast «Оплата X, имя» with «Отменить» (undo = DELETE).
- **Home:** `DebtsTile` («Долги клиентов», one amount per currency, or «Долгов нет») links to `/debts`.
- **Lot screen:** a debt sale shows «Долг: имя, осталось X» when part-paid and a green «Оплачено» tag when due is 0; «Отметить оплату» on a debt sale with a buyer and due > 0 (agent and seller) with a 7 s «Отменить» toast.
- «Удалить» is shown on every payment row for both roles (`/market/me/` has no user id); a server 403 shows as a toast.

### Known gaps (Part C)

- `buyer_debts` runs one payments query per buyer × currency group (N+1, fine at bazaar scale; Part D).
- A seller sees the full amount of an agent's payment that partly went to another seller's sales (should show the in-scope allocated amount).
- A per-call undo / delete error toast is lost if the user leaves `/debts` before it fails (move to hook-level `onError`); `PaymentSheet` keeps a debt snapshot that can go stale on refetch (the server caps); a mark-paid 400 does not refetch the lot (stale button until the next refetch).
- Pallet sales in the debts list show boxes only (`IDebtSale` has no `qty`). Turkmen strings need a native review.
- The full list: `docs/superpowers/plans/2026-10-08-agent-market-a-followups.md`, «Still open after Part C».

### Deploy of Part C

- `migrate market` (`0005_payments`). Not applied to the shared DB until the branch is merged: beta runs the old code on the same DB.
- Rebuild the **backend image** (new endpoints, wider freeze) and the **frontend image** (`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --build frontend`).

## Deploy

- The market app is a **second Vite entry served at `/m/`**: rebuild the **frontend image** (nginx `location /m/ { try_files $uri /m.html; }`, `location = /m` → 301 `/m/`, plus no-cache exact locations for `/m/sw.js` and `/m/manifest.webmanifest`).
- Part A: `migrate core export market`. Part B: see «Deploy of Part B» above. Part C: see «Deploy of Part C».
- **PWA install needs HTTPS** (beta `https://export.yigithj.com`). `public/m/manifest.webmanifest`, no-cache `sw.js` (registered in prod builds only, caches nothing), PNG icons (192, 512, maskable 512, apple-touch 180).

## Connections

[[permissions-system]], [[authentication]], [[../roles/sales-rep]] (creates agent logins).
