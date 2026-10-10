# Agent Market — Part C (payments, debts, approval freeze, receipt fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer who took tomatoes on debt can pay any amount later; the money covers his oldest debts first; payments can be undone; sellers and agents see who owes what (per currency), mark a single sale paid, and the lot totals show paid / still-due correctly. Plus two carry-overs: the journal freezes after the export manager approves the sales report (expenses and receipt too), and the receipt sheet no longer pre-fills «Шт. в паллете» with the placeholder 1.

**Architecture:** New models `market.Payment` and `market.PaymentAllocation` (migration market 0005). All rules in `apps/market/services/payments.py` (FIFO allocation under row locks, mark-paid, delete, debts listing); the due of a sale is always derived (`total − Σ allocations`, 0 when paid on the spot). Thin `RussianMixin` views with `@idempotent` + `@answers_errors`. Market app: a «Долги» tab for sellers and agents, a debts screen with buyer cards and a payment sheet, a home tile, and «Отметить оплату» on debt sales in the lot screen.

**Tech Stack:** Django 5.1 + DRF, MSSQL, React 18 + TS + TanStack Query + react-i18next, vitest. Market app without Ant Design.

**Spec:** `docs/superpowers/specs/2026-10-08-agent-market-sales-design.md` — §2 (Payment / PaymentAllocation, derived due), §4 (approval freeze — user decision 2026-10-10), §5 (debts and payments), §9. Carry-overs: `docs/superpowers/plans/2026-10-08-agent-market-a-followups.md` («Open after the Part B final review»).

## Scope decisions (controller rulings, binding)

- **Payment scope follows visibility:** a seller sees and settles the debts of sales on **his own lots**; the agent sees and settles all debts of his customer. A payment's FIFO allocation covers the buyer's unpaid sales **within the payer's scope and in one currency**, oldest `sold_at` first. (Sellers never see each other — artifact rule.)
- **Amount is capped** at the buyer's due in that scope and currency; the response returns the recorded amount, and the phone says «Это больше долга. Запишу X.» before saving.
- **A debt sale that already has an allocation cannot be deleted:** `MarketRuleError('По этой продаже уже есть оплата — сначала отмените оплату.')`. Paid-on-the-spot sales delete as before.
- **Payments are allowed after the report approval** (user, 2026-10-10); sales, spoilage, **expenses and receipt edits are not** (Task 1).
- **Who deletes a payment:** its author, or the agent of the customer.
- **KZT and RUB are never summed** anywhere (API returns per-currency maps).
- `debt_total` in lot totals becomes the real remaining due; `paid_total` = paid on the spot + allocated.

## Global Constraints

- Work only in `D:/projects/yigit_platform-market`, branch `feat/agent-market-c`. Never touch `D:/projects/yigit_platform` except its venv `/d/projects/yigit_platform/backend/venv/Scripts/python.exe`.
- Commits authorized on this branch: `git status` + `git diff --cached` first, stage only your files, trailer `Co-Authored-By: <the Claude model you actually are> <noreply@anthropic.com>`, scopes `p3` / `frontend` / `docs`. No push.
- **Never apply migrations to the shared DB on this branch.** Tests on a private DB: `cd D:/projects/yigit_platform-market/backend && TEST_DB_NAME=test_YIGIT_MARKET_C DJANGO_TESTING=true /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test <labels> --noinput -v 1`. The system check queries the DB before the runner creates it: if you get an InterfaceError about a missing DB, create the empty `test_YIGIT_MARKET_C` (collation `Cyrillic_General_CI_AS`) on the local test server first (TEST_DB_* in backend/.env). Add `--keepdb` for repeat runs, but note `test_stock_race` (TransactionTestCase) flushes data-migration rows — run the final check on a fresh DB.
- Frontend: `npx tsc --noEmit --ignoreDeprecations 5.0`; `npx vitest run <path>`; `npm run build` (no antd in the `m` chunks).
- MSSQL: no JSONField / ArrayField / DISTINCT ON; `DecimalField(max_digits=12, decimal_places=2)` (`MONEY` in `models/lots.py`); create `PaymentAllocation` rows one by one (mixed Decimal batches rule); reference FKs `PROTECT` except `PaymentAllocation.payment` (`CASCADE` — deleting a payment removes its allocations); `db_table = schema_table('market', …)`.
- `core` / `export` never import `market`; no signals; business logic only in `apps/market/services/`; docstrings on every public class/function; `models/` and `services/` re-export in `__init__.py`.
- All market writes `@idempotent` above `@answers_errors` (`views/base.py`); errors via `MarketRuleError(message, field=None)` / `MarketAccessError` / `LotNotFound`.
- Frontend standards: ≤ 150 lines per file, one component per file, no `as` / `!`, props interfaces, explicit return types on exports, named exports for shared components; market app imports only `@/services/api`, `@/i18n`, `@/types`, `@/constants/roles`, `@/utils/*`, `@/hooks/useIdempotencyKey`. Errors on screen via `screens/lot/saleBody.ts` helpers (`readableError`, `sellErrors`: server text only for 400/403/404, 409 friendly, never raw codes). Submit buttons use `useSubmitLock` (idempotency key is read at render — never two creates at once).
- Design = the artifact (study §3.10 debts / §3.6 mark paid): money with the symbol after the amount, Russian plurals, undo toasts 7 s, sheets pinned to the top on phones, ≥ 48 px targets. Russian UI, keys in ru/tk/en, never "draft".
- Migration numbers at plan time: market ends `0004`, core `0077`. Re-check before writing.

## Review Focus

1. Two payments for the same buyer at the same time never over-allocate a sale (each sale's due ≥ 0 afterwards) — payments lock the buyer row and the candidate sale rows (Task 4).
2. A seller's payment never touches another seller's sales, and a seller never sees another seller's buyers' debts (Task 4).
3. Deleting a sale with an allocation is refused (400), never a 500 `ProtectedError`, including when a payment lands concurrently — delete locks the sale row too (Task 3).
4. Deleting a payment restores exactly the dues it covered and the lot totals follow (Task 4).
5. After the report approval: expense create/delete and receipt PATCH answer 400, payments still 201 (Tasks 1, 4).

---

### Task 1: Approval freeze for expenses and receipt edits (backend)

**Files:**
- Modify: `backend/apps/market/services/lots.py` (move `_check_report_open` + `REPORT_APPROVED` here as public `check_report_open(lot)`; call it in `update_lot` right after the lot lock, before `_checked_values`), `backend/apps/market/services/entries.py` (import it from lots; call it in `create_expenses` after `_check_lot_seller`; in `delete_entry` call it for **every** kind — remove the `if kind != 'expense'` exception), `services/__init__.py`
- Test: `backend/apps/market/tests/test_approval_freeze.py`

**Interfaces:** Produces `apps.market.services.lots.check_report_open(lot) -> None` (raises `MarketRuleError(REPORT_APPROVED)`), `REPORT_APPROVED = 'Отчёт по машине утверждён — изменить продажи нельзя.'` (unchanged text).

- [ ] **Step 1: Failing tests** (`make_world()`, a lot with the seller, `SalesReport.objects.create(shipment=w.shipment, created_by=w.rep, approved_at=timezone.now())`):
  - expense create → 400 `{"error": REPORT_APPROVED}`; expense delete (expense created before approval) → 400;
  - agent PATCH `boxes_received` → 400; PATCH `seller_id` → 400;
  - without approval: expense create 201, PATCH 200 (regression);
  - sale / spoilage still refused (regression).
- [ ] **Step 2:** run labels `apps.market.tests.test_approval_freeze` → FAIL. **Step 3:** implement. **Step 4:** run `apps.market` → PASS.
- [ ] **Step 5: Commit** `fix(p3): approved sales report also freezes market expenses and the receipt`.

---

### Task 2: Receipt sheet asks for boxes per pallet too (frontend)

**Files:**
- Modify: `frontend/src/market-app/screens/lot/receiptState.ts` (`receiptForm`: while `lot.needs_receipt`, `perPallet` is `''` like `boxes`; `receiptBody` sends `boxes_per_pallet` whenever `lot.needs_receipt`), i18n ×3: `market.sell.needs_receipt` → «Пусть агент укажет, сколько ящиков и паллет пришло.»; `market.agent.needs_receipt` → «Укажите, сколько ящиков и сколько ящиков в паллете пришло»
- Test: `frontend/src/market-app/screens/lot/receiptState.test.ts` (create or extend)

- [ ] **Step 1: Failing tests:** `receiptForm` of a `needs_receipt` lot → `{boxes: '', perPallet: ''}`; `checkReceipt` of that form → errors on both; `receiptBody` for a `needs_receipt` lot with boxes 300 / per pallet 60 → `{boxes_received: 300, boxes_per_pallet: 60}` even if 60 equals the stored value; a confirmed lot keeps today's behaviour.
- [ ] **Steps 2–4:** `npx vitest run src/market-app`, tsc. **Step 5: Commit** `fix(frontend): market receipt asks for boxes per pallet while the receipt is pending`.

---

### Task 3: `Payment`, `PaymentAllocation`, derived due, totals, sale payload, protected sale delete

**Files:**
- Create: `backend/apps/market/models/payments.py`, `backend/apps/market/migrations/0005_payments.py` (generated), `backend/apps/market/services/dues.py`, `backend/apps/market/tests/test_dues.py`
- Modify: `models/__init__.py`, `services/totals.py` (paid/debt from dues), `serializers/lots.py` (`SaleSerializer` adds `paid_amount`, `due`), `views/lots.py` (retrieve prefetch `sales__allocations`), `services/entries.py` (`delete_entry` for a sale: lock the sale row, refuse when it has allocations), `services/__init__.py`

**Interfaces:**
- `models/payments.py`:

```python
"""Buyer payments of debts and how each payment was spread over the buyer's unpaid sales."""
from django.db import models

from apps.core.db_utils import schema_table
from apps.market.models.lots import MONEY, Buyer, Sale


class Payment(models.Model):
    """Money a buyer brought for his debts, in one currency."""

    buyer = models.ForeignKey(Buyer, on_delete=models.PROTECT, related_name='payments')
    currency = models.CharField(max_length=3)
    amount = models.DecimalField(**MONEY)
    paid_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')

    class Meta:
        db_table = schema_table('market', 'payments')
        ordering = ['-paid_at', '-pk']

    def __str__(self) -> str:
        return f'Payment {self.pk} ({self.amount} {self.currency})'


class PaymentAllocation(models.Model):
    """The part of a payment counted against one sale."""

    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name='allocations')
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name='allocations')
    amount = models.DecimalField(**MONEY)

    class Meta:
        db_table = schema_table('market', 'payment_allocations')

    def __str__(self) -> str:
        return f'{self.amount} → sale {self.sale_id}'
```

- `services/dues.py`:
  - `sale_paid(sale) -> Decimal` — `total` when `paid_on_spot`, else `Σ allocations.amount` (use the prefetched `allocations` when present).
  - `sale_due(sale) -> Decimal` — `0` when `paid_on_spot`, else `max(0, total − Σ allocations)` quantized 0.01.
  - `debt_sales(qs) -> QuerySet[Sale]` — `qs.filter(paid_on_spot=False).annotate(allocated=Coalesce(Sum('allocations__amount'), 0)).filter(total__gt=F('allocated'))` (use `Value(Decimal('0'))` with the right output field for MSSQL).
- `totals.lot_totals`: `paid_total = Σ total (paid_on_spot) + Σ allocations on the lot's debt sales`; `debt_total = Σ total (debt sales) − Σ allocations on them` (never negative). Docstring updated (no "Part C replaces it").
- `SaleSerializer` fields add `paid_amount` and `due` (strings).
- `delete_entry(kind='sale')`: after the lot lock, `Sale.objects.select_for_update().filter(pk=entry_id, lot=lot).first()`; if `entry.allocations.exists()` → `MarketRuleError('По этой продаже уже есть оплата — сначала отмените оплату.')`.

- [ ] **Step 1: Failing tests** (`tests/test_dues.py`; create allocations directly with the ORM for now): a debt sale 4500 with allocations 1000 + 500 → `sale_due = 3000.00`, `sale_paid = 1500.00`; paid-on-spot → due 0; lot totals `paid_total` = spot sales + 1500, `debt_total` = 3000; detail payload sale has `due: '3000.00'`, `paid_amount: '1500.00'`; deleting that sale → 400 with the message and the sale remains; deleting a debt sale without allocations → 200.
- [ ] **Step 2:** FAIL. **Step 3:** implement; `makemigrations market --name payments` → `0005_payments.py` (do not migrate). **Step 4:** `apps.market` → PASS; `makemigrations --check`.
- [ ] **Step 5: Commit** `feat(p3): market payments and allocations models; sale due is derived`.

---

### Task 4: Payments and debts services + API

**Files:**
- Create: `backend/apps/market/services/payments.py`, `backend/apps/market/serializers/payments.py`, `backend/apps/market/views/payments.py`, `backend/apps/market/tests/test_payments_api.py`, `backend/apps/market/tests/test_payment_race.py`
- Modify: `services/__init__.py`, `views/__init__.py`, `urls.py`

**Interfaces (`services/payments.py`):**
- Messages: `NOTHING_DUE = 'У покупателя нет долга.'`, `NEED_PAY_AMOUNT = 'Напишите сумму.'`, `NOT_PAYMENT_OWNER = 'Отменить оплату могут её автор или агент.'`, `NOT_YOUR_SALE = 'Эту продажу вы не видите.'`.
- `debt_scope(user) -> QuerySet[Sale]` — seller: sales on `lots_for(user)` (his lots); agent: sales of lots of his customer; staff: `customer_ids_for` (read only); others none.
- `buyer_debts(user) -> list[dict]` — groups by `(buyer, lot.currency)` over `debt_sales(debt_scope(user))`: `{buyer: {id, name}, currency, due, since, sales: [{id, lot_id, shipment_code, sold_at, unit, boxes, net_kg, total, due}] (oldest first), payments: [{id, amount, paid_at, created_by}] (latest 10 of this buyer in this currency that touch the scope)}`; sorted by currency, then due desc.
- `debt_totals(user) -> dict[str, str]` — `{currency: due}` for the scope.
- `create_payment(user, buyer_id: int, currency: str, amount: Decimal) -> Payment` — agent or seller only (`MarketAccessError` for staff); buyer must be of the user's customer (else `LotNotFound`); `amount > 0` (`MarketRuleError(NEED_PAY_AMOUNT, 'amount')`). In `transaction.atomic()`: `Buyer.objects.select_for_update().get(pk=…)`; candidate sales = `debt_sales(debt_scope(user)).filter(buyer=buyer, lot__currency=currency).select_for_update().order_by('sold_at', 'pk')` (lock the rows; if MSSQL refuses `select_for_update` with an aggregate annotation, lock `Sale.objects.select_for_update().filter(pk__in=<ids>)` first and compute dues after); total due 0 → `MarketRuleError(NOTHING_DUE)`; `recorded = min(amount, total_due)`; create the `Payment(amount=recorded)` then allocations one by one, oldest first, `min(due, rest)`; audit `create_audit_entry(user, 'create', 'MarketPayment', payment.pk, buyer.name, f'{recorded} {currency}')`.
- `mark_sale_paid(user, sale_id: int) -> Payment` — the sale must be in `debt_scope(user)` with due > 0 (else `LotNotFound` / `MarketRuleError(NOTHING_DUE)`); writer agent or the lot's seller; same locks; one allocation of the full due.
- `delete_payment(user, payment_id: int) -> None` — the payment must touch the user's scope (else `LotNotFound`); author or agent of the customer (else `MarketAccessError(NOT_PAYMENT_OWNER)`); lock the payment's sales rows; delete (allocations cascade); audit `update` / `deleted`.

**API (`views/payments.py`, `RussianMixin`, `resource_code='market_lot'`, `DynamicResourcePermission`):**
- `GET /market/debts/` → `{totals: {KZT: '…'}, buyers: [...]}`.
- `POST /market/payments/` `{buyer_id, currency, amount}` → 201 `{payment: {id, buyer, currency, amount, paid_at}, debts_total: {…}}` (`@idempotent` + `@answers_errors`).
- `POST /market/sales/{id}/mark-paid/` → 201 `{payment, lot}` (lot payload as in entries).
- `DELETE /market/payments/{id}/` → 200 `{deleted: id}`.

- [ ] **Step 1: Failing tests** (`tests/test_payments_api.py`, factories; two debt sales of buyer B on the seller's lot — 4500 (day 1) and 2000 (day 2) — plus one on `seller2`'s lot 1000):
  - seller pays 5000 → allocations 4500 to sale 1, 500 to sale 2; sale 2 due 1500; the `seller2` sale untouched;
  - seller pays 99999 → recorded = his scope's due (6500), not 7500;
  - agent pays 7500 → covers all three;
  - currency mismatch (`RUB` for KZT sales) → 400 `NOTHING_DUE`;
  - amount 0 → 400 `{amount: [...]}`;
  - other customer's buyer → 404; staff POST → 403;
  - `GET /debts/` as seller → only his sales of buyer B, totals `{'KZT': '6500.00'}`; as seller2 → only his; as agent → all;
  - mark-paid sale 2 → due 0, the lot totals in the response updated;
  - delete payment → dues restored; seller2 deleting the seller's payment → 403; agent → 200;
  - after the report approval: payment 201 (allowed), sale delete still 400;
  - delete a sale with an allocation → 400 (Task 3 rule, via the API).
  - `tests/test_payment_race.py` (`TransactionTestCase`, two threads, barrier, own connections, like `test_stock_race.py`): two payments of 4000 each for a buyer owing 6500 → total allocated ≤ 6500 and every sale's due ≥ 0.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `apps.market` → PASS (fresh DB at the end).
- [ ] **Step 5: Commit** `feat(p3): market buyer payments with FIFO allocation, mark paid, undo, debts`.

---

### Task 5: Market app — debts screen, payment sheet, «Долги» tab, home tile

**Files:**
- Create: `frontend/src/market-app/hooks/debtKeys.ts`, `hooks/useDebts.ts`, `hooks/usePayments.ts` (create, delete), `screens/DebtsScreen.tsx`, `screens/debts/BuyerDebtCard.tsx`, `screens/debts/PaymentSheet.tsx`, `screens/debts/paymentState.ts` (+ test), `screens/debts/PaymentRow.tsx`, `components/DebtsTile.tsx`, tests `screens/DebtsScreen.test.tsx`, `screens/debts/PaymentSheet.test.tsx`
- Modify: `types.ts` / `writeTypes.ts` (`IDebtSale`, `IBuyerDebt`, `IDebts`, `IPayment`, `IPaymentInput`, `IPaymentWrite`), `App.tsx` (route `debts`), `screens/Shell.tsx` (tab bar for sellers too: «Машины» / «Долги»; agent: «Машины» / «Долги» / «Команда»), `screens/HomeScreen.tsx` (`DebtsTile` above the open lots: «Долги клиентов» + `1 250 000 ₸ + 40 000 ₽` or «Долгов нет» → `/debts`), i18n ×3, `styles/` (a new `styles/debts.css` if needed)

**Behaviour (study §3.10):** title «Долги клиентов», «Всего должны» + one big sum per currency; buyer cards (name, due, «Принять оплату», unpaid sales oldest first: «<что продали>», «<Машина>, <время> [, из <total>]», due on the right; «Оплаты»: recent payments `5 000 ₸, 12 окт.` with a delete button for the author / agent → confirm → DELETE). Payment sheet: «Оплата: <имя>», «Должен: X», amount prefilled with the full due (selected), live hint «Напишите сумму.» / «Долг будет закрыт полностью.» / «Останется долг: X» / «Это больше долга. Запишу X.»; save → toast «Оплата 5 000 ₸, Рустам» + «Отменить» (deletes the payment). Empty: «Долгов нет» / «Никто не должен. Когда продадите в долг, клиент появится здесь.». After any payment write: invalidate debts, lots and the affected lot details.

- [ ] **Step 1: Tests first** (`paymentState.test.ts` hints and capping; `DebtsScreen.test.tsx` two currencies → two big sums, a buyer card with 2 sales; `PaymentSheet.test.tsx` POST body `{buyer_id, currency, amount:'5000.00'}`, toast undo → DELETE `/market/payments/{id}/`; the seller now sees the tab bar).
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(frontend): market debts screen, payment sheet and debts tab`.

---

### Task 6: Lot screen — «Отметить оплату», remaining due on debt sales

**Files:**
- Modify: `components/SaleLine.tsx` (debt tag: «Долг: Рустам» + «, осталось X» when `paid_amount > 0`; fully paid debt sale shows «Оплачено» in green), `screens/lot/LotEntries.tsx` (`renderActions`: «✓ Отметить оплату» for debt sales with `due > 0` — shown to the agent and to the lot's seller — next to delete), `hooks/usePayments.ts` (`useMarkPaid(lotId)` → POST `/market/sales/{id}/mark-paid/`, `applyLot` with the returned lot + sale `due`/`paid_amount` updated), i18n ×3
- Test: `screens/lot/MarkPaid.test.tsx`

**Behaviour:** tap «Отметить оплату» → POST (no confirm, like the artifact) → toast «Оплачено: 4 500 ₸, Рустам» + «Отменить» (DELETE the returned payment). A 400 «По этой продаже уже есть оплата…» on delete is shown as a toast (already via `readableError`).

- [ ] **Step 1: Tests:** debt sale with due → button visible for seller & agent, not for a paid sale; click → POST; toast undo → DELETE payment; partial paid shows «осталось 1 500 ₸».
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(frontend): market mark a debt sale paid from the lot screen`.

---

### Task 7: Docs and logs

**Files:** `docs/obsidian/processes/agent-market.md` (Part C section: payment scope, FIFO, cap, undo, protected sale delete, approval freeze incl. expenses/receipt, debts screen), `.claude/skills/api-contract/SKILL.md` (debts, payments, mark-paid, sale `due`/`paid_amount`, updated totals semantics), `CHANGELOG.md` ([Unreleased] → Added; **Deploy:** `migrate market` (0005), frontend image rebuild), `BUILD_TEST_LOG.md` (new top entry, Russian: debt sale → «Долги» tab shows the buyer; partial payment 1 200 of 3 000 → «осталось 1 800»; payment covers the oldest first across two trucks of the same seller; seller2 does not see seller1's buyer; «Отметить оплату» on one sale; undo a payment; delete a sale with a payment is refused; after the export manager approves the report — expenses and receipt refused, payment accepted; receipt sheet asks for boxes per pallet), `docs/superpowers/plans/2026-10-08-agent-market-a-followups.md` (strike the done items).

- [ ] **Step 1:** write. **Step 2:** full run on a FRESH DB — backend `apps.market apps.core apps.export.tests_auto_advance apps.export.tests_sheet_perms`; frontend full `npx vitest run`, tsc, build; `makemigrations --check`. **Step 3: Commit** `docs: agent market part C`.

## After Part C

Part D: agent panel (today / yesterday / 7 days, sellers, trucks on sale, top debtors) and our analytics + Excel (fix the lots-list N+1 there). Part E: «Отчёт готов», SalesReport build from the journal, `journal_open`, approval.
