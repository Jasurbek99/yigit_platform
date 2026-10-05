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
