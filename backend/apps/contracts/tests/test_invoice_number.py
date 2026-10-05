"""Invoice auto-numbering per export firm per year (spec 2026-10-03)."""
import datetime
import importlib
from decimal import Decimal
from unittest import mock

from django.apps import apps as django_apps
from django.test import TestCase
from django.utils import timezone

from apps.contracts.models import ContractSale, InvoiceNumberBase
from apps.contracts.services.invoice_number import (
    allocate_invoice_number, ensure_invoice_number, mark_invoice_printed,
)
from apps.contracts.tests.test_contract_sale_api import (
    _make_contract, _make_export_firm, _make_import_firm, _make_season,
)
from apps.contracts.tests.test_document_generation import _make_packed_shipment
from apps.core.models import Season

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

    def test_shipment_closed_season_blocks_even_when_contract_season_is_open(self) -> None:
        # Review Focus: ContractSale.freeze_season checks the shipment's season
        # first, then the contract's — mark_invoice_printed must agree, not just
        # look at contract__season.
        open_season = _make_season()
        closed_season = Season.objects.create(
            name='INVCLSD', start_date='2025-09-01', end_date='2026-06-30', is_active=False,
        )
        Season.objects.filter(pk=closed_season.pk).update(closed_at=timezone.now())
        imp = _make_import_firm('IMPPRN2')
        contract = _make_contract(
            'PRN-2', _make_export_firm('PRNFIRM2'), imp, open_season,
        )
        shipment = _make_packed_shipment(closed_season, imp, code='0101003/25')
        shipment.refresh_from_db()
        sale = _sale(contract, 6, '2025-10-01', shipment=shipment)
        mark_invoice_printed([sale.pk])
        sale.refresh_from_db()
        self.assertIsNone(sale.invoice_printed_at)
