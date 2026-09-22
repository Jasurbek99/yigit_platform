"""Tests for the Tır Takip Hasabat report endpoint and service.

Coverage:
  1. Access — anonymous 401; a role holding only `tir_takip.hasabat` 403;
     a role holding it plus `analytics.clients` 200; superuser 200.
  2. Which trucks count — drafts, cancelled, soft-deleted, archived and
     other-season shipments are all excluded.
  3. Numbers — KPIs, open/arrived split, and every grouping (month, country,
     customer, variety, export firm, block), each with its own subtotal.
  4. Unknown groups — a shipment with no country/customer/variety lands in a
     `name: None` row rather than being dropped.
  5. No season — empty payload, shape intact.
"""
from datetime import date
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    ExportFirm,
    GreenhouseBlock,
    RolePagePermission,
    Season,
    ShipmentStatusType,
    TomatoVariety,
    User,
)
from apps.export.models import Shipment, ShipmentBlockSource, ShipmentFirmSplit
from apps.export.services.tir_hasabat import build_tir_hasabat

URL = '/api/v1/export/tir-hasabat/'


def _status(code: str, step_order: int, phase: str) -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={'name_tk': code, 'name_en': code, 'step_order': step_order, 'phase': phase},
    )
    return st


def _user(username: str, role: str, *, superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=superuser)
    user.set_password('pass')
    user.save()
    return user


def _grant(role: str, *codes: str) -> None:
    for code in codes:
        RolePagePermission.objects.update_or_create(
            role=role, page_code=code, defaults={'is_visible': True},
        )


class _Fixture(TestCase):
    """Two real trucks, one bare truck, and one of every excluded kind."""

    def setUp(self):
        cache.clear()
        Season.objects.filter(is_active=True).update(is_active=False)
        self.season = Season.objects.create(
            name='hs25', start_date=date(2025, 9, 1), end_date=date(2026, 6, 30), is_active=True,
        )
        self.other_season = Season.objects.create(
            name='hs24', start_date=date(2024, 9, 1), end_date=date(2025, 6, 30), is_active=False,
        )

        self.st_loading = _status('yuklenme', 3, 'LOADING')
        self.st_arrived = _status('bardy', 9, 'SALES')
        self.st_draft = _status('draft', 0, 'DRAFT')
        self.st_cancelled = _status('cancelled', 99, 'CANCELLED')

        self.kz = Country.objects.create(name_tk='Gazagystan', name_en='Kazakhstan', code='HKZ')
        self.ru = Country.objects.create(name_tk='Russiýa', name_en='Russia', code='HRU')
        self.begjan = Customer.objects.create(name='HS Begjan')
        self.merdan = Customer.objects.create(name='HS Merdan')
        self.var_a = TomatoVariety.objects.create(name='HS Variety A')
        self.firm_x = ExportFirm.objects.create(code='HSX', name_tk='X firma', name_short='X')
        self.firm_y = ExportFirm.objects.create(code='HSY', name_tk='Y firma')  # no name_short
        self.block_a = GreenhouseBlock.objects.create(code='HSA')
        self.block_b = GreenhouseBlock.objects.create(code='HSB')

        def ship(code, **kw):
            kw.setdefault('season', self.season)
            kw.setdefault('status', self.st_loading)
            kw.setdefault('date', date(2026, 1, 10))
            return Shipment.objects.create(shipment_code=code, **kw)

        # Counted.
        self.t1 = ship(
            'HS1', status=self.st_loading, date=date(2026, 1, 10), weight_net=Decimal('18000'),
            country=self.kz, customer=self.begjan, variety=self.var_a,
        )
        self.t2 = ship(
            'HS2', status=self.st_arrived, date=date(2026, 2, 5), weight_net=Decimal('20000'),
            country=self.ru, customer=self.begjan, variety=self.var_a,
        )
        self.t3 = ship('HS3', status=self.st_loading, date=date(2026, 2, 20))  # bare, no weight

        ShipmentFirmSplit.objects.create(shipment=self.t1, export_firm=self.firm_x, weight_kg=Decimal('10000'))
        ShipmentFirmSplit.objects.create(
            shipment=self.t1, export_firm=self.firm_y, weight_kg=Decimal('8000'), split_order=2,
        )
        ShipmentFirmSplit.objects.create(shipment=self.t2, export_firm=self.firm_x, weight_kg=Decimal('20000'))
        ShipmentBlockSource.objects.create(shipment=self.t1, block=self.block_a, weight_kg=Decimal('12000'))
        ShipmentBlockSource.objects.create(shipment=self.t1, block=self.block_b, weight_kg=Decimal('6000'))
        ShipmentBlockSource.objects.create(shipment=self.t2, block=self.block_a, weight_kg=None)

        # Excluded — each would change a number if it leaked in.
        heavy = {'weight_net': Decimal('99999'), 'country': self.kz, 'customer': self.merdan}
        ship('HSDRAFT', status=self.st_draft, **heavy)
        ship('HSCANC', status=self.st_cancelled, **heavy)
        ship('HSDEL', deleted_at=timezone.now(), **heavy)
        ship('HSARCH', is_archived=True, **heavy)
        ship('HSOLD', season=self.other_season, date=date(2025, 1, 10), **heavy)


class TirHasabatAccessTests(_Fixture):

    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def test_anonymous_gets_401(self):
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_tab_code_alone_is_not_enough(self):
        _grant('seller', 'tir_takip.hasabat')
        self.client.force_authenticate(_user('hs_seller', 'seller'))
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_analytics_code_alone_is_not_enough(self):
        _grant('seller', 'analytics.clients')
        self.client.force_authenticate(_user('hs_seller', 'seller'))
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_both_codes_grant_access(self):
        _grant('seller', 'tir_takip.hasabat', 'analytics.clients')
        self.client.force_authenticate(_user('hs_seller', 'seller'))
        self.assertEqual(self.client.get(URL).status_code, 200)

    def test_superuser_bypasses_matrix(self):
        self.client.force_authenticate(_user('hs_root', 'seller', superuser=True))
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['kpis']['total_trucks'], 3)

    def test_season_param_selects_other_season(self):
        self.client.force_authenticate(_user('hs_root', 'admin', superuser=True))
        data = self.client.get(URL, {'season': self.other_season.id}).json()
        self.assertEqual(data['season']['id'], self.other_season.id)
        self.assertEqual(data['kpis']['total_trucks'], 1)


class TirHasabatNumbersTests(_Fixture):

    def setUp(self):
        super().setUp()
        self.data = build_tir_hasabat(self.season)

    def test_kpis_count_only_real_trucks(self):
        self.assertEqual(self.data['kpis'], {
            'total_trucks': 3,
            'total_kg': 38000.0,
            'avg_kg': 12667.0,
            'open_trucks': 2,
            'arrived_trucks': 1,
        })

    def test_by_month_uses_shipment_date(self):
        self.assertEqual(self.data['by_month'], [
            {'month': '2026-01', 'trucks': 1, 'kg': 18000.0},
            {'month': '2026-02', 'trucks': 2, 'kg': 20000.0},
        ])

    def test_by_country_sorted_by_kg_with_unknown_row(self):
        g = self.data['by_country']
        self.assertEqual(g['rows'], [
            {'name': 'Russia', 'trucks': 1, 'kg': 20000.0},
            {'name': 'Kazakhstan', 'trucks': 1, 'kg': 18000.0},
            {'name': None, 'trucks': 1, 'kg': 0.0},
        ])
        self.assertEqual(g['total_kg'], 38000.0)

    def test_by_customer_merges_countries(self):
        rows = self.data['by_customer']['rows']
        self.assertEqual(rows[0], {'name': 'HS Begjan', 'trucks': 2, 'kg': 38000.0})
        self.assertEqual(rows[1], {'name': None, 'trucks': 1, 'kg': 0.0})

    def test_by_variety(self):
        self.assertEqual(self.data['by_variety']['rows'][0], {'name': 'HS Variety A', 'trucks': 2, 'kg': 38000.0})

    def test_by_firm_uses_split_kg_and_short_name_fallback(self):
        g = self.data['by_firm']
        self.assertEqual(g['rows'], [
            {'name': 'X', 'trucks': 2, 'kg': 30000.0},
            {'name': 'HSY', 'trucks': 1, 'kg': 8000.0},
        ])
        self.assertEqual(g['total_kg'], 38000.0)

    def test_by_block_uses_block_kg_and_counts_null_weight_trucks(self):
        g = self.data['by_block']
        self.assertEqual(g['rows'], [
            {'name': 'HSA', 'trucks': 2, 'kg': 12000.0},
            {'name': 'HSB', 'trucks': 1, 'kg': 6000.0},
        ])
        self.assertEqual(g['total_kg'], 18000.0)

    def test_no_season_returns_empty_shape(self):
        data = build_tir_hasabat(None)
        self.assertIsNone(data['season'])
        self.assertEqual(data['kpis']['total_trucks'], 0)
        self.assertEqual(data['by_month'], [])
        self.assertEqual(data['by_firm'], {'rows': [], 'total_kg': 0.0})
