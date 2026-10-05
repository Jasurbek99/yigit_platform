# Invoice Auto-Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sale gets its invoice number automatically, counted per export firm per calendar year above an admin-entered floor. A firm change or a cancel that orphans sales warns first and then deletes them (plus their one-time contracts).

**Architecture:** A new `contracts.InvoiceNumberBase(export_firm, year, last_number)` table holds the floor. `contracts/services/invoice_number.py` allocates the smallest free number above it while holding a row lock. Allocation runs from «Привязать», from manual sale create, and from invoice download as a fallback. `release_orphan_sales()` deletes sales whose firm left the truck or whose truck was cancelled. A frontend guard previews that deletion through the same endpoint, asks for confirmation, then calls it after the export-side change succeeds. The export app never imports contracts.

**Tech Stack:** Django 5 + DRF 3.17 on MSSQL (mssql-django), React 18 + TypeScript + antd + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-invoice-auto-numbering-design.md`. Read it before starting any task. The decisions table there is the owner's word.

## Global Constraints

- MSSQL: no `JSONField`, no `DISTINCT ON`, `bulk_create(batch_size=500)`. Call `.order_by()` before every `values().annotate()` GROUP BY, because `ContractSale.Meta.ordering` leaks into GROUP BY.
- Dependency direction: `export` never imports `contracts` (`backend/CLAUDE.md` strict list). The §3 example there contradicts this; follow the strict list. No Django signals.
- Status transitions are untouched. Production code never writes `Shipment.status_id`. Tests may set a cancelled status directly as setup.
- A sale's firm is `sale.export_firm_id or sale.contract.export_firm_id`. `sale.export_firm` is nullable; `sale.contract` is not.
- Numbering year = `invoice_date.year`. When a sale has no date: `shipment.date`, then `timezone.localdate()`.
- Allocation = the smallest `n > last_number` that no sale of that firm/year holds. Freed numbers are reused. This is a **provisional** choice (memory `project_invoice_number_gap_fill_open`).
- `uq_sale_contract_invoice (contract, invoice_number)` stays. The owner confirmed that framework contracts never cross a year.
- Excel-imported sales (`shipment_id IS NULL`) are never deleted by the release code.
- Season write freeze (D1): a sale whose `freeze_season_of()` season is closed gets no number and no printed mark.
- UI copy: «Фактура» / «Faktura» / «Invoice» for the invoice (existing term). Never «черновик» / «draft» / «garalama». i18n goes in all three of `ru.json`, `tk.json` and `en.json`.
- From Task 3 on, any local test click on «Привязать» or an invoice download writes a **real** invoice number into the live DB. Test on a throwaway truck, or agree the footprint with the user (memory `feedback_e2e_after_hours`).
- New DB columns stay nullable or live in a new table. Beta runs the old code on the same DB (memory `feedback_not_null_needs_db_default`).
- Migrations: before writing one, run `ls backend/apps/contracts/migrations/ | tail -3` **and** `git log --oneline origin/main -5`. Today the last is `0014_contract_agreement_downloaded_at`, so the next are `0015`/`0016`. If another session took `0015`, renumber **yours** (it is unapplied). After `makemigrations`, run `python manage.py migrate contracts` and confirm with `showmigrations contracts` (memory `feedback_apply_migrations`).
- Backend tests: `cd backend && python manage.py test <module> --keepdb --noinput`. If another `manage.py test` is running, use the private test DB settings from memory `project_test_db_name_collision` before trusting a red run.
- Frontend type-check: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken). Tests: `cd frontend && npx vitest run <file>`.
- Commits: **only after the user has said "commit"** (root `CLAUDE.md`). One commit per task, explicit paths only. Run `git status` and `git diff --cached` first (shared index). End messages with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Subagent execution: Tasks 1–6 go to `backend-dev`, Tasks 7–9 to `frontend-dev`, Task 10 to the main session, and gates to `reviewer`. **Subagents treat git as read-only.** They stop before "Commit" and report their file list.

## Review Focus

1. **Two «Привязать» clicks for the same firm at the same moment.** Expected: two different numbers. The guard is `select_for_update()` on the floor row. Pinned in Task 2 by a spy test that allocation locks that row.
2. **Excel-imported sales (`shipment_id IS NULL`) of a firm that leaves a truck.** Expected: untouched. Pinned in Task 5.
3. **Downloading an invoice of a closed season that has no number.** Expected: the document still prints, and no number or printed mark is written. Pinned in Task 2 (`test_closed_season_is_left_alone`).
4. **A firm edit that only changes weights (same firm set), or a junk `keep=` parameter.** Expected: an empty preview, no modal, nothing deleted, and a 400 (not a 500) for junk. Pinned in Tasks 5 and 7.
5. **A PATCH that moves a sale's `invoice_date` into a year where that firm already uses the same number.** Expected: 400 naming the firm and year. Pinned in Task 4.

## Execution Order (gate in the middle)

Dev, beta and every local runserver share **one live DB** (`YIGIT_PLATFROM`). Once Task 3's code is in the shared tree, any «Привязать» or invoice download from any session's autoreloading runserver hands out **real** invoice numbers. Those numbers are counted from the Task 1 seed floors, which are too low.

1. Tasks **1 → 2 → 6 → 8** (the table, the service, the admin endpoint and the admin page; nothing allocates yet).
2. **STOP — gate.** Ask the user to open Export Firms → «Нумерация фактур» on dev and type the real last Excel number for every firm for 2026. Continue only after they confirm.
3. Tasks **3 → 4 → 5 → 7 → 9 → 10**.

Dependencies allow this order: 6 needs only 1, and 8 needs only 6.

---

### Task 1: Floor table, printed flag, migrations

**Files:**
- Create: `backend/apps/contracts/models/invoice_number_base.py`
- Modify: `backend/apps/contracts/models/__init__.py`
- Modify: `backend/apps/contracts/models/contract_sale.py` (after `invoice_date`, ~line 74)
- Create: `backend/apps/contracts/migrations/0015_invoicenumberbase_contractsale_invoice_printed_at.py` (generated)
- Create: `backend/apps/contracts/migrations/0016_seed_invoice_number_bases.py`
- Test: `backend/apps/contracts/tests/test_invoice_number.py` (new)

**Interfaces:**
- Produces: `InvoiceNumberBase` model with fields `export_firm` (FK), `year` (int), `last_number` (int, default 0), `updated_at`, `updated_by`, and unique `(export_firm, year)`. Also `ContractSale.invoice_printed_at: DateTimeField | None`.

- [ ] **Step 1: Write the model**

`backend/apps/contracts/models/invoice_number_base.py`:

```python
"""InvoiceNumberBase — the per-firm, per-year floor for invoice auto-numbering.

Invoice numbers run per export firm within a calendar year and restart at 1 each
January. The platform went live mid-year, after the firms had issued invoices from
Excel, so an admin records here the last number each firm used outside the system;
allocation starts above it. No row = floor 0.
See docs/superpowers/specs/2026-10-03-invoice-auto-numbering-design.md.
"""
from django.conf import settings
from django.db import models

from apps.core.db_utils import schema_table


class InvoiceNumberBase(models.Model):
    export_firm = models.ForeignKey(
        'core.ExportFirm',
        on_delete=models.PROTECT,
        related_name='invoice_number_bases',
    )
    year = models.IntegerField()
    last_number = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='+',
    )

    class Meta:
        db_table = schema_table('contracts', 'invoice_number_base')
        constraints = [
            models.UniqueConstraint(
                fields=['export_firm', 'year'], name='uq_invoice_base_firm_year',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.export_firm_id}/{self.year}: {self.last_number}'
```

- [ ] **Step 2: Re-export it** (without this, migrations silently miss the model)

In `backend/apps/contracts/models/__init__.py`, add `from .invoice_number_base import InvoiceNumberBase` after the `document_layout` import, and add `'InvoiceNumberBase',` to `__all__` in alphabetical order (after `'DocumentLayoutSetting'`).

- [ ] **Step 3: Add the printed flag to `ContractSale`**

In `backend/apps/contracts/models/contract_sale.py`, directly under `invoice_date = models.DateField(null=True, blank=True)`:

```python
    # First time the invoice document was downloaded (single download or packet zip).
    # Drives the «фактура уже напечатана» line in the firm-change / cancel warning.
    invoice_printed_at = models.DateTimeField(null=True, blank=True)
```

Also replace the comment block above `invoice_number` ("Nullable: when a sale is created as the shipment↔contract bridge (Slice 4), the invoice number/date are filled later by a person at document time.") with:

```python
    # Nullable for Excel-era rows. New sales are numbered automatically per export
    # firm per year — see services/invoice_number.py (spec 2026-10-03).
```

- [ ] **Step 4: Generate the schema migration and check the number is free**

```bash
ls backend/apps/contracts/migrations/ | tail -3
git log --oneline origin/main -5
cd backend && python manage.py makemigrations contracts -n invoicenumberbase_contractsale_invoice_printed_at
```

Expected: `0015_invoicenumberbase_contractsale_invoice_printed_at.py` with `CreateModel(InvoiceNumberBase)`, `AddField(invoice_printed_at)` and the constraint.

- [ ] **Step 5: Write the failing seed test**

`backend/apps/contracts/tests/test_invoice_number.py`:

```python
"""Invoice auto-numbering per export firm per year (spec 2026-10-03)."""
import datetime
import importlib
from decimal import Decimal

from django.apps import apps as django_apps
from django.test import TestCase

from apps.contracts.models import ContractSale, InvoiceNumberBase
from apps.contracts.tests.test_contract_sale_api import (
    _make_contract, _make_export_firm, _make_import_firm, _make_season,
)

SEED_MIGRATION = 'apps.contracts.migrations.0016_seed_invoice_number_bases'


def _sale(contract, number, date, shipment=None) -> ContractSale:
    sale = ContractSale.objects.create(
        contract=contract, invoice_number=number,
        invoice_date=date, total_usd=Decimal('100.00'), shipment=shipment,
    )
    sale.refresh_from_db()  # a date passed as 'YYYY-MM-DD' stays a str in memory otherwise
    return sale


class SeedInvoiceNumberBasesTest(TestCase):
    def test_floor_is_the_highest_number_per_firm_and_year(self) -> None:
        season = _make_season()
        imp = _make_import_firm('IMPSEED')
        dm = _make_export_firm('DMSEED')
        ma = _make_export_firm('MASEED')
        c_dm = _make_contract('SEED-DM', dm, imp, season)
        c_ma = _make_contract('SEED-MA', ma, imp, season)
        _sale(c_dm, 7, '2026-03-01')
        _sale(c_dm, 288, '2026-05-01')
        _sale(c_dm, 40, '2025-12-30')
        _sale(c_ma, 300, '2026-06-01')
        _sale(c_ma, None, '2026-06-02')
        InvoiceNumberBase.objects.all().delete()

        importlib.import_module(SEED_MIGRATION).seed_invoice_number_bases(django_apps, None)

        got = {
            (b.export_firm.code, b.year): b.last_number
            for b in InvoiceNumberBase.objects.select_related('export_firm')
        }
        self.assertEqual(
            got, {('DMSEED', 2026): 288, ('DMSEED', 2025): 40, ('MASEED', 2026): 300},
        )
```

If Step 4 produced a different number, put the seed migration at the next number and change `SEED_MIGRATION` to match.

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && python manage.py test apps.contracts.tests.test_invoice_number --keepdb --noinput`
Expected: FAIL with `ModuleNotFoundError: ... 0016_seed_invoice_number_bases`.

- [ ] **Step 7: Write the data migration**

`backend/apps/contracts/migrations/0016_seed_invoice_number_bases.py`:

```python
from django.db import migrations
from django.db.models import Max


def seed_invoice_number_bases(apps, schema_editor):
    """Floor each (export firm, year) at the highest invoice number already in the DB.

    Only a floor: the DB holds a fraction of the invoices Excel issued, so an admin
    must type the real last numbers on «Нумерация инвойсов» before go-live (spec,
    Deploy step 2).
    """
    ContractSale = apps.get_model('contracts', 'ContractSale')
    InvoiceNumberBase = apps.get_model('contracts', 'InvoiceNumberBase')
    rows = (
        ContractSale.objects.filter(invoice_number__isnull=False, invoice_date__isnull=False)
        .order_by()  # Meta.ordering would leak into the GROUP BY
        .values('contract__export_firm_id', 'invoice_date__year')
        .annotate(top=Max('invoice_number'))
    )
    for row in rows:
        InvoiceNumberBase.objects.update_or_create(
            export_firm_id=row['contract__export_firm_id'],
            year=row['invoice_date__year'],
            defaults={'last_number': row['top']},
        )


class Migration(migrations.Migration):
    dependencies = [
        ('contracts', '0015_invoicenumberbase_contractsale_invoice_printed_at'),
    ]

    operations = [
        migrations.RunPython(seed_invoice_number_bases, migrations.RunPython.noop),
    ]
```

- [ ] **Step 8: Run the test to verify it passes, then migrate the dev DB**

```bash
cd backend && python manage.py test apps.contracts.tests.test_invoice_number --keepdb --noinput
python manage.py migrate contracts
python manage.py showmigrations contracts | tail -3
python manage.py makemigrations --check
```

Expected: test PASS. `[X] 0015_…` and `[X] 0016_…` are applied. "No changes detected".

- [ ] **Step 9: Commit** (only after the user's "commit")

```bash
git status
git add backend/apps/contracts/models/invoice_number_base.py backend/apps/contracts/models/__init__.py backend/apps/contracts/models/contract_sale.py backend/apps/contracts/migrations/0015_invoicenumberbase_contractsale_invoice_printed_at.py backend/apps/contracts/migrations/0016_seed_invoice_number_bases.py backend/apps/contracts/tests/test_invoice_number.py
git diff --cached --stat
git commit -m "feat(p4): invoice number floor table and printed flag"
```

---

### Task 2: Allocation service

**Files:**
- Create: `backend/apps/contracts/services/invoice_number.py`
- Test: `backend/apps/contracts/tests/test_invoice_number.py`

**Interfaces:**
- Consumes: `InvoiceNumberBase`, `ContractSale.invoice_printed_at` (Task 1).
- Produces:
  - `allocate_invoice_number(export_firm_id: int, year: int) -> int`. Must run inside `transaction.atomic`.
  - `ensure_invoice_number(sale: ContractSale) -> ContractSale`. Mutates and saves the sale; a no-op when it already has a number or its season is closed.
  - `mark_invoice_printed(sale_ids: Iterable[int]) -> None`

- [ ] **Step 1: Write the failing tests** (append to `test_invoice_number.py`)

```python
from unittest import mock

from django.db import transaction
from django.utils import timezone

from apps.contracts.services.invoice_number import (
    allocate_invoice_number, ensure_invoice_number, mark_invoice_printed,
)
from apps.contracts.tests.test_document_generation import _make_packed_shipment


class AllocateInvoiceNumberTest(TestCase):
    def setUp(self) -> None:
        self.season = _make_season()
        self.imp = _make_import_firm('IMPALLOC')
        self.dm = _make_export_firm('DMALLOC')
        self.ma = _make_export_firm('MAALLOC')
        self.c_dm = _make_contract('ALLOC-DM', self.dm, self.imp, self.season)
        self.c_dm2 = _make_contract('ALLOC-DM2', self.dm, self.imp, self.season)
        self.c_ma = _make_contract('ALLOC-MA', self.ma, self.imp, self.season)

    def _floor(self, firm, year, last) -> None:
        InvoiceNumberBase.objects.update_or_create(
            export_firm=firm, year=year, defaults={'last_number': last},
        )

    def test_no_floor_starts_at_one(self) -> None:
        self.assertEqual(allocate_invoice_number(self.dm.id, 2026), 1)

    def test_starts_above_the_admin_floor(self) -> None:
        self._floor(self.dm, 2026, 288)
        self.assertEqual(allocate_invoice_number(self.dm.id, 2026), 289)

    def test_skips_numbers_taken_on_any_contract_of_the_firm(self) -> None:
        self._floor(self.dm, 2026, 288)
        _sale(self.c_dm, 289, '2026-10-01')
        _sale(self.c_dm2, 290, '2026-10-01')
        self.assertEqual(allocate_invoice_number(self.dm.id, 2026), 291)

    def test_reuses_a_freed_gap(self) -> None:
        self._floor(self.dm, 2026, 288)
        _sale(self.c_dm, 289, '2026-10-01')
        _sale(self.c_dm, 291, '2026-10-02')
        self.assertEqual(allocate_invoice_number(self.dm.id, 2026), 290)

    def test_each_firm_counts_alone(self) -> None:
        self._floor(self.ma, 2026, 300)
        _sale(self.c_dm, 1, '2026-10-01')
        self.assertEqual(allocate_invoice_number(self.ma.id, 2026), 301)
        self.assertEqual(allocate_invoice_number(self.dm.id, 2026), 2)

    def test_new_year_restarts_at_one(self) -> None:
        self._floor(self.dm, 2026, 288)
        _sale(self.c_dm, 289, '2026-12-30')
        self.assertEqual(allocate_invoice_number(self.dm.id, 2027), 1)

    def test_locks_the_floor_row(self) -> None:
        # Review Focus 1: concurrent «Привязать» for one firm serialize on this lock.
        with mock.patch.object(
            InvoiceNumberBase.objects, 'select_for_update',
            wraps=InvoiceNumberBase.objects.select_for_update,
        ) as spy:
            allocate_invoice_number(self.dm.id, 2026)
        spy.assert_called_once_with()


class EnsureInvoiceNumberTest(TestCase):
    def setUp(self) -> None:
        self.season = _make_season()
        self.imp = _make_import_firm('IMPENS')
        self.firm = _make_export_firm('ENSFIRM')
        self.contract = _make_contract('ENS-1', self.firm, self.imp, self.season)
        self.shipment = _make_packed_shipment(self.season, self.imp, code='0303001/25')
        self.shipment.refresh_from_db()  # the helper passes date as a str

    def test_numbers_and_dates_a_bare_bridge_sale(self) -> None:
        sale = _sale(self.contract, None, None, shipment=self.shipment)
        ensure_invoice_number(sale)
        sale.refresh_from_db()
        self.assertEqual(sale.invoice_number, 1)
        self.assertEqual(sale.invoice_date, datetime.date(2025, 10, 1))  # the truck's date

    def test_keeps_an_existing_number(self) -> None:
        sale = _sale(self.contract, 77, '2025-10-05', shipment=self.shipment)
        ensure_invoice_number(sale)
        sale.refresh_from_db()
        self.assertEqual(sale.invoice_number, 77)

    def test_keeps_a_typed_date_and_numbers_in_its_year(self) -> None:
        InvoiceNumberBase.objects.create(export_firm=self.firm, year=2026, last_number=50)
        sale = _sale(self.contract, None, '2026-01-03', shipment=self.shipment)
        ensure_invoice_number(sale)
        sale.refresh_from_db()
        self.assertEqual((sale.invoice_number, sale.invoice_date), (51, datetime.date(2026, 1, 3)))

    def test_closed_season_is_left_alone(self) -> None:
        # Review Focus 3: the write freeze outranks the fallback numbering.
        type(self.season).objects.filter(pk=self.season.pk).update(closed_at=timezone.now())
        self.season.refresh_from_db()
        sale = _sale(self.contract, None, None, shipment=self.shipment)
        ensure_invoice_number(ContractSale.objects.get(pk=sale.pk))
        sale.refresh_from_db()
        self.assertIsNone(sale.invoice_number)


class MarkInvoicePrintedTest(TestCase):
    def test_first_print_wins(self) -> None:
        season = _make_season()
        contract = _make_contract(
            'PRN-1', _make_export_firm('PRNFIRM'), _make_import_firm('IMPPRN'), season,
        )
        sale = _sale(contract, 5, '2025-10-01')
        mark_invoice_printed([sale.pk])
        sale.refresh_from_db()
        first = sale.invoice_printed_at
        self.assertIsNotNone(first)
        mark_invoice_printed([sale.pk])
        sale.refresh_from_db()
        self.assertEqual(sale.invoice_printed_at, first)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python manage.py test apps.contracts.tests.test_invoice_number --keepdb --noinput`
Expected: `ImportError: cannot import name 'allocate_invoice_number'`.

- [ ] **Step 3: Write the service**

`backend/apps/contracts/services/invoice_number.py`:

```python
"""Invoice auto-numbering — per export firm, per calendar year (spec 2026-10-03).

A sale's invoice number is the smallest number above the firm's yearly floor
(InvoiceNumberBase.last_number, typed by an admin; 0 when no row) that no sale of
that firm/year holds. A number freed by a deleted sale is therefore reused — the
owner's provisional choice (memory project_invoice_number_gap_fill_open); switching
to "never reuse" changes only allocate_invoice_number.
"""
from __future__ import annotations

from collections.abc import Iterable

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.contracts.models import ContractSale, InvoiceNumberBase
from apps.core.seasons import freeze_season_of


def allocate_invoice_number(export_firm_id: int, year: int) -> int:
    """Next free invoice number for a seller in a year.

    Locks the firm/year floor row, so two concurrent callers for the same firm
    serialize instead of both taking the same number. Call inside
    ``transaction.atomic`` (select_for_update refuses to run outside one).
    """
    base, _ = InvoiceNumberBase.objects.get_or_create(export_firm_id=export_firm_id, year=year)
    base = InvoiceNumberBase.objects.select_for_update().get(pk=base.pk)
    used = set(
        ContractSale.objects.filter(
            contract__export_firm_id=export_firm_id,
            invoice_date__year=year,
            invoice_number__gt=base.last_number,
        )
        .order_by()
        .values_list('invoice_number', flat=True)
    )
    number = base.last_number + 1
    while number in used:
        number += 1
    return number


@transaction.atomic
def ensure_invoice_number(sale: ContractSale) -> ContractSale:
    """Give a sale its invoice number and date if it has no number yet.

    Date: the sale's own invoice_date, else the truck's date, else today. A sale
    of a closed season is left as is (write freeze D1) — its document still prints.
    """
    if sale.invoice_number is not None:
        return sale
    season = freeze_season_of(sale)
    if season is not None and season.is_closed:
        return sale
    if sale.invoice_date is None:
        truck_date = sale.shipment.date if sale.shipment_id else None
        sale.invoice_date = truck_date or timezone.localdate()
    sale.invoice_number = allocate_invoice_number(
        sale.contract.export_firm_id, sale.invoice_date.year,
    )
    sale.save(update_fields=['invoice_number', 'invoice_date', 'updated_at'])
    return sale


def mark_invoice_printed(sale_ids: Iterable[int]) -> None:
    """Stamp the first invoice download. Later downloads keep the first stamp;
    closed-season sales are not written (write freeze D1)."""
    ContractSale.objects.filter(
        Q(contract__season__isnull=True) | Q(contract__season__closed_at__isnull=True),
        pk__in=list(sale_ids),
        invoice_printed_at__isnull=True,
    ).update(invoice_printed_at=timezone.now())
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && python manage.py test apps.contracts.tests.test_invoice_number --keepdb --noinput`
Expected: all PASS.

- [ ] **Step 5: Commit** (only after the user's "commit")

```bash
git status
git add backend/apps/contracts/services/invoice_number.py backend/apps/contracts/tests/test_invoice_number.py
git diff --cached --stat
git commit -m "feat(p4): allocate invoice numbers per export firm per year"
```

---

### Task 3: Number at «Привязать» and at download; printed mark

**Files:**
- Modify: `backend/apps/contracts/services/shipment_firm_contracts.py` (module docstring lines 10-11, `link_split_to_contract` ~line 235-256)
- Modify: `backend/apps/contracts/views.py` (`ContractSaleViewSet.document` ~line 529-545, `ShipmentCmrView.get`, `ShipmentTirView.get`, `ShipmentPacketZipView.get` ~line 755-770). The CMR and the TIR carnet also print every invoice number on the truck (`document_context.py` ~514 and ~834).
- Test: `backend/apps/contracts/tests/test_shipment_firm_contracts.py`, `backend/apps/contracts/tests/test_invoice_number.py`

**Interfaces:**
- Consumes: `ensure_invoice_number`, `mark_invoice_printed` (Task 2).
- Produces: `link_split_to_contract(...)` now returns a sale that carries `invoice_number` and `invoice_date`.

- [ ] **Step 1: Write the failing tests**

In `test_shipment_firm_contracts.py`, `LinkServiceTest.test_one_time_creates_contract_and_bridge`: replace
`self.assertIsNone(sale.invoice_number)  # filled later by a person` with:

```python
        self.assertEqual(sale.invoice_number, 1)  # YGT's first number this year
        self.assertEqual(sale.invoice_date, datetime.date(2025, 9, 22))  # the truck's date
```

Add to `LinkServiceTest`:

```python
    def test_link_numbers_above_the_firm_floor(self) -> None:
        from apps.contracts.models import InvoiceNumberBase
        InvoiceNumberBase.objects.create(export_firm=self.ygt, year=2025, last_number=40)
        sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='one_time', contract_id=None, user=self.user, price_per_kg='0.90',
        )
        self.assertEqual(sale.invoice_number, 41)

    def test_relink_to_another_contract_keeps_the_number(self) -> None:
        first = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='one_time', contract_id=None, user=self.user, price_per_kg='0.90',
        )
        fw = Contract.objects.create(
            contract_number='6/25-YGT-EXP', seq=6, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        again = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='framework', contract_id=fw.id, user=self.user,
        )
        self.assertEqual(again.pk, first.pk)
        self.assertEqual(again.invoice_number, first.invoice_number)
```

Append to `test_invoice_number.py`:

```python
from io import BytesIO

from rest_framework.test import APIClient

from apps.contracts.tests.test_contract_sale_api import _SeededPermsMixin, _make_user
from apps.export.models import ShipmentFirmSplit


class InvoiceDownloadNumberingTest(_SeededPermsMixin, TestCase):
    """Fallback numbering + the printed mark on both invoice download paths."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=_make_user('inv_num_dl', 'export_manager'))
        self.season = _make_season()
        self.imp = _make_import_firm('IMPNUMDL')
        self.firm = _make_export_firm('NUMDL')
        self.shipment = _make_packed_shipment(self.season, self.imp, code='0404001/25')
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.firm,
            weight_kg=Decimal('9000'), amount_usd=Decimal('8000'),
        )
        contract = _make_contract('NUMDL-C1', self.firm, self.imp, self.season)
        # Dated but unnumbered — the shape of a sale created before auto-numbering.
        self.sale = ContractSale.objects.create(
            contract=contract, shipment=self.shipment, export_firm=self.firm,
            invoice_date=datetime.date(2025, 10, 1),
            quantity_kg=Decimal('18500.00'), price_per_kg=Decimal('0.0870'),
        )

    def test_invoice_download_numbers_and_marks_printed(self) -> None:
        resp = self.client.get(f'/api/v1/contracts/sales/{self.sale.pk}/document/?place_loading=Kaka')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.invoice_number, 1)
        self.assertIsNotNone(self.sale.invoice_printed_at)

    def test_a_letter_download_neither_numbers_nor_marks(self) -> None:
        resp = self.client.get(f'/api/v1/contracts/sales/{self.sale.pk}/document/?type=ct1_ru')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.sale.refresh_from_db()
        self.assertIsNone(self.sale.invoice_number)
        self.assertIsNone(self.sale.invoice_printed_at)

    def test_cmr_download_numbers_the_trucks_sales_without_marking(self) -> None:
        # The CMR prints every invoice number on the truck, but it is not the invoice.
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/cmr/?place_loading=Kaka')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.invoice_number, 1)
        self.assertIsNone(self.sale.invoice_printed_at)

    def test_packet_zip_numbers_and_marks_printed(self) -> None:
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/packet.zip?place_loading=Kaka')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.invoice_number, 1)
        self.assertIsNotNone(self.sale.invoice_printed_at)
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd backend && python manage.py test apps.contracts.tests.test_invoice_number apps.contracts.tests.test_shipment_firm_contracts --keepdb --noinput
```

Expected: FAIL. `invoice_number` is `None` where `1` / `41` was expected.

- [ ] **Step 3: Number at «Привязать»**

In `shipment_firm_contracts.py`:
- Add the import `from apps.contracts.services.invoice_number import ensure_invoice_number` next to the `contract_number` import.
- In the module docstring, replace "The invoice number/date are left blank — a person fills them at document time." with "The sale gets its invoice number and date here (services/invoice_number.py); a re-link to another contract of the same firm keeps them."
- In `link_split_to_contract`, delete the line `# invoice_number / invoice_date stay NULL — filled later by a person.` and change the tail to:

```python
    _fill_packing_from_template(sale, shipment)
    # Per-firm/year invoice number, given once — a re-link (another contract of
    # the same firm) keeps it, since the counter is the firm's, not the contract's.
    ensure_invoice_number(sale)
    return sale
```

- [ ] **Step 4: Number and mark on download**

In `contracts/views.py`, add `from apps.contracts.services.invoice_number import ensure_invoice_number, mark_invoice_printed` next to the other `apps.contracts.services` imports.

In `ContractSaleViewSet.document`, right after the `_requires_place_loading` guard and before `try: data, filename, content_type = generate(...)`:

```python
        is_invoice = doc_type.startswith('invoice')
        if is_invoice:
            # Fallback for sales created before auto-numbering or by hand.
            invoice = ensure_invoice_number(invoice)
```

After the `generate` try/except, before the `doc_key = ...` line:

```python
        if is_invoice:
            mark_invoice_printed([invoice.pk])
```

Add a module-level helper next to `_place_loading_missing`:

```python
def _number_truck_invoices(shipment) -> None:
    """CMR, TIR carnet and packet print every invoice number on the truck — give
    the truck's unnumbered live sales theirs first (mutates the prefetched rows
    the document renders)."""
    for sale in shipment.sales.all():
        if sale.status != ContractSale.STATUS_VOID:
            ensure_invoice_number(sale)
```

Call `_number_truck_invoices(shipment)` in three views, each time right after the `_place_loading_missing` guard and before the `try: … generate…` block:
- `ShipmentCmrView.get`
- `ShipmentTirView.get` (if it has no `_place_loading_missing` guard, put the call after its packing guard)
- `ShipmentPacketZipView.get`

After the `generate_packet_zip` try/except, before `_mark_downloaded(...)`:

```python
        mark_invoice_printed([sale.pk for sale in active_sales])
```

- [ ] **Step 5: Run to verify they pass, then the whole contracts suite**

```bash
cd backend && python manage.py test apps.contracts.tests.test_invoice_number apps.contracts.tests.test_shipment_firm_contracts --keepdb --noinput
python manage.py test apps.contracts --keepdb --noinput
```

Expected: the targeted tests PASS. In the full suite, any test still asserting `invoice_number is None` after a link must be updated to the new behaviour. List any you change in the report. Record failures unrelated to this change (memory `project_beta_test_suite_failures`), but don't fix them.

- [ ] **Step 6: Commit** (only after the user's "commit")

```bash
git status
git add backend/apps/contracts/services/shipment_firm_contracts.py backend/apps/contracts/views.py backend/apps/contracts/tests/test_shipment_firm_contracts.py backend/apps/contracts/tests/test_invoice_number.py
git diff --cached --stat
git commit -m "feat(p4): number invoices at contract link and on first download"
```

---

### Task 4: Manual sale — blank number allocates, taken number is a 400

**Files:**
- Modify: `backend/apps/contracts/serializers.py` (`ContractSaleCreateSerializer.validate` ~line 485-552, `create` ~line 589)
- Test: `backend/apps/contracts/tests/test_invoice_number.py`

**Interfaces:**
- Consumes: `ensure_invoice_number` (Task 2).
- Produces: `POST /api/v1/contracts/sales/` accepts a missing or null `invoice_number`. It returns 400 `{"invoice_number": [...]}` when the firm already uses that number in that year.

- [ ] **Step 1: Write the failing tests** (append to `test_invoice_number.py`)

```python
class ManualSaleNumberingApiTest(_SeededPermsMixin, TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=_make_user('inv_num_api', 'export_manager'))
        self.season = _make_season()
        imp = _make_import_firm('IMPNUMAPI')
        self.firm = _make_export_firm('NUMAPI')
        self.c1 = _make_contract('NUMAPI-1', self.firm, imp, self.season)
        self.c2 = _make_contract('NUMAPI-2', self.firm, imp, self.season)

    def _post(self, **extra):
        payload = {'contract': self.c1.pk, 'invoice_date': '2025-10-02', 'total_usd': '500.00', **extra}
        return self.client.post('/api/v1/contracts/sales/', payload, format='json')

    def test_blank_number_takes_the_firms_next(self) -> None:
        InvoiceNumberBase.objects.create(export_firm=self.firm, year=2025, last_number=9)
        resp = self._post()
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['invoice_number'], 10)

    def test_number_taken_on_another_contract_of_the_firm_is_400(self) -> None:
        _sale(self.c2, 12, '2025-03-01')
        resp = self._post(invoice_number=12)
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('invoice_number', resp.json())

    def test_same_number_in_another_year_is_fine(self) -> None:
        _sale(self.c2, 12, '2024-03-01')
        resp = self._post(invoice_number=12)
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_status_patch_does_not_clash_with_itself(self) -> None:
        sale = _sale(self.c1, 15, '2025-10-02')
        resp = self.client.patch(f'/api/v1/contracts/sales/{sale.pk}/', {'status': 'paid'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_moving_the_date_into_a_clashing_year_is_400(self) -> None:
        # Review Focus 5.
        _sale(self.c2, 15, '2026-02-01')
        sale = _sale(self.c1, 15, '2025-10-02')
        resp = self.client.patch(
            f'/api/v1/contracts/sales/{sale.pk}/', {'invoice_date': '2026-01-05'}, format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)
```

If the PATCH tests 404 because the sale list is season-scoped (`SeasonScopedMixin`), add `?season={self.season.pk}` to the URL, as the existing tests in `test_contract_sale_api.py` do.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python manage.py test apps.contracts.tests.test_invoice_number.ManualSaleNumberingApiTest --keepdb --noinput`
Expected: FAIL. The blank number stays `None` and the clash returns 201.

- [ ] **Step 3: Implement**

In `contracts/serializers.py` add the imports `from django.utils import timezone` and `from apps.contracts.services.invoice_number import ensure_invoice_number`. Place the second one inside `create` instead if the module-level import is circular. In `ContractSaleCreateSerializer.validate`, just before the final `return attrs`:

```python
        # Invoice numbers are unique per export firm per year (spec 2026-10-03) —
        # across ALL of the firm's contracts, which the DB constraint cannot see.
        number = self._merged(attrs, 'invoice_number')
        sale_contract = self._merged(attrs, 'contract')
        if number is not None and sale_contract is not None:
            invoice_date = self._merged(attrs, 'invoice_date')
            year = invoice_date.year if invoice_date else timezone.localdate().year
            clash = ContractSale.objects.filter(
                contract__export_firm_id=sale_contract.export_firm_id,
                invoice_date__year=year,
                invoice_number=number,
            )
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({
                    'invoice_number': (
                        f'Invoice № {number} is already used by '
                        f'{sale_contract.export_firm.code} in {year}.'
                    ),
                })
```

In `create`, allocate after the row exists:

```python
    @transaction.atomic
    def create(self, validated_data: dict) -> ContractSale:
        line_items = validated_data.pop('line_items', None)
        sale = super().create(validated_data)
        # A blank number takes the firm's next one for the invoice's year.
        ensure_invoice_number(sale)
        if line_items is not None:
            self._replace_line_items(sale, line_items)
        return sale
```

Update the class docstring bullet "Duplicate (contract, invoice_number) is rejected…" to: "A number already used by the contract's export firm in the invoice's year → 400; a blank number takes the firm's next one."

- [ ] **Step 4: Run to verify they pass, then the sale API suite**

```bash
cd backend && python manage.py test apps.contracts.tests.test_invoice_number apps.contracts.tests.test_contract_sale_api --keepdb --noinput
```

Expected: PASS. If an existing test creates two sales with the same number for one firm in one year through the API, it now gets a 400. Fix that test's data (different number), not the rule, and report it.

- [ ] **Step 5: Commit** (only after the user's "commit")

```bash
git status
git add backend/apps/contracts/serializers.py backend/apps/contracts/tests/test_invoice_number.py
git diff --cached --stat
git commit -m "feat(p4): manual sales auto-number and reject a firm's taken number"
```

---

### Task 5: Release orphaned sales — service, endpoint, link retry

**Files:**
- Modify: `backend/apps/contracts/services/shipment_firm_contracts.py` (new functions at the end; call at the top of `link_split_to_contract`)
- Modify: `backend/apps/contracts/views.py` (new `ShipmentReleaseSalesView`)
- Modify: `backend/apps/contracts/urls.py`
- Test: `backend/apps/contracts/tests/test_release_sales.py` (new)

**Interfaces:**
- Consumes: `ContractSale.invoice_printed_at` (Task 1).
- Produces:
  - `sales_to_release(shipment: Shipment, keep_firm_ids: set[int] | None) -> list[ContractSale]`. `None` means the truck is cancelled.
  - `release_item(sale: ContractSale) -> dict` with keys `sale_id, export_firm, export_firm_code, contract_number, contract_type, invoice_number, invoice_printed`.
  - `release_orphan_sales(shipment: Shipment) -> ReleaseResult` (a dataclass with `released: list[dict]`, `contracts_deleted: int`, `contracts_cancelled: int`).
  - `GET /api/v1/contracts/shipments/{id}/release-sales/?keep=1,2` or `?cancel=1` returns `{"items": [release_item...]}`.
  - `POST /api/v1/contracts/shipments/{id}/release-sales/` returns `{"released": [...], "contracts_deleted": n, "contracts_cancelled": n}`.
  - Both are gated by resource `shipment` (GET → view, POST → create).

- [ ] **Step 1: Write the failing tests**

`backend/apps/contracts/tests/test_release_sales.py`:

```python
"""Firm change / cancel → orphaned sales are released (spec 2026-10-03 §4-5)."""
import tempfile
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.contracts.models import Contract, ContractAttachment, ContractSale
from apps.contracts.services.shipment_firm_contracts import (
    link_split_to_contract, release_orphan_sales, sales_to_release,
)
from apps.contracts.tests.test_contract_sale_api import _SeededPermsMixin, _make_user
from apps.contracts.tests.test_shipment_firm_contracts import (
    _SHARE_A, _SHARE_B, _apply_packing, _efirm, _ifirm, _season, _shipment, _split,
)
from apps.core.models import ShipmentStatusType, User
from apps.export.models import Shipment, ShipmentFirmSplit


def _cancel(shipment) -> None:
    # Test setup only — production cancels through /cancel/ → transition_to().
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='cancelled',
        defaults={'name_tk': 'cancelled', 'name_en': 'Cancelled', 'name_ru': 'cancelled',
                  'step_order': 99, 'phase': 'PREP'},
    )
    Shipment.objects.filter(pk=shipment.pk).update(status=status)
    shipment.refresh_from_db()


class ReleaseServiceTest(TestCase):
    def setUp(self) -> None:
        self.buyer = _ifirm('RB1')
        self.dm = _efirm('RDM')
        self.ma = _efirm('RMA')
        self.shipment = _shipment(self.buyer, code='0505001/25')
        _split(self.shipment, self.dm)
        _split(self.shipment, self.ma)
        _apply_packing(self.shipment, _SHARE_A, _SHARE_B)
        self.user = User.objects.create(username='rel_user', role='export_manager')
        self.dm_sale = self._link(self.dm)
        self.ma_sale = self._link(self.ma)

    def _link(self, firm) -> ContractSale:
        return link_split_to_contract(
            shipment=self.shipment, export_firm_id=firm.id, mode='one_time',
            contract_id=None, user=self.user, price_per_kg='0.90',
        )

    def _drop_firm(self, firm) -> None:
        ShipmentFirmSplit.objects.filter(shipment=self.shipment, export_firm=firm).delete()

    def test_removed_firm_loses_its_sale_and_one_time_contract(self) -> None:
        contract_id = self.dm_sale.contract_id
        self._drop_firm(self.dm)
        result = release_orphan_sales(self.shipment)
        self.assertEqual([r['export_firm'] for r in result.released], [self.dm.id])
        self.assertFalse(ContractSale.objects.filter(pk=self.dm_sale.pk).exists())
        self.assertFalse(Contract.objects.filter(pk=contract_id).exists())
        self.assertTrue(ContractSale.objects.filter(pk=self.ma_sale.pk).exists())
        self.assertEqual(result.contracts_deleted, 1)

    def test_framework_contract_stays(self) -> None:
        fw = Contract.objects.create(
            contract_number='7/25-RDM-EXP', seq=7, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.dm, import_firm=self.buyer, season=_season(),
        )
        link_split_to_contract(shipment=self.shipment, export_firm_id=self.dm.id,
                               mode='framework', contract_id=fw.id, user=self.user)
        self._drop_firm(self.dm)
        release_orphan_sales(self.shipment)
        self.assertTrue(Contract.objects.filter(pk=fw.pk).exists())

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_one_time_contract_with_scans_is_cancelled_not_deleted(self) -> None:
        contract = self.dm_sale.contract
        ContractAttachment.objects.create(
            contract=contract, file=SimpleUploadedFile('scan.pdf', b'%PDF-1.4'),
            original_filename='scan.pdf', mime_type='application/pdf', size_bytes=8,
            uploaded_by=self.user,
        )
        self._drop_firm(self.dm)
        result = release_orphan_sales(self.shipment)
        contract.refresh_from_db()
        self.assertEqual(contract.status, Contract.STATUS_CANCELLED)
        self.assertEqual(result.contracts_cancelled, 1)

    def test_cancelled_truck_releases_every_sale(self) -> None:
        _cancel(self.shipment)
        release_orphan_sales(self.shipment)
        self.assertFalse(ContractSale.objects.filter(shipment=self.shipment).exists())

    def test_excel_sales_without_a_truck_are_never_touched(self) -> None:
        # Review Focus 2.
        excel = ContractSale.objects.create(
            contract=self.dm_sale.contract, invoice_number=500,
            invoice_date='2025-05-01', total_usd=Decimal('100.00'),
        )
        _cancel(self.shipment)
        release_orphan_sales(self.shipment)
        self.assertTrue(ContractSale.objects.filter(pk=excel.pk).exists())

    def test_second_call_is_a_no_op(self) -> None:
        self._drop_firm(self.dm)
        release_orphan_sales(self.shipment)
        again = release_orphan_sales(self.shipment)
        self.assertEqual(again.released, [])

    def test_unchanged_firm_set_releases_nothing(self) -> None:
        # Review Focus 4: a weight-only edit keeps every firm.
        self.assertEqual(sales_to_release(self.shipment, {self.dm.id, self.ma.id}), [])

    def test_freed_number_goes_to_the_next_link(self) -> None:
        freed = self.dm_sale.invoice_number
        self._drop_firm(self.dm)
        release_orphan_sales(self.shipment)
        _split(self.shipment, self.dm)
        self.assertEqual(self._link(self.dm).invoice_number, freed)

    def test_link_cleans_an_orphan_first(self) -> None:
        self._drop_firm(self.dm)  # nobody called release
        self._link(self.ma)       # any later link on the truck retries it
        self.assertFalse(ContractSale.objects.filter(pk=self.dm_sale.pk).exists())


class ReleaseEndpointTest(_SeededPermsMixin, TestCase):
    def setUp(self) -> None:
        self.buyer = _ifirm('EB1')
        self.dm = _efirm('EDM')
        self.ma = _efirm('EMA')
        self.shipment = _shipment(self.buyer, code='0606001/25')
        _split(self.shipment, self.dm)
        _split(self.shipment, self.ma)
        _apply_packing(self.shipment, _SHARE_A, _SHARE_B)
        self.manager = _make_user('rel_em', 'export_manager')
        self.sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.dm.id, mode='one_time',
            contract_id=None, user=self.manager, price_per_kg='0.90',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)
        self.url = f'/api/v1/contracts/shipments/{self.shipment.pk}/release-sales/'

    def test_preview_lists_what_a_firm_change_would_release(self) -> None:
        resp = self.client.get(self.url, {'keep': str(self.ma.id)})
        self.assertEqual(resp.status_code, 200, resp.content)
        items = resp.json()['items']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['export_firm_code'], 'EDM')
        self.assertEqual(items[0]['invoice_number'], self.sale.invoice_number)
        self.assertFalse(items[0]['invoice_printed'])
        self.assertTrue(ContractSale.objects.filter(pk=self.sale.pk).exists())  # preview only

    def test_preview_for_cancel_lists_everything(self) -> None:
        resp = self.client.get(self.url, {'cancel': '1'})
        self.assertEqual(len(resp.json()['items']), 1)

    def test_junk_keep_is_400(self) -> None:
        resp = self.client.get(self.url, {'keep': 'abc'})
        self.assertEqual(resp.status_code, 400)

    def test_post_releases_orphans(self) -> None:
        ShipmentFirmSplit.objects.filter(shipment=self.shipment, export_firm=self.dm).delete()
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.json()['released']), 1)
        self.assertFalse(ContractSale.objects.filter(pk=self.sale.pk).exists())

    def test_missing_truck_is_404(self) -> None:
        resp = self.client.get('/api/v1/contracts/shipments/999999/release-sales/')
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python manage.py test apps.contracts.tests.test_release_sales --keepdb --noinput`
Expected: `ImportError: cannot import name 'release_orphan_sales'`.

- [ ] **Step 3: Implement the service**

Append to `shipment_firm_contracts.py`. Add `from dataclasses import dataclass, field` to the imports.

```python
def _sale_firm_id(sale: ContractSale) -> int:
    """The sale's seller — the bridge column, else its contract's (never NULL)."""
    return sale.export_firm_id or sale.contract.export_firm_id


def sales_to_release(shipment: Shipment, keep_firm_ids: set[int] | None) -> list[ContractSale]:
    """This truck's sales whose firm is not in ``keep_firm_ids`` (None = all, a cancel).

    Only sales bridged to THIS truck: Excel-imported sales carry no shipment and
    are never candidates.
    """
    sales = list(
        ContractSale.objects.filter(shipment_id=shipment.pk)
        .select_related('contract', 'contract__export_firm')
        .order_by('id')
    )
    if keep_firm_ids is None:
        return sales
    return [sale for sale in sales if _sale_firm_id(sale) not in keep_firm_ids]


def release_item(sale: ContractSale) -> dict:
    """One line of the firm-change / cancel warning (and of the release result)."""
    return {
        'sale_id': sale.pk,
        'export_firm': _sale_firm_id(sale),
        'export_firm_code': sale.contract.export_firm.code,
        'contract_number': sale.contract.contract_number,
        'contract_type': sale.contract.contract_type,
        'invoice_number': sale.invoice_number,
        'invoice_printed': sale.invoice_printed_at is not None,
    }


@dataclass
class ReleaseResult:
    released: list[dict] = field(default_factory=list)
    contracts_deleted: int = 0
    contracts_cancelled: int = 0


@transaction.atomic
def release_orphan_sales(shipment: Shipment) -> ReleaseResult:
    """Delete the sales the truck's CURRENT state orphans, and their one-time contracts.

    Orphan = bridged to this truck and either the truck is cancelled or its firm is
    no longer among the truck's firm splits. Idempotent. A one-time contract left
    with no sales is deleted — unless scans were uploaded to it (attachments
    cascade), then it is marked cancelled instead. Framework contracts stay.
    """
    if shipment.status.code == 'cancelled':
        keep = None
    else:
        keep = set(shipment.firm_splits.values_list('export_firm_id', flat=True))
    orphans = sales_to_release(shipment, keep)
    result = ReleaseResult(released=[release_item(sale) for sale in orphans])
    contracts = {sale.contract_id: sale.contract for sale in orphans}
    for sale in orphans:
        sale.delete()  # line items cascade; rollup re-runs in ContractSale.delete
    for contract in contracts.values():
        if contract.contract_type != Contract.TYPE_ONE_TIME or contract.sales.exists():
            continue
        if contract.attachments.exists():
            Contract.objects.filter(pk=contract.pk).update(status=Contract.STATUS_CANCELLED)
            result.contracts_cancelled += 1
        else:
            contract.delete()
            result.contracts_deleted += 1
    return result
```

At the very top of `link_split_to_contract`'s body (before the `import_firm_id is None` check):

```python
    # A firm change / cancel whose release call never landed is retried here.
    release_orphan_sales(shipment)
```

`release_orphan_sales` is defined below `link_split_to_contract` in the module. That's fine at call time.

- [ ] **Step 4: Implement the endpoint**

In `contracts/views.py`, add `release_orphan_sales, release_item, sales_to_release` to the existing `from apps.contracts.services.shipment_firm_contracts import (...)` block, then add after `ShipmentFirmContractsView`:

```python
class ShipmentReleaseSalesView(APIView):
    """Release the sales a firm change or a cancel left behind (spec 2026-10-03 §4-5).

    ``GET ?keep=<id,id>`` | ``?cancel=1`` → preview: the sales that change WOULD
    release, for the warning the frontend shows before it saves.
    ``POST`` → release the sales the truck's CURRENT state orphans. Idempotent.

    Gated by 'shipment' (view / create) — the same right as the export
    firm-splits action, because the caller is whoever changes the firms and may
    hold no 'sale' rights.
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'shipment'

    def _shipment(self, pk):
        from apps.export.models import Shipment

        return Shipment.objects.filter(pk=pk).select_related('season', 'status').first()

    def get(self, request, pk=None):
        shipment = self._shipment(pk)
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)
        if request.query_params.get('cancel') == '1':
            keep = None
        else:
            raw = request.query_params.get('keep', '')
            try:
                keep = {int(part) for part in raw.split(',') if part.strip()}
            except ValueError:
                return Response({'error': 'keep must be comma-separated firm ids.'}, status=400)
        return Response({'items': [release_item(s) for s in sales_to_release(shipment, keep)]})

    def post(self, request, pk=None):
        shipment = self._shipment(pk)
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)
        assert_season_open(shipment.season)
        result = release_orphan_sales(shipment)
        if result.released:
            # A released sale may reopen «Kontrakt» (tasks.prepare_contract).
            sync_prepare_contract(shipment, request.user)
        return Response({
            'released': result.released,
            'contracts_deleted': result.contracts_deleted,
            'contracts_cancelled': result.contracts_cancelled,
        })
```

In `contracts/urls.py`, import `ShipmentReleaseSalesView` with the other views and add next to the `shipments/<int:pk>/packet.zip` path:

```python
    path(
        'shipments/<int:pk>/release-sales/',
        ShipmentReleaseSalesView.as_view(),
        name='shipment-release-sales',
    ),
```

- [ ] **Step 5: Run to verify they pass, then the contracts suite**

```bash
cd backend && python manage.py test apps.contracts.tests.test_release_sales --keepdb --noinput
python manage.py test apps.contracts --keepdb --noinput
```

Expected: PASS. The contracts suite has no new failures compared with Task 4.

- [ ] **Step 6: Commit** (only after the user's "commit")

```bash
git status
git add backend/apps/contracts/services/shipment_firm_contracts.py backend/apps/contracts/views.py backend/apps/contracts/urls.py backend/apps/contracts/tests/test_release_sales.py
git diff --cached --stat
git commit -m "feat(p4): release a truck's orphaned sales after a firm change or cancel"
```

---

### Task 6: Admin endpoint for the floors

**Files:**
- Modify: `backend/apps/contracts/views.py` (new `InvoiceNumberBaseView`)
- Modify: `backend/apps/contracts/urls.py`
- Test: `backend/apps/contracts/tests/test_invoice_number.py`

**Interfaces:**
- Produces:
  - `GET /api/v1/contracts/invoice-number-bases/?year=2026` returns `{"year": 2026, "rows": [{"export_firm", "export_firm_code", "export_firm_name", "last_number"}]}`. There is one row per active export firm, ordered by code, and `last_number` is 0 when the firm has no floor row.
  - `PUT` with the same URL and `{"export_firm", "year", "last_number"}` upserts and returns the row. Only role `admin` (or a superuser) may PUT; others get 403. Bad input returns 400.

- [ ] **Step 1: Write the failing tests** (append to `test_invoice_number.py`)

```python
class InvoiceNumberBaseApiTest(TestCase):
    URL = '/api/v1/contracts/invoice-number-bases/'

    def setUp(self) -> None:
        from apps.core.models import User
        self.firm = _make_export_firm('BASEAPI')
        self.admin = User.objects.create(username='base_admin', role='admin')
        self.manager = User.objects.create(username='base_em', role='export_manager')
        self.client = APIClient()

    def test_get_lists_firms_with_zero_default(self) -> None:
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get(self.URL, {'year': 2026})
        self.assertEqual(resp.status_code, 200, resp.content)
        row = next(r for r in resp.json()['rows'] if r['export_firm_code'] == 'BASEAPI')
        self.assertEqual(row['last_number'], 0)

    def test_admin_put_upserts(self) -> None:
        self.client.force_authenticate(user=self.admin)
        body = {'export_firm': self.firm.id, 'year': 2026, 'last_number': 288}
        self.assertEqual(self.client.put(self.URL, body, format='json').status_code, 200)
        body['last_number'] = 310
        self.assertEqual(self.client.put(self.URL, body, format='json').status_code, 200)
        base = InvoiceNumberBase.objects.get(export_firm=self.firm, year=2026)
        self.assertEqual((base.last_number, base.updated_by_id), (310, self.admin.id))

    def test_non_admin_put_is_403(self) -> None:
        self.client.force_authenticate(user=self.manager)
        resp = self.client.put(
            self.URL, {'export_firm': self.firm.id, 'year': 2026, 'last_number': 5}, format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_negative_number_is_400(self) -> None:
        self.client.force_authenticate(user=self.admin)
        resp = self.client.put(
            self.URL, {'export_firm': self.firm.id, 'year': 2026, 'last_number': -1}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python manage.py test apps.contracts.tests.test_invoice_number.InvoiceNumberBaseApiTest --keepdb --noinput`
Expected: 404 on the URL.

- [ ] **Step 3: Implement**

In `contracts/views.py`, add `write_permission` to the `from apps.core.permissions import (...)` block and `InvoiceNumberBase` to the `from apps.contracts.models import (...)` block, then add:

```python
class InvoiceNumberBaseView(APIView):
    """«Нумерация инвойсов» — the per-firm yearly floor for invoice numbers.

    ``GET ?year=YYYY`` (default: this year) → one row per active export firm.
    ``PUT {export_firm, year, last_number}`` → upsert the floor. Admin only: the
    floor decides which numbers new invoices get.
    """

    permission_classes = [IsAuthenticated, write_permission('admin')]

    @staticmethod
    def _row(firm, year: int, last_number: int) -> dict:
        return {
            'export_firm': firm.id,
            'export_firm_code': firm.code,
            'export_firm_name': firm.name_short or firm.name_tk,
            'year': year,
            'last_number': last_number,
        }

    def get(self, request):
        from django.utils import timezone
        from apps.core.models import ExportFirm

        try:
            year = int(request.query_params.get('year') or timezone.localdate().year)
        except ValueError:
            return Response({'error': 'year must be a number.'}, status=400)
        floors = dict(
            InvoiceNumberBase.objects.filter(year=year).values_list('export_firm_id', 'last_number')
        )
        firms = ExportFirm.objects.filter(is_active=True).order_by('code')
        return Response({
            'year': year,
            'rows': [self._row(f, year, floors.get(f.id, 0)) for f in firms],
        })

    def put(self, request):
        from apps.core.models import ExportFirm

        try:
            firm_id = int(request.data['export_firm'])
            year = int(request.data['year'])
            last_number = int(request.data['last_number'])
        except (KeyError, TypeError, ValueError):
            return Response({'error': 'export_firm, year and last_number are required numbers.'}, status=400)
        if last_number < 0 or not 2000 <= year <= 2100:
            return Response({'error': 'last_number must be ≥ 0 and year within 2000–2100.'}, status=400)
        firm = ExportFirm.objects.filter(pk=firm_id).first()
        if firm is None:
            return Response({'error': 'Export firm not found.'}, status=400)
        InvoiceNumberBase.objects.update_or_create(
            export_firm=firm, year=year,
            defaults={'last_number': last_number, 'updated_by': request.user},
        )
        return Response(self._row(firm, year, last_number))
```

In `contracts/urls.py`, import `InvoiceNumberBaseView` and add:

```python
    path(
        'invoice-number-bases/',
        InvoiceNumberBaseView.as_view(),
        name='invoice-number-bases',
    ),
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && python manage.py test apps.contracts.tests.test_invoice_number --keepdb --noinput`
Expected: PASS.

- [ ] **Step 5: Commit** (only after the user's "commit")

```bash
git status
git add backend/apps/contracts/views.py backend/apps/contracts/urls.py backend/apps/contracts/tests/test_invoice_number.py
git diff --cached --stat
git commit -m "feat(p4): admin endpoint for invoice number floors"
```

---

### Task 7: Frontend — warn before a firm change or cancel, then release

**Files:**
- Create: `frontend/src/hooks/useSaleReleaseGuard.tsx`
- Test: `frontend/src/hooks/useSaleReleaseGuard.test.tsx`
- Modify: `frontend/src/components/sheet/SheetCellEditor.tsx` (firm branch of `commitMulti` ~line 721-750)
- Modify: `frontend/src/hooks/useSheetCellWrite.ts` (`clearCell` firm branch ~line 229)
- Modify: `frontend/src/hooks/useApplyUndo.ts` (junction branch ~line 178)
- Modify: `frontend/src/components/shipment/ShipmentFirmSelector.tsx` (`commit` ~line 77)
- Modify: `frontend/src/components/shipment/ShipmentDetailHero.tsx` (`handleCancelConfirm` ~line 108)
- Modify: `frontend/src/i18n/ru.json`, `tk.json`, `en.json` (new top-level `sale_release` block)

**Interfaces:**
- Consumes: the `GET`/`POST /contracts/shipments/{id}/release-sales/` endpoints (Task 5).
- Produces: `useSaleReleaseGuard(): { confirmRelease(shipmentId: number, keepFirmIds: number[] | null): Promise<boolean>; release(shipmentId: number): Promise<void> }`. Pass `null` for a cancel. `confirmRelease` resolves `true` when nothing would be released or the user confirmed, and `false` when the user refused or the preview failed.

- [ ] **Step 1: Write the failing test**

`frontend/src/hooks/useSaleReleaseGuard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { Modal } from 'antd';
import api from '@/services/api';
import { useSaleReleaseGuard } from './useSaleReleaseGuard';

vi.mock('@/services/api');
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const ITEM = {
  sale_id: 9, export_firm: 3, export_firm_code: 'DM', contract_number: '221/26-DM-EXP',
  contract_type: 'ONE_TIME', invoice_number: 289, invoice_printed: true,
};
const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>;

describe('useSaleReleaseGuard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('goes ahead without a modal when nothing would be released', async () => {
    mockGet.mockResolvedValue({ data: { items: [] } });
    const confirmSpy = vi.spyOn(Modal, 'confirm');
    const { result } = renderHook(() => useSaleReleaseGuard(), { wrapper });
    await expect(result.current.confirmRelease(5, [3, 4])).resolves.toBe(true);
    expect(mockGet).toHaveBeenCalledWith('/contracts/shipments/5/release-sales/', { params: { keep: '3,4' } });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('asks first and resolves with the answer', async () => {
    mockGet.mockResolvedValue({ data: { items: [ITEM] } });
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation((cfg) => {
      cfg.onCancel?.();
      return { destroy: vi.fn(), update: vi.fn() } as unknown as ReturnType<typeof Modal.confirm>;
    });
    const { result } = renderHook(() => useSaleReleaseGuard(), { wrapper });
    await expect(result.current.confirmRelease(5, null)).resolves.toBe(false);
    expect(mockGet).toHaveBeenCalledWith('/contracts/shipments/5/release-sales/', { params: { cancel: 1 } });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks the change when the preview fails', async () => {
    mockGet.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useSaleReleaseGuard(), { wrapper });
    await expect(result.current.confirmRelease(5, [])).resolves.toBe(false);
  });

  it('release POSTs to the truck endpoint', async () => {
    mockPost.mockResolvedValue({ data: { released: [], contracts_deleted: 0, contracts_cancelled: 0 } });
    const { result } = renderHook(() => useSaleReleaseGuard(), { wrapper });
    await result.current.release(5);
    expect(mockPost).toHaveBeenCalledWith('/contracts/shipments/5/release-sales/');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useSaleReleaseGuard.test.tsx`
Expected: FAIL. The module `./useSaleReleaseGuard` is not found.

- [ ] **Step 3: Write the hook**

`frontend/src/hooks/useSaleReleaseGuard.tsx`:

```tsx
import { useCallback } from 'react';
import { Modal } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import api from '@/services/api';
import { CONTRACT_STATUS_KEY } from './useShipmentFirmContracts';

export interface IReleaseItem {
  sale_id: number;
  export_firm: number;
  export_firm_code: string;
  contract_number: string;
  contract_type: 'FRAMEWORK' | 'ONE_TIME';
  invoice_number: number | null;
  invoice_printed: boolean;
}

/**
 * Firm change / cancel guard (spec 2026-10-03 §5). A truck whose firm leaves (or
 * which is cancelled) loses that firm's sale, invoice number and one-time
 * contract. `confirmRelease` previews that and asks first; after the export-side
 * change succeeds the caller runs `release`, which deletes what is now orphaned.
 * `keepFirmIds` = the firms that stay; `null` = the truck is being cancelled.
 */
export function useSaleReleaseGuard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const confirmRelease = useCallback(
    async (shipmentId: number, keepFirmIds: number[] | null): Promise<boolean> => {
      let items: IReleaseItem[];
      try {
        const params = keepFirmIds === null ? { cancel: 1 } : { keep: keepFirmIds.join(',') };
        const { data } = await api.get<{ items: IReleaseItem[] }>(
          `/contracts/shipments/${shipmentId}/release-sales/`,
          { params },
        );
        items = data.items;
      } catch {
        toast.error(t('sale_release.preview_error'));
        return false;
      }
      if (items.length === 0) return true;
      return new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: t('sale_release.title'),
          width: 520,
          content: (
            <div>
              <p>{t('sale_release.intro')}</p>
              <ul style={{ paddingLeft: 18 }}>
                {items.map((item) => (
                  <li key={item.sale_id}>
                    {t('sale_release.line', {
                      firm: item.export_firm_code,
                      contract: item.contract_number,
                      invoice: item.invoice_number ?? t('sale_release.no_invoice'),
                    })}
                    {item.invoice_printed && <strong> — {t('sale_release.printed')}</strong>}
                  </li>
                ))}
              </ul>
              {items.some((item) => item.contract_type === 'ONE_TIME') && (
                <p>{t('sale_release.one_time_note')}</p>
              )}
            </div>
          ),
          okText: t('sale_release.ok'),
          okButtonProps: { danger: true },
          cancelText: t('common.cancel'),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
    },
    [t],
  );

  const release = useCallback(
    async (shipmentId: number): Promise<void> => {
      try {
        await api.post(`/contracts/shipments/${shipmentId}/release-sales/`);
      } catch {
        // Not fatal: the next «Привязать» on this truck retries the release.
        toast.error(t('sale_release.release_error'));
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['shipment-firm-contracts', shipmentId] });
      queryClient.invalidateQueries({ queryKey: CONTRACT_STATUS_KEY });
      queryClient.invalidateQueries({ queryKey: ['document-packets'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
    [queryClient, t],
  );

  return { confirmRelease, release };
}
```

- [ ] **Step 4: Add the i18n blocks**

Add a top-level `"sale_release"` block to each file.

`ru.json`:
```json
"sale_release": {
  "title": "Привязанные контракты будут удалены",
  "intro": "У этих фирм уже есть продажа по контракту. Продажа и номер фактуры будут удалены:",
  "line": "{{firm}} — контракт {{contract}}, фактура № {{invoice}}",
  "no_invoice": "без номера",
  "printed": "фактура уже напечатана",
  "one_time_note": "Разовый контракт будет удалён (если к нему загружены сканы — помечен «отменён»).",
  "ok": "Удалить и продолжить",
  "preview_error": "Не удалось проверить привязанные контракты. Изменение не сохранено.",
  "release_error": "Изменение сохранено, но продажи не удалились. Они удалятся при следующей привязке контракта к этому рейсу."
}
```

`tk.json`:
```json
"sale_release": {
  "title": "Baglanan şertnamalar pozular",
  "intro": "Bu firmalaryň şertnama boýunça satuwy bar. Satuw we faktura belgisi pozular:",
  "line": "{{firm}} — şertnama {{contract}}, faktura № {{invoice}}",
  "no_invoice": "belgisiz",
  "printed": "faktura eýýäm çap edildi",
  "one_time_note": "Bir gezeklik şertnama pozular (skanlary ýüklenen bolsa — «ýatyryldy» diýlip bellener).",
  "ok": "Poz we dowam et",
  "preview_error": "Baglanan şertnamalary barlap bolmady. Üýtgeşme ýatda saklanmady.",
  "release_error": "Üýtgeşme ýatda saklandy, ýöne satuwlar pozulmady. Bu reýse indiki şertnama baglananda pozular."
}
```

`en.json`:
```json
"sale_release": {
  "title": "Linked contracts will be removed",
  "intro": "These firms already have a sale under a contract. The sale and its invoice number will be deleted:",
  "line": "{{firm}} — contract {{contract}}, invoice # {{invoice}}",
  "no_invoice": "no number",
  "printed": "invoice already printed",
  "one_time_note": "The one-time contract will be deleted (marked cancelled if scans were uploaded to it).",
  "ok": "Delete and continue",
  "preview_error": "Could not check the linked contracts. The change was not saved.",
  "release_error": "The change was saved, but the sales were not removed. They will be removed the next time a contract is linked on this truck."
}
```

- [ ] **Step 5: Run the hook test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useSaleReleaseGuard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire the five call sites**

Each site follows the same pattern: `confirmRelease` before the write, then `release` after it succeeds.

**Use `mutateAsync(...).then(...)`, never a per-call `mutate(vars, { onSuccess })`.** TanStack Query drops per-call callbacks once the component unmounts, and `SheetCellEditor` closes itself on success (or on the outside click the modal's OK produces). `release` is a plain async function and is safe to call after unmount. The mutation-level `onError` still shows its toast, so each `.catch` only does local cleanup.

1. `SheetCellEditor.tsx`:
   - Add `const { confirmRelease, release } = useSaleReleaseGuard();` with the other hooks.
   - In the `isFirms` branch of `commitMulti`, replace the final `recordJunctionEntry` + `saveJunction(...)` pair with:

   ```tsx
            void (async () => {
              if (!(await confirmRelease(shipment.id, allowed))) {
                close();
                return;
              }
              const undoId = recordJunctionEntry(shipment.id, 'firm_splits', shipment.firm_splits);
              junctionMutation
                .mutateAsync({
                  endpoint: 'firm-splits',
                  body: { firms: allowed.map((id) => ({ export_firm_id: id })) },
                })
                .then(() => release(shipment.id))
                .catch(() => {
                  if (undoId !== -1) dropEntry(undoId);
                });
            })();
   ```

2. `useSheetCellWrite.ts`, `clearCell`, branch `fieldKey === 'firm_splits'`:
   - Add `const { confirmRelease, release } = useSaleReleaseGuard();` at the top of the hook.
   - Replace the branch body with:

   ```ts
          void (async () => {
            if (!(await confirmRelease(shipment.id, []))) return;
            const undoId = recordJunctionEntry(shipment.id, 'firm_splits', shipment.firm_splits);
            clearJunctionMutation
              .mutateAsync({ shipmentId: shipment.id, endpoint: 'firm-splits', key: 'firms', field: 'firm_splits' })
              .then(() => release(shipment.id))
              .catch(() => {
                if (undoId !== -1) dropEntry(undoId);
              });
          })();
   ```

   Add `confirmRelease` and `release` to that `useCallback`'s dependency list.

3. `useApplyUndo.ts`:
   - Add `const { confirmRelease, release } = useSaleReleaseGuard();`.
   - In the `plan.action === 'junction'` branch, guard firm undos. A sale released by the original change cannot be restored by undo; this asks before undo removes a firm linked since.

   ```ts
        } else if (plan.action === 'junction') {
          const isFirms = plan.endpoint === 'firm-splits';
          if (
            isFirms &&
            !(await confirmRelease(entry.shipmentId, plan.items.map((i) => i.export_firm_id)))
          ) {
            return;
          }
          const reverse = junctionRev.mutateAsync({
            shipmentId: entry.shipmentId, endpoint: plan.endpoint, body: { [plan.key]: plan.items },
          });
          if (isFirms) reverse.then(() => release(entry.shipmentId)).catch(() => {});
          else reverse.catch(() => {});
        }
   ```

   The `return` sits inside the `try`. The `finally` still clears `isUndoing`.

4. `ShipmentFirmSelector.tsx`:
   - Change `const { mutate, isPending } = useSetFirmSplits(shipment.id);` to `const { mutateAsync, isPending } = useSetFirmSplits(shipment.id);`.
   - Add `const { confirmRelease, release } = useSaleReleaseGuard();`.
   - Change `commit`:

   ```tsx
  async function commit() {
    const payload = firmCommitPayload(currentIds, value);
    if (!payload) return;
    if (!(await confirmRelease(shipment.id, payload))) {
      setValue(currentIds);
      return;
    }
    // The hook's own onError already toasts; nothing else to undo here.
    await mutateAsync(payload).then(() => release(shipment.id)).catch(() => {});
  }
   ```

   `payload` is the `number[]` of firm ids that `useSetFirmSplits` already takes, so it is exactly the `keep` set.

5. `ShipmentDetailHero.tsx`:
   - Add `const { confirmRelease, release } = useSaleReleaseGuard();`.
   - In `handleCancelConfirm`, after the `if (!trimmedReason) return;` line, add `if (!(await confirmRelease(shipment.id, null))) return;`.
   - Directly after the `await cancelMutation.mutateAsync(...)` line, add `await release(shipment.id);`.

- [ ] **Step 7: Type-check and run the touched suites**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
npx vitest run src/hooks src/components/sheet src/components/shipment
```

Expected: no type errors. All tests pass, and existing tests of these components still pass. If a component test now fails because `api.get` for the preview isn't mocked, mock it to `{ data: { items: [] } }` in that test's setup.

- [ ] **Step 8: Commit** (only after the user's "commit")

```bash
git status
git add frontend/src/hooks/useSaleReleaseGuard.tsx frontend/src/hooks/useSaleReleaseGuard.test.tsx frontend/src/components/sheet/SheetCellEditor.tsx frontend/src/hooks/useSheetCellWrite.ts frontend/src/hooks/useApplyUndo.ts frontend/src/components/shipment/ShipmentFirmSelector.tsx frontend/src/components/shipment/ShipmentDetailHero.tsx frontend/src/i18n/ru.json frontend/src/i18n/tk.json frontend/src/i18n/en.json
git diff --cached --stat
git commit -m "feat(frontend): warn before a firm change or cancel drops linked sales"
```

Plus any component test files changed in Step 7.

---

### Task 8: Frontend — «Нумерация инвойсов» admin page

**Files:**
- Create: `frontend/src/hooks/useInvoiceNumberBases.ts`
- Create: `frontend/src/pages/admin/InvoiceNumberingPage.tsx`
- Test: `frontend/src/pages/admin/InvoiceNumberingPage.test.tsx`
- Modify: `frontend/src/App.tsx` (route next to `admin/legal-forms` ~line 230)
- Modify: `frontend/src/components/AppLayout.tsx` (title map ~line 189)
- Modify: `frontend/src/pages/admin/ExportFirmsPage.tsx` (toolbar ~line 125)
- Modify: `frontend/src/i18n/ru.json`, `tk.json`, `en.json` (new top-level `invoice_numbering` block)

**Interfaces:**
- Consumes: `GET`/`PUT /contracts/invoice-number-bases/` (Task 6).
- Produces: the route `/admin/invoice-numbering`, gated by page `admin.firms`.

- [ ] **Step 1: Write the hook**

`frontend/src/hooks/useInvoiceNumberBases.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export interface IInvoiceNumberBaseRow {
  export_firm: number;
  export_firm_code: string;
  export_firm_name: string;
  year: number;
  last_number: number;
}

const KEY = 'invoice-number-bases';

/** Per-firm yearly invoice-number floors for one year (spec 2026-10-03 §6). */
export function useInvoiceNumberBases(year: number) {
  return useQuery({
    queryKey: [KEY, year] as const,
    queryFn: async () => {
      const { data } = await api.get<{ year: number; rows: IInvoiceNumberBaseRow[] }>(
        '/contracts/invoice-number-bases/',
        { params: { year } },
      );
      return data.rows;
    },
  });
}

export function useSaveInvoiceNumberBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { export_firm: number; year: number; last_number: number }) => {
      const { data } = await api.put<IInvoiceNumberBaseRow>('/contracts/invoice-number-bases/', body);
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: [KEY, row.year] });
    },
  });
}
```

- [ ] **Step 2: Write the failing page test**

`frontend/src/pages/admin/InvoiceNumberingPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import api from '@/services/api';
import InvoiceNumberingPage from './InvoiceNumberingPage';

vi.mock('@/services/api');
const authUser = { current: { role: 'admin', is_superuser: false } };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authUser.current }) }));

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><InvoiceNumberingPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InvoiceNumberingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      data: { year: 2026, rows: [{ export_firm: 3, export_firm_code: 'DM', export_firm_name: 'DM', year: 2026, last_number: 288 }] },
    });
  });

  it('admin edits a floor and it is saved', async () => {
    authUser.current = { role: 'admin', is_superuser: false };
    mockPut.mockResolvedValue({ data: { export_firm: 3, year: 2026, last_number: 310 } });
    renderPage();
    const input = await screen.findByDisplayValue('288');
    fireEvent.change(input, { target: { value: '310' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/contracts/invoice-number-bases/', {
        export_firm: 3, year: expect.any(Number), last_number: 310,
      }),
    );
  });

  it('a non-admin sees the number read-only', async () => {
    authUser.current = { role: 'export_manager', is_superuser: false };
    renderPage();
    expect(await screen.findByText('288')).toBeTruthy();
    expect(screen.queryByDisplayValue('288')).toBeNull();
  });
});
```

`year: expect.any(Number)` is there because the page defaults to the current year.

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/InvoiceNumberingPage.test.tsx`
Expected: FAIL. The page module is not found.

- [ ] **Step 4: Write the page**

`frontend/src/pages/admin/InvoiceNumberingPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, InputNumber, Space, Table, Typography } from 'antd';
import { ArrowLeftOutlined, NumberOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  useInvoiceNumberBases, useSaveInvoiceNumberBase, type IInvoiceNumberBaseRow,
} from '@/hooks/useInvoiceNumberBases';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

/**
 * «Нумерация инвойсов» (`/admin/invoice-numbering`) — the last invoice number
 * each export firm issued outside the platform this year. New invoices continue
 * above it. Reached from the export-firm list, like legal forms; editing is
 * admin-only because the floor decides which numbers new invoices get.
 */
export default function InvoiceNumberingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.is_superuser === true;
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const { data: rows, isLoading } = useInvoiceNumberBases(year);
  const save = useSaveInvoiceNumberBase();

  const commit = (row: IInvoiceNumberBaseRow, value: number | null) => {
    if (value == null || value === row.last_number) return;
    save.mutate(
      { export_firm: row.export_firm, year, last_number: value },
      {
        onSuccess: () => toast.success(t('invoice_numbering.saved')),
        onError: () => toast.error(t('invoice_numbering.save_error')),
      },
    );
  };

  return (
    <div>
      <Space align="center" size={8} style={{ marginBottom: 4 }}>
        <Button icon={<ArrowLeftOutlined />} size="small" onClick={() => navigate(-1)} aria-label={t('common.back')} />
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <NumberOutlined style={{ color: COLORS.primary }} />
          {t('invoice_numbering.title')}
        </Title>
      </Space>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
        {t('invoice_numbering.subtitle')}
      </Text>
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('invoice_numbering.floor_warning')} />
      <Space style={{ marginBottom: 12 }}>
        <Text>{t('invoice_numbering.year')}</Text>
        <InputNumber min={2000} max={2100} value={year} onChange={(v) => v && setYear(v)} />
      </Space>
      <Table<IInvoiceNumberBaseRow>
        rowKey="export_firm"
        size="small"
        loading={isLoading}
        dataSource={rows ?? []}
        pagination={false}
        columns={[
          { title: t('invoice_numbering.col_firm'), dataIndex: 'export_firm_code' },
          { title: t('invoice_numbering.col_name'), dataIndex: 'export_firm_name' },
          {
            title: t('invoice_numbering.col_last_number'),
            dataIndex: 'last_number',
            render: (value: number, row) =>
              canWrite ? (
                <InputNumber
                  key={`${row.export_firm}-${year}-${value}`}
                  min={0}
                  precision={0}
                  defaultValue={value}
                  onBlur={(e) => commit(row, e.target.value === '' ? null : Number(e.target.value))}
                  onPressEnter={(e) => commit(row, Number((e.target as HTMLInputElement).value))}
                />
              ) : (
                value
              ),
          },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 5: Route, title, entry button, i18n**

- In `App.tsx`, import the page as the neighbouring admin pages are imported (lazy or direct, following the file's existing pattern). Add after the `admin/legal-forms` route:

  ```tsx
                  <Route path="admin/invoice-numbering" element={
                    <ProtectedRoute pageCode="admin.firms"><InvoiceNumberingPage /></ProtectedRoute>
                  } />
  ```

- In `AppLayout.tsx`, add `'/admin/invoice-numbering': t('invoice_numbering.title'),` to the title map under `'/admin/legal-forms'`.
- In `ExportFirmsPage.tsx`, import `NumberOutlined` and add to `toolBarRender` before the legal-forms tooltip:

  ```tsx
          <Tooltip key="invoice-numbering" title={t('invoice_numbering.open')}>
            <Button
              icon={<NumberOutlined />}
              onClick={() => navigate('/admin/invoice-numbering')}
              aria-label={t('invoice_numbering.open')}
            />
          </Tooltip>,
  ```

- i18n. Add a top-level `invoice_numbering` block.

  `ru`:
  ```json
  "invoice_numbering": {
    "title": "Нумерация фактур",
    "open": "Нумерация фактур",
    "subtitle": "Последний номер фактуры, выданный каждой фирмой вне платформы в этом году. Новые фактуры продолжают с номера + 1. С 1 января нумерация начинается с 1.",
    "floor_warning": "Числа предзаполнены из базы и могут быть меньше реальных. Впишите последний номер из Excel для каждой фирмы до первой привязки контракта.",
    "year": "Год",
    "col_firm": "Фирма",
    "col_name": "Название",
    "col_last_number": "Последний номер",
    "saved": "Сохранено",
    "save_error": "Не удалось сохранить"
  }
  ```

  `tk`:
  ```json
  "invoice_numbering": {
    "title": "Fakturalaryň belgilenişi",
    "open": "Fakturalaryň belgilenişi",
    "subtitle": "Her firmanyň şu ýyl platformadan daşarda beren iň soňky faktura belgisi. Täze fakturalar belgi + 1-den dowam edýär. 1-nji ýanwardan belgilenme 1-den başlaýar.",
    "floor_warning": "Sanlar bazadan doldurylan we hakykydan az bolup biler. Ilkinji şertnama baglanmazdan öň her firma üçin Excel-däki iň soňky belgini giriziň.",
    "year": "Ýyl",
    "col_firm": "Firma",
    "col_name": "Ady",
    "col_last_number": "Iň soňky belgi",
    "saved": "Ýatda saklandy",
    "save_error": "Ýatda saklap bolmady"
  }
  ```

  `en`:
  ```json
  "invoice_numbering": {
    "title": "Invoice numbering",
    "open": "Invoice numbering",
    "subtitle": "The last invoice number each firm issued outside the platform this year. New invoices continue from that number + 1. Numbering restarts at 1 on 1 January.",
    "floor_warning": "The numbers were pre-filled from the database and may be lower than the real ones. Enter each firm's last number from Excel before the first contract is linked.",
    "year": "Year",
    "col_firm": "Firm",
    "col_name": "Name",
    "col_last_number": "Last number",
    "saved": "Saved",
    "save_error": "Could not save"
  }
  ```

- [ ] **Step 6: Run the test and type-check**

```bash
cd frontend && npx vitest run src/pages/admin/InvoiceNumberingPage.test.tsx src/components/AppLayout.menuGroups.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: PASS, with no type errors.

- [ ] **Step 7: Commit** (only after the user's "commit")

```bash
git status
git add frontend/src/hooks/useInvoiceNumberBases.ts frontend/src/pages/admin/InvoiceNumberingPage.tsx frontend/src/pages/admin/InvoiceNumberingPage.test.tsx frontend/src/App.tsx frontend/src/components/AppLayout.tsx frontend/src/pages/admin/ExportFirmsPage.tsx frontend/src/i18n/ru.json frontend/src/i18n/tk.json frontend/src/i18n/en.json
git diff --cached --stat
git commit -m "feat(frontend): invoice numbering admin page"
```

---

### Task 9: Frontend — manual sale form leaves the number to the system

**Files:**
- Modify: `frontend/src/types/contractSale.ts` (lines 21 and 80)
- Modify: `frontend/src/pages/contracts/ContractSaleCreate.tsx`
- Modify: `frontend/src/pages/contracts/ContractSalesTab.tsx` (lines 68-74, 277, 287)
- Test: `frontend/src/pages/contracts/ContractSaleCreate.test.tsx` (new)
- Modify: `frontend/src/i18n/ru.json`, `tk.json`, `en.json` (one key `sales.create.field.invoice_number_auto`)

**Interfaces:**
- Consumes: `POST /contracts/sales/` accepting a missing `invoice_number` (Task 4).

- [ ] **Step 1: Write the failing test**

`frontend/src/pages/contracts/ContractSaleCreate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContractSaleCreate } from './ContractSaleCreate';

const createMutateAsync = vi.fn().mockResolvedValue({ id: 1 });
vi.mock('@/hooks/useContractSales', () => ({
  useCreateContractSale: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateContractSale: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useContractSale: () => ({ data: undefined }),
}));
vi.mock('@/hooks/useContracts', () => ({ useContract: () => ({ data: undefined }) }));

describe('ContractSaleCreate', () => {
  beforeEach(() => createMutateAsync.mockClear());

  it('creates a sale without an invoice number so the system assigns it', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <ContractSaleCreate open onClose={() => {}} contractId={7} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getAllByRole('spinbutton').find(
      (el) => el.closest('.ant-form-item')?.textContent?.includes('USD'),
    )!, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /sales\.create\.submit|Create|Создать/ }));
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
    expect(createMutateAsync.mock.calls[0][0]).not.toHaveProperty('invoice_number');
  });
});
```

The selector for the total-USD field depends on the field label. Adjust it to match the label `sales.create.field.total_usd` renders in the test i18n setup. Keep the assertion: the payload must have no `invoice_number`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/contracts/ContractSaleCreate.test.tsx`
Expected: FAIL. The payload has `invoice_number: 1`, or the required rule blocks submit.

- [ ] **Step 3: Implement**

- `types/contractSale.ts`: `IContractSale.invoice_number: number | null;`. In `IContractSaleCreatePayload`, use `invoice_number?: number | null;`.
- `ContractSaleCreate.tsx`:
  - In `IFormValues`, change to `invoice_number?: number | null;`.
  - Delete the `nextInvoiceNumber` prop, its doc comment and the destructured parameter.
  - Delete `handleContractChange`'s number comment lines and the whole `prevContractIdRef` effect that auto-fills from `contractDetail.last_invoice_number`. Keep `form.setFieldValue('contract_id', …)`.
  - Delete `prevContractIdRef.current = null;` in the submit tail.
  - In the payload, drop `invoice_number: values.invoice_number,` and add after the object:

    ```tsx
    // Blank → the backend gives the export firm's next number for the invoice's year.
    if (values.invoice_number != null) {
      payload.invoice_number = values.invoice_number;
    }
    ```

  - In the create-mode `initialValues`, delete `invoice_number: nextInvoiceNumber ?? 1,`.
  - On the `invoice_number` `Form.Item`, remove the `required` rule and add `extra={isEditing ? undefined : t('sales.create.field.invoice_number_auto')}`.
  - If `useContract`/`contractDetail` is now unused, remove it and its import. Check that nothing else reads it first.
- `ContractSalesTab.tsx`: delete the `nextInvoiceNumber` computation (lines 68-74) and both `nextInvoiceNumber={nextInvoiceNumber}` props.
- i18n `sales.create.field.invoice_number_auto`:
  - ru: «Оставьте пустым — номер выдаст система (по фирме и году).»
  - tk: «Boş goýuň — belgini ulgam berer (firma we ýyl boýunça).»
  - en: "Leave blank — the system assigns the number (per firm and year)."

- [ ] **Step 4: Run tests and type-check**

```bash
cd frontend && npx vitest run src/pages/contracts src/pages/sales src/components/shipment
npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: PASS, with no type errors. Fix every place the `number | null` change flags (e.g. sorting or `Math.max` on `invoice_number`) by handling `null`, not by casting.

- [ ] **Step 5: Commit** (only after the user's "commit")

```bash
git status
git add frontend/src/types/contractSale.ts frontend/src/pages/contracts/ContractSaleCreate.tsx frontend/src/pages/contracts/ContractSaleCreate.test.tsx frontend/src/pages/contracts/ContractSalesTab.tsx frontend/src/i18n/ru.json frontend/src/i18n/tk.json frontend/src/i18n/en.json
git diff --cached --stat
git commit -m "feat(frontend): manual sale leaves the invoice number to the system"
```

Plus any file the type-check made you touch.

---

### Task 10: Docs, decision log, test log (main session)

**Files:**
- Modify: `DECISIONS.md` (new entry, newest on top, following the file's format)
- Modify: the contracts/sales note under `docs/obsidian/` (find it via `docs/obsidian/00-index.md`) and the admin-pages note
- Modify: `.claude/skills/api-contract/SKILL.md` (two new endpoints: `release-sales`, `invoice-number-bases`; `invoice_printed_at` on the sale)
- Modify: `BUILD_TEST_LOG.md`, `CHANGELOG.md`

- [ ] **Step 1: DECISIONS.md.** Record the following:
  - Invoice numbering is per export firm per calendar year, above an admin floor.
  - The number is given at «Привязать», and the invoice date is the truck's date.
  - Freed numbers are reused (**provisional**; open question: date order vs no gaps).
  - A firm change or cancel warns, then deletes orphaned sales. A one-time contract is deleted, or marked cancelled if it has scans.
  - The per-contract unique constraint is kept, because framework contracts never cross a year.

- [ ] **Step 2: Obsidian.**
  - Describe `InvoiceNumberBase`, the allocation rule, the three allocation points, the release rule and the warning.
  - Add the new admin page and how to reach it (gear row on Export Firms).

- [ ] **Step 3: api-contract skill.**
  - Add the request and response shapes from Tasks 5 and 6.
  - Record that `invoice_number` is optional on `POST /contracts/sales/`.

- [ ] **Step 4: BUILD_TEST_LOG.md** (newest on top):

  ```
  - [ ] 2026-10-03 — Invoice auto-numbering per firm/year + «Нумерация фактур» admin page + firm-change/cancel warning that releases linked sales — NEEDS TEST (before testing: fill real last numbers per firm on /admin/invoice-numbering)
  ```

- [ ] **Step 5: CHANGELOG.md.** Under `[Unreleased]` (written last, after code commits):
  - Added: invoice auto-numbering, the admin page, and the release-sales endpoint with its warning.
  - Changed: the manual sale form no longer prefills the number.

- [ ] **Step 6: Commit** (only after the user's "commit")

```bash
git status
git add DECISIONS.md docs/obsidian .claude/skills/api-contract/SKILL.md BUILD_TEST_LOG.md CHANGELOG.md docs/superpowers/specs/2026-10-03-invoice-auto-numbering-design.md docs/superpowers/plans/2026-10-03-invoice-auto-numbering.md
git diff --cached --stat
git commit -m "docs: invoice auto-numbering decision, vault, contract and test log"
```

## Deploy (after all tasks, on the user's instruction)

1. Push and redeploy beta as usual. Then on beta run `migrate contracts`. It applies `0015` (new table plus a nullable column) and `0016` (the seed).
2. The real 2026 floors were already entered at the Execution Order gate. The DB is shared, so beta sees them too. Before beta's first «Привязать» on the new code, re-check the table: firms may have issued more Excel invoices since the gate.
3. Tell the user: «Built — NOT tested yet. Did you test it?»
