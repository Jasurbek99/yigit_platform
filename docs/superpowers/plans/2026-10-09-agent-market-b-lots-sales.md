# Agent Market — Part B (lots, sales, spoilage, expenses, QR claim) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent's seller opens a truck that arrived (by list or by scanning the pallet QR), records every sale (box / pallet / whole truck, scale weight minus tare, price per kg, paid or on debt to a named buyer), spoilage and selling costs on the phone; the server checks stock under a row lock, closes the truck at 0 boxes left, and drives the shipment to «продаётся» on the first sale.

**Architecture:** New models in `apps.market` (`Lot` 1:1 `export.Shipment`, `Sale`, `Spoilage`, `LotExpense`, `Buyer`); every rule lives in `apps/market/services/` (lots, entries, status driving), views are thin `RussianMixin` viewsets. One new permission resource `market_lot` (core data migration). Market app (`/m/`): lots list, lot screen with the sell form, spoilage, expenses sheet, undo toasts, agent controls, QR claim route; the main app's `/scan/:id` forwards external roles to `/m/scan/:id`.

**Tech Stack:** Django 5.1 + DRF, MSSQL (mssql-django), React 18 + TS + TanStack Query + react-i18next, vitest. The market app uses no Ant Design.

**Spec:** `docs/superpowers/specs/2026-10-08-agent-market-sales-design.md` — §2 (Lot, Sale, Spoilage, LotExpense, Buyer), §3 (scoping), §4 (lifecycle, QR claim, journal rules), §8 (API), §9 (frontend). Carry-overs: `docs/superpowers/plans/2026-10-08-agent-market-a-followups.md` («Part B» section).

## Scope decisions (controller rulings, binding for this plan)

- **«Отчёт готов» and the SalesReport build are Part E**, not here (they belong together; spec §4/§7). In Part B the shipment status moves only on the **first sale** (→ `satylyar`); `satyldy` is untouched.
- **`Buyer` + debt sale are in Part B** (the sell form needs «В долг» + buyer); **payments, FIFO allocation and the debts screen are Part C**. In Part B a debt sale's due = its `total`.
- **First sale also fills an empty `shipment.city` from the seller's bazaar city** — `bardy → satylyar` needs `city` (`tasks.confirm_destination`). No bazaar city → the status stays `bardy` and the rep's city task stays open (sale is still saved).
- **First sale on a shipment still in transit** (`barysh_gumrugi` / `transshipment`) also fills an empty `arrived_at`; whatever the task chain cascades to is accepted.
- **Season close:** market writes are exempt (spec §4). If the shipment's season is closed, the sale is saved and the status driving is skipped (the shipment row cannot be saved in a closed season).
- **Market lists are NOT season-scoped** (a truck may still be selling after the season closes); a test pins this.
- **Who does what:** only the lot's **seller** creates sales / spoilage / expenses; the **agent** opens lots, assigns the seller, corrects receipt fields, deletes a wrong entry; the seller deletes his own entries. Staff read only. No create / delete of sales or spoilage after the shipment's `SalesReport.approved_at` is set.

## Global Constraints

- Work only in the worktree `D:/projects/yigit_platform-market`, branch `feat/agent-market-b`. Never touch `D:/projects/yigit_platform`.
- Commits authorized on this branch (user, 2026-10-08): `git status` + `git diff --cached` before each commit, stage only your files explicitly, trailer `Co-Authored-By: <the Claude model you actually are> <noreply@anthropic.com>`, scopes `p3` (market backend), `core`, `frontend`, `docs`. No push.
- **Never apply migrations to the shared DB on this branch.** Tests only, private DB.
- Test command: `cd D:/projects/yigit_platform-market/backend && TEST_DB_NAME=test_YIGIT_MARKET DJANGO_TESTING=true /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test <labels> --noinput -v 1`
- Frontend: `npx tsc --noEmit --ignoreDeprecations 5.0`; `npx vitest run <path>`; `npm run build` (the `m` bundle must contain no antd).
- MSSQL: no JSONField/ArrayField/DISTINCT ON; `bulk_create(batch_size=500)` — but create `Sale`/`Spoilage` rows one by one (mixed None/Decimal rule, `.claude/rules/mssql-compat.md`); `DecimalField(max_digits=12, decimal_places=2)` for money and weight; CharField `max_length`; Cyrillic text `**cyrillic_collation()`; reference FKs `on_delete=models.PROTECT`; `db_table = schema_table('market', '<name>')`.
- `core` and `export` never import `market`. No Django signals. Status is never written directly — only lifecycle fields + `Shipment.save()` (auto-advance → `transition_to`).
- Backend standards (`backend/CLAUDE.md`): business logic in `apps/market/services/`, never in views; docstrings on every public class and function; `models/` and `services/` packages re-export in `__init__.py`.
- Frontend standards (`frontend/CLAUDE.md`): ≤ 150 lines per file, one component per file, no `as` / `!`, props interfaces, return types on exports, named exports for shared components. The market app (`src/market-app/`) imports only `@/services/api`, `@/i18n`, `@/types`, `@/constants/roles`, `@/utils/*`, `@/hooks/useIdempotencyKey`.
- Market app design = the artifact (study §3.4–§3.8, §7): truck drawing with pallets, stepper, 64–76 px targets (≥ 48 px everywhere), live thousands spacing, sheets pinned to the top on phones, undo toasts 7 s, Russian plurals; responsive 1 / 2 / 3 columns at 0 / 760 / 1100 px; lot screen two columns from 1000 px.
- All `/api/v1/market/` writes accept the `Idempotency-Key` header (`apps.core.idempotency.idempotent` on `create`/`destroy`/actions; frontend `useIdempotencyKey`).
- UI copy Russian; keys in `src/i18n/{ru,tk,en}.json`; never the word "draft"/«черновик».
- API names (`api-contract` skill): shipment code is `code` (model `shipment_code`), weight is `*_kg`; errors via the platform handler (`{"error": …}` / `{field: [...]}`).
- Migration numbers at plan time: core ends `0076`, market ends `0001`. Re-check with `ls backend/apps/<app>/migrations | tail -3` before writing one.

## Review Focus

1. Two concurrent sale requests for the last boxes of one lot: exactly one succeeds, the other gets 400 «В машине осталось только N ящиков» — the lot row is locked (`select_for_update`) for every sale / spoilage create and every delete (Task 3).
2. A seller of customer A posting to customer B's lot id, or to a lot assigned to another seller, gets 404 / 403 — never a write (Task 2, Task 3).
3. A debt sale whose `buyer_id` belongs to another customer is refused (400), not attached (Task 3).
4. Deleting the sale that made the lot reach 0 reopens it (`closed_at` cleared) and deleting is refused once the shipment's SalesReport is approved (Task 3).
5. The first sale on a shipment whose season is closed still saves the sale (201) and leaves the shipment untouched — no 409 (Task 4).
6. Any exception while driving the shipment status (task chain, transition, gate sync) never rolls back or 500s the sale — status driving runs after commit and is caught (Task 4).
7. A logged-out seller scanning the pallet QR logs in and lands on the claim (`/m/scan/{id}`), not on `/m/` (Task 5).
8. A lot whose shipment had no `box_count` refuses sales until the agent sets the received boxes — the first box must not close the truck (Task 3).

---

### Task 1: Models `Lot`, `Sale`, `Spoilage`, `LotExpense`, `Buyer` + market expense categories

**Files:**
- Create: `backend/apps/market/models/lots.py`, `backend/apps/market/migrations/0002_lots_sales.py` (generated), `backend/apps/market/migrations/0003_market_expense_categories.py`, `backend/apps/market/expense_codes.py`, `backend/apps/market/tests/test_models.py`
- Modify: `backend/apps/market/models/__init__.py`

**Interfaces:**
- Produces (`apps.market.models`): `Lot`, `Sale`, `Spoilage`, `LotExpense`, `Buyer` (fields below), `Sale.UNIT_BOX/UNIT_PALLET/UNIT_TRUCK`.
- Produces (`apps.market.expense_codes`): `MARKET_EXPENSES: list[tuple[str, str]]` — `(ExpenseCategory.code, Russian label)` in display order; `OTHER_CODE = 'OTHER'`.

- [ ] **Step 1: Write the failing test** — `tests/test_models.py`

```python
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.export.models import ExpenseCategory
from apps.market.expense_codes import MARKET_EXPENSES, OTHER_CODE
from apps.market.models import Buyer, Lot, Sale
from apps.market.tests.factories import make_world


class LotModelTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()

    def test_one_lot_per_shipment(self):
        Lot.objects.create(shipment=self.w.shipment, boxes_received=100, boxes_per_pallet=50, currency='KZT',
                           opened_by=self.w.agent)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Lot.objects.create(shipment=self.w.shipment, boxes_received=100, boxes_per_pallet=50, currency='KZT',
                               opened_by=self.w.agent)

    def test_buyer_name_unique_per_customer(self):
        Buyer.objects.create(customer=self.w.customer, name='Рустам')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Buyer.objects.create(customer=self.w.customer, name='Рустам')
        Buyer.objects.create(customer=self.w.other_customer, name='Рустам')  # other agent: fine

    def test_sale_units(self):
        self.assertEqual({c for c, _ in Sale.UNIT_CHOICES}, {'box', 'pallet', 'truck'})

    def test_market_expense_categories_exist(self):
        codes = [c for c, _ in MARKET_EXPENSES]
        self.assertEqual(codes[-1], OTHER_CODE)
        for code in codes:
            self.assertTrue(ExpenseCategory.objects.filter(code=code).exists(), code)
```

Also create `backend/apps/market/tests/factories.py` (shared by every later task — keep it small and data-only):

```python
"""Test data for market tests: one season, two agents with a seller each, one shipment per state."""
from dataclasses import dataclass
from types import SimpleNamespace

from django.core.management import call_command
from io import StringIO

from apps.core.models import City, Country, Customer, ShipmentStatusType, User
from apps.export.models import ExpenseCategory, Shipment
from apps.export.tests_auto_advance import _ensure_statuses, _make_season
from apps.market.expense_codes import MARKET_EXPENSES
from apps.market.models import AgentMember, Bazaar


def ensure_market_expense_categories() -> None:
    """Data migrations skip on test DBs — make the categories the market uses."""
    for i, (code, label) in enumerate(MARKET_EXPENSES):
        ExpenseCategory.objects.get_or_create(code=code, defaults={'name_tk': label, 'name_ru': label, 'name_en': code,
                                                                   'sort_order': 900 + i})


def make_shipment(world, code: str, status_code: str, customer=None, **extra) -> Shipment:
    """A shipment of `customer` (default: the world's agent customer) at `status_code`."""
    return Shipment.objects.create(
        shipment_code=code, date='2026-01-01', season=world.season,
        status=ShipmentStatusType.objects.get(code=status_code),
        customer=customer or world.customer, country=world.country,
        box_count=100, pallet_count=2, created_by=world.rep, updated_by=world.rep, **extra,
    )


def make_world() -> SimpleNamespace:
    """Seed permissions + statuses and build two agents (A with seller S1/S2, B with seller T)."""
    _ensure_statuses()
    call_command('seed_permissions', verbosity=0)
    ensure_market_expense_categories()
    w = SimpleNamespace()
    w.season = _make_season()
    w.country, _ = Country.objects.get_or_create(code='KZ', defaults={'name_tk': 'Kz', 'name_en': 'Kz', 'name_ru': 'Казахстан'})
    w.country.currency = 'KZT'
    w.country.save()
    w.city = City.objects.create(country=w.country, name='Алматы-тест')
    w.rep = User.objects.create_user(username='mk_rep', password='pw', role='sales_rep')
    w.boss = User.objects.create_user(username='mk_boss', password='pw', role='boss')
    w.customer = Customer.objects.create(name='Агент А', sales_rep=w.rep)
    w.other_customer = Customer.objects.create(name='Агент Б')
    w.bazaar = Bazaar.objects.create(customer=w.customer, name='Алтын Орда', city=w.city)
    w.bazaar_no_city = Bazaar.objects.create(customer=w.customer, name='Без города')
    w.agent = _member('mk_agent', 'agent', w.customer)
    w.seller = _member('mk_s1', 'agent_seller', w.customer, w.bazaar)
    w.seller2 = _member('mk_s2', 'agent_seller', w.customer, w.bazaar_no_city)
    w.other_agent = _member('mk_agent_b', 'agent', w.other_customer)
    w.other_seller = _member('mk_t1', 'agent_seller', w.other_customer)
    w.shipment = make_shipment(w, 'MK-1', 'bardy')
    return w


def _member(username, role, customer, bazaar=None) -> User:
    user = User.objects.create_user(username=username, password='pw', role=role, first_name=username)
    AgentMember.objects.create(user=user, customer=customer, bazaar=bazaar)
    return user
```

(If `Shipment.objects.create` needs more required fields in this codebase, add them to `make_shipment` — read `tests_auto_advance.PeregruzForkTests._make_at_status` and `tests_full_cycle` for the minimum.)

- [ ] **Step 2: Run** — labels `apps.market.tests.test_models` → ImportError.

- [ ] **Step 3: Implement** — `expense_codes.py`:

```python
"""The selling costs an agent's seller records per truck (artifact: «Расходы по машине»).

Codes are rows of export.ExpenseCategory; labels are what the seller sees (Russian).
INTERES is the platform's commission code, PROSTOY its demurrage code (spec §2).
"""
MARKET_EXPENSES: list[tuple[str, str]] = [
    ('KARA', 'Кара'),
    ('INTERES', 'Комиссия'),
    ('PLYONKA', 'Плёнка'),
    ('ZAEZD', 'Заезд'),
    ('PARKOVKA', 'Парковка'),
    ('PROSTOY', 'Простой'),
    ('OTHER', 'Другое'),
]
OTHER_CODE = 'OTHER'
```

`models/lots.py`:

```python
"""A truck being sold at the bazaar (Lot) and everything recorded on it."""
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table

MONEY = {'max_digits': 12, 'decimal_places': 2}


class Lot(models.Model):
    """One shipment (truck) being sold by an agent; created on first open (spec §2, §4)."""

    shipment = models.OneToOneField('export.Shipment', on_delete=models.PROTECT, related_name='market_lot')
    seller = models.ForeignKey('core.User', on_delete=models.PROTECT, null=True, blank=True, related_name='market_lots')
    boxes_received = models.PositiveIntegerField()
    boxes_per_pallet = models.PositiveIntegerField()
    tare_g = models.PositiveIntegerField(default=450)
    default_price_kg = models.DecimalField(null=True, blank=True, **MONEY)
    currency = models.CharField(max_length=3)
    opened_at = models.DateTimeField(auto_now_add=True)
    opened_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')
    # Set automatically when nothing is left; cleared when boxes free up (spec §4).
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = schema_table('market', 'lots')
        ordering = ['-opened_at']

    def __str__(self) -> str:
        return f'Lot {self.shipment_id}'


class Buyer(models.Model):
    """A bazaar client of the agent (debt sales need one)."""

    customer = models.ForeignKey('core.Customer', on_delete=models.PROTECT, related_name='market_buyers')
    name = models.CharField(max_length=60, **cyrillic_collation())
    phone = models.CharField(max_length=30, blank=True)

    class Meta:
        db_table = schema_table('market', 'buyers')
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['customer', 'name'], name='market_buyer_customer_name_uniq')]

    def __str__(self) -> str:
        return self.name


class Sale(models.Model):
    """One sale off a lot: boxes, scale weight minus tare, price per kg, paid or on debt."""

    UNIT_BOX, UNIT_PALLET, UNIT_TRUCK = 'box', 'pallet', 'truck'
    UNIT_CHOICES = [(UNIT_BOX, 'Box'), (UNIT_PALLET, 'Pallet'), (UNIT_TRUCK, 'Whole truck')]

    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='sales')
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES)
    qty = models.PositiveIntegerField()
    boxes = models.PositiveIntegerField()
    gross_kg = models.DecimalField(**MONEY)
    tare_g = models.PositiveIntegerField()
    net_kg = models.DecimalField(**MONEY)
    price_kg = models.DecimalField(**MONEY)
    calc_total = models.DecimalField(**MONEY)
    total = models.DecimalField(**MONEY)
    paid_on_spot = models.BooleanField(default=True)
    buyer = models.ForeignKey(Buyer, on_delete=models.PROTECT, null=True, blank=True, related_name='sales')
    sold_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')

    class Meta:
        db_table = schema_table('market', 'sales')
        ordering = ['-sold_at', '-pk']

    def __str__(self) -> str:
        return f'Sale {self.pk} ({self.boxes} boxes)'


class Spoilage(models.Model):
    """Boxes and/or kg written off without money."""

    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='spoilage')
    boxes = models.PositiveIntegerField(default=0)
    gross_kg = models.DecimalField(null=True, blank=True, **MONEY)
    tare_g = models.PositiveIntegerField()
    net_kg = models.DecimalField(default=0, **MONEY)
    recorded_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')

    class Meta:
        db_table = schema_table('market', 'spoilage')
        ordering = ['-recorded_at', '-pk']

    def __str__(self) -> str:
        return f'Spoilage {self.pk}'


class LotExpense(models.Model):
    """A selling cost on a lot (commission, film, parking …); allowed after the lot closes."""

    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='expenses')
    category = models.ForeignKey('export.ExpenseCategory', on_delete=models.PROTECT, related_name='+')
    label = models.CharField(max_length=40, blank=True, **cyrillic_collation())
    amount = models.DecimalField(**MONEY)
    recorded_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')

    class Meta:
        db_table = schema_table('market', 'lot_expenses')
        ordering = ['-recorded_at', '-pk']

    def __str__(self) -> str:
        return f'Expense {self.pk}'
```

`models/__init__.py` re-exports `AgentMember, Bazaar, Buyer, Lot, LotExpense, Sale, Spoilage`.

Migrations: `manage.py makemigrations market --name lots_sales` → rename to `0002_lots_sales.py`. Then write `0003_market_expense_categories.py` by hand (data, reversible, depends on `('market', '0002_lots_sales')` and `('export', '0049_seed_expense_categories')`): `get_or_create` for the codes `KARA`, `PLYONKA`, `ZAEZD`, `PARKOVKA` (existing `INTERES`, `PROSTOY`, `OTHER` untouched) with `name_ru` = the label, `name_tk` = `Kara`, `Plýonka`, `Zaezd`, `Awtoduralga`, `name_en` = `Kara`, `Film`, `Entry fee`, `Parking`, `sort_order` 900+; reverse deletes those four codes only. Use `apps.get_model('export', 'ExpenseCategory')`; no test-DB skip (rows are harmless and tests need them — `ensure_market_expense_categories` covers DBs where it was skipped). Do not run `migrate`.

- [ ] **Step 4: Run** — labels `apps.market` → PASS; `makemigrations --check --dry-run` → no changes.
- [ ] **Step 5: Commit** — `feat(p3): market lots, sales, spoilage, expenses and buyers models`.

---

### Task 2: Permission resource `market_lot`, lot services, lots API (list, detail, open, agent PATCH, available shipments, expense categories, buyers)

**Files:**
- Modify: `backend/apps/core/permission_registry.py`, `backend/apps/core/management/commands/seed_permissions.py`
- Create: `backend/apps/core/migrations/0077_market_lot_resource.py`, `backend/apps/market/services/lots.py`, `backend/apps/market/services/totals.py`, `backend/apps/market/serializers/lots.py`, `backend/apps/market/views/lots.py`, `backend/apps/market/tests/test_lots_api.py`
- Modify: `backend/apps/market/services/__init__.py`, `backend/apps/market/views/__init__.py`, `backend/apps/market/urls.py`, `backend/apps/core/tests_agent_perms.py`

**Interfaces:**
- Resource `market_lot`: agent VCRUD, agent_seller VCRUD (fine rules in services), admin VCRUD, boss / director / export_manager / document_team / sales_rep VIEW (+ boss `'*'` field row). Same grants in seed and in `0077` (pattern: `0076_seed_agent_market_perms.py`).
- `services/lots.py`:
  - `VISIBLE_STATUS_CODES = ('yola_chykdy', 'serhet_gechdi', 'dest_entry', 'barysh_gumrugi', 'transshipment', 'bardy', 'satylyar', 'satyldy')`
  - `visible_shipments(user) -> QuerySet[Shipment]` — agent only: `customer = member.customer`, status in VISIBLE_STATUS_CODES, `deleted_at__isnull=True`; staff/seller → `MarketAccessError`.
  - `lots_for(user) -> QuerySet[Lot]` — seller: `seller=user`; agent: `shipment__customer=member.customer`; staff: `customer_ids_for`; others none. **Not season-scoped.**
  - `open_lot(user, shipment_id: int) -> Lot` — agent: shipment must be in `visible_shipments`; seller: shipment of own customer in VISIBLE_STATUS_CODES (else `LotNotFound`); get-or-create inside `transaction.atomic()` with the shipment row locked; new lot defaults: `boxes_received` (rule below), `boxes_per_pallet = box_count // pallet_count` when both > 0 else 1, `currency = shipment.country.currency or 'KZT'`, `opened_by = user`. **Seller claim:** lot.seller empty → becomes `user` (audit `update`, detail `seller claimed by QR`); lot.seller == user → open; other seller → `MarketAccessError('Машина назначена другому продавцу.')`.
    - Rule for missing `box_count`: `boxes_received = shipment.box_count` if > 0 else `1`, and the lot response carries `needs_receipt: true` (computed: lot has no entries and `boxes_received == 1 and not shipment.box_count`) so the agent is prompted to set the real count. While `needs_receipt` is true, sale and spoilage creates are refused (Task 3) with `MarketRuleError('Пусть агент укажет, сколько ящиков пришло.')` — otherwise the first box would close the truck.
  - `update_lot(user, lot, data: dict) -> Lot` — agent of the lot's customer only (`MarketAccessError(NOT_LOT_AGENT)` otherwise); keys `seller_id` (must be an active `agent_seller` with `AgentMember.customer == lot customer`, or null), `boxes_received` (≥ used, else `MarketRuleError('Уже продано или списано: N ящиков. Меньше поставить нельзя.')`), `boxes_per_pallet` (≥ 1), `tare_g` (0..20000), `default_price_kg` (≥ 0 or null); runs under `select_for_update` on the lot; recomputes `closed_at` (via `totals.refresh_closed(lot)`); audit `update` with the changed keys.
  - Exceptions: `MarketRuleError(message: str, field: str | None = None)` → view 400 `{field: [message]}` when `field` is set, else `{"error": message}` (Task 7 maps both onto the form); `LotNotFound(Exception)` → 404; `MarketAccessError` (exists) → 403.
- `services/totals.py`:
  - `lot_totals(lot) -> dict` with keys `sold_boxes, sold_kg, spoiled_boxes, spoiled_kg, used, left, sales_total, paid_total, debt_total, expenses_total, after_expenses, avg_price_kg` (Decimal or int; `avg_price_kg = sales_total / sold_kg` quantized 0.01, `None` when sold_kg = 0; `debt_total = Σ total of sales with paid_on_spot=False` — Part C replaces it with the allocated due).
  - `refresh_closed(lot) -> bool` — sets / clears `lot.closed_at` from `left == 0`, saves only if changed, returns whether it changed.
- API (`views/lots.py`, all `RussianMixin`, `resource_code='market_lot'`, `DynamicResourcePermission`):
  - `GET /market/lots/` (`?state=open|closed`), `GET /market/lots/{id}/` (detail adds `sales`, `spoilage`, `expenses` lists, newest first), `POST /market/lots/open/` `{shipment_id}` (`@idempotent`), `PATCH /market/lots/{id}/` (agent fields).
  - `GET /market/shipments/` (agent) — `{id, code, export_code, status_code, box_count, pallet_count, product: {code, name_ru} | null, lot_id: int | null}`, arrived first (`status__step_order` desc), then in transit.
  - `GET /market/expense-categories/` → `[{id, code, label}]` in `MARKET_EXPENSES` order (only active rows).
  - `GET /market/buyers/?q=` (autocomplete, max 20, own customer), `POST /market/buyers/` `{name, phone?}` (get-or-create by name, case-insensitive; agent or seller of the customer).
  - Lot item shape: `{id, shipment: {id, code, export_code, status_code, product: {code, name_ru}|null}, seller: {id, name}|null, boxes_received, boxes_per_pallet, tare_g, default_price_kg, currency, opened_at, closed_at, needs_receipt, totals: {…}}` (money / kg as strings like the rest of the API).

- [ ] **Step 1: Write the failing tests** — `tests/test_lots_api.py` (use `factories.make_world`, `APIClient.force_authenticate`):

```python
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.market.models import Lot, Sale
from apps.market.tests.factories import make_shipment, make_world


def _as(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class OpenLotTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()

    def test_agent_opens_lot_with_shipment_defaults(self):
        resp = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body['boxes_received'], 100)
        self.assertEqual(body['boxes_per_pallet'], 50)
        self.assertEqual(body['currency'], 'KZT')
        self.assertIsNone(body['seller'])

    def test_open_twice_returns_same_lot(self):
        a = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        b = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(a.json()['id'], b.json()['id'])
        self.assertEqual(Lot.objects.count(), 1)

    def test_seller_claims_unassigned_lot(self):
        resp = _as(self.w.seller).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertIn(resp.status_code, (200, 201))
        self.assertEqual(Lot.objects.get().seller, self.w.seller)

    def test_second_seller_refused(self):
        _as(self.w.seller).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        resp = _as(self.w.seller2).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()['error'], 'Машина назначена другому продавцу.')

    def test_other_customer_gets_404(self):
        resp = _as(self.w.other_seller).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_draft_shipment_not_openable(self):
        draft = make_shipment(self.w, 'MK-D', 'draft')
        resp = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': draft.pk}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_staff_cannot_open(self):
        resp = _as(self.w.boss).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 403)


class LotListAndPatchTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()
        cls.lot = Lot.objects.create(shipment=cls.w.shipment, seller=cls.w.seller, boxes_received=100,
                                     boxes_per_pallet=50, currency='KZT', opened_by=cls.w.agent)

    def test_seller_sees_only_own_lots(self):
        other = make_shipment(self.w, 'MK-2', 'bardy')
        Lot.objects.create(shipment=other, seller=self.w.seller2, boxes_received=10, boxes_per_pallet=5,
                           currency='KZT', opened_by=self.w.agent)
        ids = [r['id'] for r in _as(self.w.seller).get('/api/v1/market/lots/').json()['results']]
        self.assertEqual(ids, [self.lot.pk])
        self.assertEqual(_as(self.w.seller).get(f'/api/v1/market/lots/{other.market_lot.pk}/').status_code, 404)

    def test_other_agent_404(self):
        self.assertEqual(_as(self.w.other_agent).get(f'/api/v1/market/lots/{self.lot.pk}/').status_code, 404)

    def test_rep_reads_own_customer_lot(self):
        self.assertEqual(_as(self.w.rep).get(f'/api/v1/market/lots/{self.lot.pk}/').status_code, 200)

    def test_agent_patch_receipt_and_seller(self):
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{self.lot.pk}/',
                                       {'boxes_received': 120, 'seller_id': self.w.seller2.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.lot.refresh_from_db()
        self.assertEqual((self.lot.boxes_received, self.lot.seller_id), (120, self.w.seller2.pk))

    def test_patch_seller_of_other_customer_400(self):
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{self.lot.pk}/', {'seller_id': self.w.other_seller.pk},
                                       format='json')
        self.assertEqual(resp.status_code, 400)

    def test_seller_cannot_patch_lot(self):
        resp = _as(self.w.seller).patch(f'/api/v1/market/lots/{self.lot.pk}/', {'boxes_received': 5}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_boxes_received_not_below_used(self):
        Sale.objects.create(lot=self.lot, unit='box', qty=60, boxes=60, gross_kg=Decimal('600'), tare_g=450,
                            net_kg=Decimal('573'), price_kg=Decimal('10'), calc_total=Decimal('5730'),
                            total=Decimal('5730'), created_by=self.w.seller)
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{self.lot.pk}/', {'boxes_received': 50}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('60', resp.json()['error'])

    def test_lists_are_not_season_scoped(self):
        self.w.season.is_closed = True  # use the project's close field/helper if named differently
        self.w.season.save()
        ids = [r['id'] for r in _as(self.w.seller).get('/api/v1/market/lots/').json()['results']]
        self.assertEqual(ids, [self.lot.pk])


class ReferenceListsTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()

    def test_expense_categories_in_market_order(self):
        rows = _as(self.w.seller).get('/api/v1/market/expense-categories/').json()
        self.assertEqual([r['label'] for r in rows], ['Кара', 'Комиссия', 'Плёнка', 'Заезд', 'Парковка', 'Простой', 'Другое'])

    def test_buyers_get_or_create_case_insensitive(self):
        a = _as(self.w.seller).post('/api/v1/market/buyers/', {'name': 'Рустам'}, format='json').json()
        b = _as(self.w.agent).post('/api/v1/market/buyers/', {'name': 'рустам'}, format='json').json()
        self.assertEqual(a['id'], b['id'])
        found = _as(self.w.seller).get('/api/v1/market/buyers/?q=рус').json()
        self.assertEqual([r['name'] for r in found], ['Рустам'])
        self.assertEqual(_as(self.w.other_seller).get('/api/v1/market/buyers/?q=рус').json(), [])

    def test_available_shipments_for_agent(self):
        rows = _as(self.w.agent).get('/api/v1/market/shipments/').json()
        self.assertEqual([r['code'] for r in rows], ['MK-1'])
        self.assertIsNone(rows[0]['lot_id'])
        self.assertEqual(_as(self.w.seller).get('/api/v1/market/shipments/').status_code, 403)
```

Add to `core/tests_agent_perms.py`: `market_lot` grants (agent / agent_seller / admin VCRUD, staff VIEW) and the boss `'*'` field row; the `0077` snapshot matches the seed (copy the 0076 test style).

- [ ] **Step 2: Run** — labels `apps.market.tests.test_lots_api apps.core.tests_agent_perms` → FAIL.
- [ ] **Step 3: Implement** the registry entry (`('market_lot', 'Market: lots, sales, spoilage, expenses')` at the end of RESOURCE_REGISTRY), seed grants (add `'market_lot'` to `_MARKET_RESOURCES` so the staff carve-out applies; agent / agent_seller `market_lot: _VCRUD`; sales_rep `market_lot: _VIEW`; boss already VIEW on `_MARKET_RESOURCES`), migration `0077` (depends on `('core', '0076_seed_agent_market_perms')`, test-DB guard, `_grant`, boss field row, reversible), the services, serializers and views above. Views stay thin: `get_queryset` → `lots_for(request.user)`; `open` action → `open_lot(...)`; `partial_update` → `update_lot(...)`; map `MarketRuleError` → `ValidationError({'error': …})` style 400 and `LotNotFound` → 404 in `RussianMixin.handle_exception` (extend it). Return 201 when the lot was created, 200 when it existed.
- [ ] **Step 4: Run** — labels `apps.market apps.core.tests_agent_perms apps.core.tests_boss_access` → PASS.
- [ ] **Step 5: Commit** — two commits: `feat(core): market_lot permission resource` (registry, seed, 0077, perms tests) and `feat(p3): market lots API — open, claim, receipt, lists`.

---

### Task 3: Sales, spoilage and expenses — create / delete with the stock lock

**Files:**
- Create: `backend/apps/market/services/entries.py`, `backend/apps/market/serializers/entries.py`, `backend/apps/market/views/entries.py`, `backend/apps/market/tests/test_entries_api.py`, `backend/apps/market/tests/test_stock_race.py`
- Modify: `services/__init__.py`, `views/__init__.py`, `urls.py`

**Interfaces:**
- `services/entries.py`:
  - `net_weight(gross_kg: Decimal, boxes: int, tare_g: int) -> Decimal` — `(gross_kg - boxes * tare_g / 1000)` quantized `0.01` `ROUND_HALF_UP`.
  - `create_sale(user, lot_id: int, data: dict) -> Sale` — `data`: `unit`, `qty`, `gross_kg`, `price_kg`, `total` (optional), `paid_on_spot`, `buyer_id` (required when not paid).
  - `create_spoilage(user, lot_id: int, data: dict) -> Spoilage` — `boxes` (≥ 0), `gross_kg` (optional); at least one > 0.
  - `create_expenses(user, lot_id: int, rows: list[dict]) -> list[LotExpense]` — each `{category_id, amount, label?}`; `label` required for `OTHER`; at least one row; created one by one.
  - `delete_entry(user, kind: str, entry_id: int) -> None` — `kind in ('sale', 'spoilage', 'expense')`.
  - Every create/delete: `transaction.atomic()`, `Lot.objects.select_for_update().get(pk=…)` scoped by `lots_for(user)` (not found → `LotNotFound`), then the rules, then `totals.refresh_closed(lot)`, then an audit entry (`create_audit_entry(user, 'create'|'update', 'MarketSale'|'MarketSpoilage'|'MarketExpense', id, repr, detail)` — deletes use action `update` with detail `deleted`).
  - Rules (messages verbatim, Russian):
    - writer must be `lot.seller` for create (agent/staff → `MarketAccessError('Продажи записывает продавец этой машины.')`); delete: the entry's `created_by` if it is still `lot.seller`, or the lot's agent.
    - sale / spoilage create while the lot `needs_receipt` → `MarketRuleError('Пусть агент укажет, сколько ящиков пришло.')`.
    - sale / spoilage create on a closed lot → `MarketRuleError('Машина закрыта. Ящиков не осталось.')`; expenses allowed.
    - sale / spoilage create or delete when `SalesReport` of the shipment exists with `approved_at` set → `MarketRuleError('Отчёт по машине утверждён — изменить продажи нельзя.')`.
    - `left = boxes_received - used` computed **after** the lock. box: `boxes = qty`; pallet: `boxes = qty × boxes_per_pallet`, refuse `qty > left // boxes_per_pallet` with `'Больше нельзя: целых паллет осталось N (M ящиков)'` / `'На целую паллету не хватает. Осталось N ящиков.'`; truck: `boxes = left`, `qty = 1`, refuse when `left == 0`. Any `boxes > left` → `'В машине осталось только N ящиков'` (N with the Russian plural «ящик/ящика/ящиков» — put `plural_ru(n, one, few, many)` in `apps/market/text.py`).
    - `gross_kg` required > 0 (`'Напишите вес с весов.'`); `net_kg ≤ 0` → `'Вес меньше, чем весят пустые ящики (N ящиков по T г).'`; `price_kg > 0` (`'Напишите цену за 1 кг.'`); `calc_total = (net_kg × price_kg)` quantized 0.01; `total = data.total if > 0 else calc_total`.
    - debt: `buyer_id` required (`MarketRuleError('Укажите покупателя.', field='buyer_id')`) and must belong to the lot's customer (else `MarketRuleError('Покупатель не найден.', field='buyer_id')`). Weight / price errors use `field='gross_kg'` / `'price_kg'`; stock errors use `field='qty'`.
    - spoilage: `boxes ≤ left`; `net_kg = net_weight(...)` when `gross_kg`, must be ≥ 0; else 0.
    - expense `amount > 0`; `category_id` must be one of the `MARKET_EXPENSES` codes.
  - Status driving: when the new sale is the lot's first, `create_sale` schedules `transaction.on_commit(lambda: drive_first_sale(lot.pk, user))` (`services/status.py`). In this task create `services/status.py` with that function as a documented stub that returns `False` (docstring: "Filled in by Part B Task 4"); Task 4 implements it. The call site is final.
- API: `POST /market/lots/{id}/sales/`, `DELETE /market/lots/{id}/sales/{sale_id}/`, `POST|DELETE …/spoilage/…`, `POST /market/lots/{id}/expenses/` (body `{rows: [...]}`), `DELETE …/expenses/{expense_id}/`. All `@idempotent`. Create responds 201 with the entry and the fresh lot `{entry, lot}` (lot in the Task 2 shape) so the phone updates totals in one round-trip; delete responds 200 `{lot}`.

- [ ] **Step 1: Write the failing tests** — `tests/test_entries_api.py` (factories, `_as`), at minimum:
  - box sale: 10 boxes, gross `104.50`, price `45` → net `100.00`, calc_total `4500.00`, total `4500.00`; lot totals `sold_boxes=10, left=90, sales_total=4500.00`.
  - pallet sale `qty=1` → 50 boxes; `qty=3` with 100 left → 400 «Больше нельзя: целых паллет осталось 2 (100 ящиков)».
  - truck sale → boxes = left; lot `closed_at` set; a following box sale → 400 «Машина закрыта. Ящиков не осталось.»; an expense on the closed lot → 201.
  - `boxes > left` → 400 «В машине осталось только 90 ящиков» (after a 10-box sale).
  - manual total `4510` → stored total `4510.00`, calc `4500.00`.
  - debt without buyer → 400 `buyer_id`; debt with other customer's buyer → 400; debt with own buyer → 201, `debt_total = total`.
  - net ≤ 0 (gross `4.0` for 10 boxes at 450 g) → 400 with «Вес меньше».
  - agent creating a sale → 403; `seller2` (not the lot's seller) → 403; other customer's seller → 404.
  - delete the sale that closed the lot → `closed_at` cleared; seller deletes own sale → 200; agent deletes → 200; seller2 deletes → 403.
  - SalesReport approved (`SalesReport.objects.create(shipment=…, approved_at=timezone.now(), …)` with the model's required fields) → sale create and delete → 400 «Отчёт по машине утверждён…»; expense create still 201.
  - spoilage `boxes=0, gross_kg=None` → 400; `boxes=3, gross_kg=31.35` → net `30.00`, left decreases by 3.
  - expenses batch `[{KARA, 500}, {INTERES, 5000}, {OTHER, 300, label: 'Охрана'}]` → 3 rows, `expenses_total=5800.00`, `after_expenses = sales_total − 5800`; OTHER without label → 400.
  - each create writes one audit row (`AuditLog` model `MarketSale` etc.).
  - `tests/test_stock_race.py`: a `TransactionTestCase` (copy the setup notes of `core/tests/test_idempotency_concurrency.py` — no `serialized_rollback`) with two threads each POSTing a sale for the last 10 boxes of a lot via `create_sale` directly (own DB connections; `close_old_connections()` in each thread): exactly one succeeds, the other raises `MarketRuleError`; `Sale.objects.filter(lot=…).aggregate(Sum('boxes'))` == boxes_received. If MSSQL test infra makes the threaded test flaky, keep it and mark the reason in the report — do not delete it.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** services, serializers (input validation of shapes only — rules live in services), views (nested routes via `@action(detail=True, methods=['post'], url_path='sales')` and `@action(detail=True, methods=['delete'], url_path=r'sales/(?P<entry_id>\d+)')`, same for spoilage / expenses), `text.py` with `plural_ru`.
- [ ] **Step 4: Run** — labels `apps.market` → PASS.
- [ ] **Step 5: Commit** — `feat(p3): market sales, spoilage and expenses with the stock lock`.

---

### Task 4: First sale drives the shipment status

**Files:**
- Create: `backend/apps/market/services/status.py`, `backend/apps/market/tests/test_status_driving.py`
- Modify: `backend/apps/market/services/entries.py` (call site already there)

**Interfaces:**
- `drive_first_sale(lot_id: int, user) -> bool` — scheduled by `create_sale` with `transaction.on_commit(...)` **only when the new sale is the lot's first** (`lot.sales.count() == 1`), so it runs after the sale is committed and the lot lock is released (no Lot→Shipment vs Shipment→Lot lock-order deadlock with `open_lot`). It runs in its own `transaction.atomic()`, wraps everything in `try/except Exception` → `logger.exception(...)` + return False: a failure here must never lose or 500 the sale. Role check: `transition_to(is_auto=True)` skips the role check (verified in `export/services/shipment.py`), so `updated_by = <the seller>` is fine and the status log names the seller. Locks the shipment (`Shipment.objects.select_for_update().select_related('status', 'season').get(pk=lot.shipment_id)`); if `shipment.season.is_closed` (use the project helper `assert_season_open` / `SeasonClosedError`) → return `False` without saving. Else: `before = snapshot_fields(shipment, ['arrived_at', 'sale_started_at', 'city'])`; `now = timezone.now()`; status code in `('barysh_gumrugi', 'transshipment')` and `arrived_at is None` → `arrived_at = now`; `sale_started_at is None` → `sale_started_at = now`; `city_id is None` and the seller's bazaar has a city → `city = bazaar.city`; if nothing changed → return False; `shipment.updated_by = user`; `shipment.save()` (catch `SeasonClosedError` → return False); `AuditLog.objects.bulk_create(diff_audit_rows(shipment, before, snapshot_fields(shipment, [...]), user), batch_size=500)`; return True. Comment: AD-1 is retired (ADR-010 2026-05 amendment) — writing these operator-entered fields from a service is allowed; status itself is only moved by auto-advance → `transition_to()`.

- [ ] **Step 1: Write the failing tests** — `tests/test_status_driving.py` (`setUpTestData`: `make_world()` + `call_command('seed_task_rules', stdout=StringIO())`; create each shipment at its status and call `generate_tasks_for_status(shipment, code)` like `tests_auto_advance.PeregruzForkTests._make_at_status`; then POST a first sale as the seller via the API):
  - (wrap every first-sale POST in `with self.captureOnCommitCallbacks(execute=True):`)
  - `bardy` with `city` set → after the first sale `status.code == 'satylyar'`, `sale_started_at` set.
  - `bardy` without city, seller's bazaar has a city → `city` filled from the bazaar, status `satylyar`.
  - `bardy` without city, seller (`seller2`) on a bazaar without city → status stays `bardy`, `sale_started_at` set, sale 201.
  - `barysh_gumrugi` with `has_peregruz=False` → `arrived_at` set and status in `('bardy', 'satylyar')` (record which one in the report).
  - second sale → no further change (`sale_started_at` unchanged).
  - closed season → sale 201, shipment fields unchanged, status unchanged.
  - `Shipment.save` raising (patch it to raise `RuntimeError`) → the sale is still 201 and stored; the error is logged. (TestCase does not run `on_commit` callbacks by default — use `self.captureOnCommitCallbacks(execute=True)` around the POST.)
  - audit rows exist for the filled fields (`AuditLog.model_name == 'Shipment'`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `status.py`; remove the Task 3 stub.
- [ ] **Step 4: Run** — labels `apps.market apps.export.tests_auto_advance` → PASS.
- [ ] **Step 5: Commit** — `feat(p3): first market sale moves the shipment to satylyar`.

---

### Task 5: Market app plumbing — types, hooks, toast, Sheet focus, Russian login errors, `/m/scan/:id` + main-app forward

**Files:**
- Create: `frontend/src/market-app/types.ts`, `frontend/src/market-app/hooks/lotKeys.ts`, `hooks/useLots.ts`, `hooks/useLot.ts`, `hooks/useLotEntries.ts`, `hooks/useMarketShipments.ts`, `hooks/useExpenseCategories.ts`, `hooks/useBuyers.ts`, `frontend/src/market-app/components/Toast.tsx`, `components/ToastHost.tsx`, `components/toastStore.ts`, `frontend/src/market-app/format.ts` (+ `format.test.ts`), `frontend/src/market-app/screens/ScanClaimScreen.tsx` (+ test)
- Modify: `frontend/src/market-app/components/Sheet.tsx` (focus move / trap / return + body scroll lock), `screens/LoginScreen.tsx` (map login errors to Russian text), `market-app/App.tsx` (routes `lots/:id`, `scan/:id`), `frontend/src/pages/scan/ScanPage.tsx` (external roles → `window.location.replace('/m/scan/' + id)` before any export call), i18n ×3

**Interfaces:**
- `types.ts`: `ILotTotals`, `ILot`, `ILotDetail` (`sales: ISale[]; spoilage: ISpoilage[]; expenses: IExpense[]`), `ISale`, `ISpoilage`, `IExpense`, `IMarketShipment`, `IExpenseCategory {id; code; label}`, `IBuyer {id; name; phone}`, `ISaleInput {unit: 'box'|'pallet'|'truck'; qty: number; gross_kg: string; price_kg: string; total?: string; paid_on_spot: boolean; buyer_id?: number}`, `ISpoilageInput`, `IExpenseRowInput` — fields exactly as the Task 2/3 API (money and kg are strings).
- Hooks: `useLots(state)`, `useLot(id)`, `useOpenLot()` (POST open → returns `ILot`), `useUpdateLot(id)`, `useCreateSale(lotId)`, `useCreateSpoilage(lotId)`, `useCreateExpenses(lotId)`, `useDeleteEntry(lotId)` (`{kind, id}`), `useMarketShipments()`, `useExpenseCategories()`, `useBuyers(q)`, `useCreateBuyer()`. Every mutation sends `Idempotency-Key` (`useIdempotencyKey`, reset on success) and writes the returned `lot` into the `['market','lot',id]` cache + invalidates `['market','lots']`.
- `format.ts`: `groupThousands(raw: string, decimals: number): string` (live input spacing, comma or dot = decimal mark), `parseDecimal(s: string): number | null`, `money(v: string | number, currency: string): string` (`25 700 ₸`, `18 000 ₽`, symbol after), `kg(v)`, `pluralRu(n, one, few, many)`, `boxes(n)` («1 ящик / 2 ящика / 5 ящиков»), `netKg(grossKg, boxes, tareG): number` (preview only).
- Toast: `showToast({text, actionLabel?, onAction?, ms?})` from `toastStore.ts`; `ToastHost` mounted once in `Shell`; default 3.5 s, 7 s with an action; `role="status"`.
- `Sheet`: on open focuses the first focusable element, traps Tab inside, restores focus to the opener on close, locks `document.body` scroll while open.
- `ScanClaimScreen` (`/m/scan/:id`): calls `useOpenLot().mutate({shipment_id})` once on mount → `navigate('/lots/' + lot.id, {replace: true})`; 403 / 404 → shows the server's Russian message and a «К машинам» button.
- `LoginScreen`: 401 / 400 from `/auth/login/` → «Неверный логин или пароль»; network error → «Нет связи. Проверьте интернет.»
- Main app `frontend/src/pages/auth/LoginPage.tsx`: Part A sends every external role to `/m/` and drops `next`. Change it: an external role whose `next` starts with `/scan/` goes to `window.location.replace('/m' + next)` (the seller who was logged out when scanning lands on the claim, no second scan); any other `next` still → `/m/`. Add a test to `LoginPage.test.tsx`.

- [ ] **Step 1: Tests first** — `format.test.ts` (grouping keeps the caret logic simple: input `1000000` → `1 000 000`; `12,5` → `12,5`; `boxes(1|2|5|11|21)`; `money('25700.00','KZT') === '25 700 ₸'`; `netKg(104.5, 10, 450) === 100`), `ScanClaimScreen.test.tsx` (mock api: POST open → 201 lot 7 → navigates to `/lots/7`; 403 → shows message), `Sheet` focus test (open → first input focused; Tab from last wraps to first; close → opener focused), `LoginScreen` wrong password → «Неверный логин или пароль», `ScanPage` test: user role `agent_seller` → `window.location.replace('/m/scan/5')` and no `/export/` request.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** `npx vitest run src/market-app src/pages/scan` → PASS; tsc; build (no antd in `m`).
- [ ] **Step 5: Commit** — `feat(frontend): market app plumbing — lots hooks, toast, focus-safe sheet, QR claim route`.

---

### Task 6: Lots list (home) and the lot screen (read side)

**Files:**
- Create: `frontend/src/market-app/components/TruckRig.tsx` (+ test), `components/LeftLine.tsx`, `components/LotCard.tsx`, `components/LotStats.tsx`, `components/EntryList.tsx`, `components/EntryRow.tsx`, `components/DayHeader.tsx`, `screens/LotScreen.tsx` (+ test), `screens/home/OpenLotsList.tsx`, `screens/home/ClosedLotsList.tsx`, `screens/home/InTransitList.tsx`
- Modify: `screens/HomeScreen.tsx`, `styles/base.css` (only `mk-` classes), i18n ×3

**Behaviour (artifact study §3.1, §3.4, §3.6 list part):**
- Home (seller): open lots (newest first) as `LotCard`s in `.mk-list` (1/2/3 columns): shipment code + export code, product tag when not tomato, `TruckRig` (cab + pallets filling by what is left; ≤ 44 cells), `LeftLine` («90 ящиков осталось из 100»), money line «Оплачено X» (green) / «Долг X» (amber), costs and spoilage lines; then «Закрытые машины» (compact rows). Agent home: the same plus «В пути и прибывшие» from `useMarketShipments()` (rows not yet opened: code, status label, «Открыть» → `useOpenLot` → lot screen; arrived first). Empty state as today.
- Lot screen: back to «Машины»; title (code), product tag, big `TruckRig`, `LeftLine`; stats card (sold boxes, net kg, sales, costs, after costs, paid, debt, spoilage, «Разница с формулой» when Σ(total−calc) ≠ 0); entries list grouped by local day (`DayHeader`: «Сегодня, 8 октября» / «7 октября», day net = sales − costs, day line «Продажи X, расходы Y, Z кг, средняя цена W»); `EntryRow` for sale («12 ящиков, 80,5 кг», «14:35, 45 ₸ за 1 кг», total; «Долг: Рустам» tag), spoilage (amber), expense (red, −X). Delete buttons come in Task 8.
- Layout: from 1000 px two columns (form left — empty placeholder slot for Task 7 — stats + list right).

- [ ] **Step 1: Tests** — `TruckRig.test.tsx` (100 boxes / 50 per pallet / 25 used → 2 cells, first 100 % then 50 %… assert `--p` style values), `LotScreen.test.tsx` (mock a lot detail with 2 sales on two days + 1 expense → two day headers, totals text, debt tag), `HomeScreen` agent case shows the in-transit row with «Открыть».
- [ ] **Steps 2–4** as usual (`npx vitest run src/market-app`, tsc, build).
- [ ] **Step 5: Commit** — `feat(frontend): market lots list and lot screen`.

---

### Task 7: Sell form (box / pallet / whole truck, weight, price, total, paid / debt + buyer)

**Files:**
- Create: `frontend/src/market-app/screens/lot/SellForm.tsx`, `lot/UnitPicker.tsx`, `lot/QtyStepper.tsx`, `lot/WeightField.tsx`, `lot/PriceTotalFields.tsx`, `lot/PayToggle.tsx`, `lot/BuyerField.tsx`, `lot/sellFormState.ts` (+ `sellFormState.test.ts`), `lot/SellForm.test.tsx`
- Modify: `screens/LotScreen.tsx` (form in the left column when the user is the lot's seller and the lot is open; closed → card «Машина закрыта. Ящиков не осталось.»), i18n ×3

**Behaviour (study §3.5 — the most important screen):**
- «Что продаёте?»: Ящик / Паллета / Вся машина. (The «Испорчено» and «Расходы по машине» buttons are added in Task 8.)
- Stepper `− N +` (76 px buttons, number 52 px), min 1, capped at the max with the amber hint («В машине осталось только N ящиков», pallets: «Больше нельзя: целых паллет осталось N (M ящиков)», «На целую паллету не хватает. Осталось N ящиков.»); «Вся машина» shows «Всё, что осталось: N ящиков».
- «Вес с ящиками, кг» (required, live spacing, 3 → keep 2 decimals to match the API) with the hint «Чистый вес: X кг (минус N ящиков по T г)» or the amber «Вес меньше, чем весят пустые ящики…».
- «Цена за 1 кг, ₸» prefilled from the last sale's price, else `lot.default_price_kg`; «Итого, ₸ (можно исправить)» auto = net × price until edited; when edited and different: «По формуле: X. Разница: +Y».
- «✓ Оплачено» (default) / «В долг»; «В долг» shows «Кто покупает?» with autocomplete (`useBuyers(q)`); typing a new name → created with `useCreateBuyer` on save; save without a buyer blocked with «Укажите покупателя.».
- «Сохранить продажу» (70 px, tomato) disabled while invalid or 700 ms after a save; on success: form resets (unit box, paid, qty 1, weight / total / buyer cleared, price kept), toast «Сохранено: 12 ящиков, 80,5 кг, 4 025 ₸» (+ «. Машина закрыта.» when the returned lot is closed) with «Отменить» (7 s) → `useDeleteEntry({kind: 'sale', id})`.
- Server 400 messages shown under the right field (`utils/drfErrors.ts`); `error` text in a form-level line.
- `sellFormState.ts` holds the pure logic (boxes for unit, max, caps, hints, calc total, validity) — tested without React.
- Pallet/whole-truck/caps are previews; the server is the authority (it re-checks under the lock).

- [ ] **Step 1: Tests** — `sellFormState.test.ts` (box/pallet/truck boxes; caps and hint texts; net & calc; manual total diff; invalid when weight ≤ tare; debt without buyer invalid), `SellForm.test.tsx` (fill 10 boxes, 104,5 kg, 45 → POST body `{unit:'box', qty:10, gross_kg:'104.50', price_kg:'45.00', paid_on_spot:true}`; toast with «Отменить» → DELETE called; server 400 on `gross_kg` shows under the weight field).
- [ ] **Steps 2–4**, **Step 5: Commit** — `feat(frontend): market sell form`.

---

### Task 8: Spoilage sheet, expenses sheet, deleting entries

**Files:**
- Create: `frontend/src/market-app/screens/lot/SpoilageSheet.tsx`, `lot/ExpensesSheet.tsx`, `lot/ConfirmDeleteSheet.tsx`, tests for each
- Modify: `components/EntryRow.tsx` (delete button for the author seller and the agent), `lot/SellForm.tsx` (show «Испорчено» and «Расходы по машине» buttons), `screens/LotScreen.tsx` (closed lot: «Расходы по машине» still available), i18n ×3

**Behaviour (study §3.6–§3.8):**
- Spoilage sheet: «Сколько ящиков испортилось?» stepper (min 0), «Вес с ящиками, кг» optional («Вес можно не писать.»), hint «Только вес. Ящики остаются в машине.» when 0 boxes; «Списать» (amber) → toast «Списано: 3 ящика, 30 кг» + «Отменить».
- Expenses sheet: one row per `useExpenseCategories()` item (label left, amount right), last row «Другое» with a name input + amount; «Всего расходов» live sum; «Сохранить расходы» posts only filled rows in one request; errors «Напишите хотя бы одну сумму.» / «Напишите название расхода.»; toast «Расходы: 3 записи, 12 000 ₸» + «Отменить» (deletes the batch — call `useDeleteEntry` per returned id).
- Delete: trash button on each row → `ConfirmDeleteSheet` («Удалить эту продажу?» / «Удалить эту запись?», the row text, «Удалить» / «Отмена»).
- Every sheet uses the Task 5 focus-safe `Sheet`.

- [ ] **Step 1: Tests** — spoilage POST body and toast; expenses: two filled rows + Другое without name → error; valid → one POST `{rows:[…]}`; delete confirm → DELETE `…/sales/{id}/`; agent sees delete buttons, `seller2` (not author) does not.
- [ ] **Steps 2–4**, **Step 5: Commit** — `feat(frontend): market spoilage, expenses and entry delete`.

---

### Task 9: Agent controls on the lot and the team edit UI

**Files:**
- Create: `frontend/src/market-app/screens/lot/ReceiptSheet.tsx` (boxes received, per pallet, tare g, default price), `lot/AssignSellerSheet.tsx`, `screens/team/BazaarEditSheet.tsx`, `screens/team/SellerMoveSheet.tsx`, tests
- Modify: `screens/LotScreen.tsx` (agent: buttons «Приёмка» and «Продавец: …»; `needs_receipt` → amber banner «Укажите, сколько ящиков пришло»), `screens/TeamScreen.tsx` + `screens/team/*` (bazaar card: «Изменить» → rename / deactivate; seller card: «Базар» → move), i18n ×3

**Behaviour:** PATCH `/market/lots/{id}/` with the changed fields; server 400 «Уже продано или списано: N ящиков…» shown under the boxes field; seller picker lists active sellers of the customer (`useSellers`) + «Без продавца». Team: PATCH bazaar `{name, is_active}`, PATCH seller `{bazaar_id}` (API exists since Part A).

- [ ] **Step 1: Tests** — receipt PATCH body; 400 shown; assign seller PATCH `{seller_id}`; bazaar rename PATCH; seller move PATCH `{bazaar_id}`.
- [ ] **Steps 2–4**, **Step 5: Commit** — `feat(frontend): market lot receipt, seller assignment and team edits`.

---

### Task 10: Docs and logs

**Files:** `docs/obsidian/processes/agent-market.md` (Part B section: lot lifecycle, stock lock, status driving rules incl. city-from-bazaar and closed-season skip, QR claim, roles matrix for `market_lot`), `docs/obsidian/processes/permissions-system.md` (`market_lot`), `.claude/skills/api-contract/SKILL.md` (Task 2–3 endpoints and shapes, from the serializers), `CHANGELOG.md` ([Unreleased] → Added, with **Deploy:** `migrate core market` (core 0077, market 0002 / 0003), frontend image rebuild, `seed_permissions` after the beta deploy), `BUILD_TEST_LOG.md` (new top entry, Russian, To test steps: agent opens an arrived truck; seller scans the pallet QR → lot claimed; box / pallet / whole-truck sale; weight minus tare; debt sale with a new buyer; spoilage; expenses; undo; truck closes at 0 and reopens after a delete; shipment becomes «Продаётся» after the first sale (Sheet); two phones selling the last boxes at once → one refused), `docs/superpowers/plans/2026-10-08-agent-market-a-followups.md` (strike what Part B did).

- [ ] **Step 1:** write the docs. **Step 2:** full run — backend `apps.market apps.core apps.export.tests_auto_advance apps.export.tests_full_cycle apps.export.tests_sheet_perms`; frontend full `npx vitest run`, tsc, build. **Step 3: Commit** — `docs: agent market part B`.

## After Part B

Part C: payments, FIFO allocation, payment undo, debts screen (replaces `debt_total`). Part D: agent panel, our analytics, Excel. Part E: «Отчёт готов», SalesReport build, `journal_open`, approval freeze already enforced here.
