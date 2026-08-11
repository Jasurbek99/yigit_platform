"""`GET /quota-usage/?shipment=<id>` — the quota card on ShipmentDetail.

Quota is spent by trucks, so the shipment is where operators ask "did this cost
quota, whose, and is it approved?". The filter relaxes the D11 season scope for
the same reason `/customs-expenses/?shipment=` does, and under the same guard:
Rule A (§4.5) says a detail page resolves for any season, so a prior-season
shipment opened by direct link must show its own quota — but the relaxation is
gated on `can_view_closed()`, or the param would be a way around the 403 that
`/quota-usage/?season=<closed>` returns. That is the exact shape of the
2026-08-07 quota-dashboard date-window bypass, so it is pinned by tests here
rather than left to the reasoning in the code comment.

Run with:
    python manage.py test apps.export.tests_quota_usage_by_shipment --verbosity=2
"""
from datetime import date
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Country, ExportFirm, Season, ShipmentStatusType, User
from apps.export.models import QuotaUsageRecord, Shipment

URL = '/api/v1/export/quota-usage/'


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_status() -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'Garalama', 'name_en': 'Draft', 'name_ru': 'Черновик',
            'phase': 'DRAFT', 'step_order': 0, 'required_role': 'warehouse_chief',
        },
    )
    return status


class QuotaUsageByShipmentTests(TestCase):
    """An ACTIVE season and a genuinely CLOSED one, each with a truck carrying quota.

    Roles are the pair `tests_quota_dashboard_perms` uses for the same
    distinction: `export_manager` holds `closed_season.can_view` under the AD-16
    seed, `document_team` does not, and both hold `quota_usage.can_view` — so the
    pair isolates the closed-season permission from plain page access.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='qbs26', start_date=date(2026, 8, 1), end_date=date(2027, 6, 30),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='qbs25', start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
            closed_at=timezone.now(),
        )
        country = Country.objects.create(code='KZ', name_tk='Gazagystan')
        cls.firm = ExportFirm.objects.create(code='QBS1', name_tk='Firma QBS1')
        cls.other_firm = ExportFirm.objects.create(code='QBS2', name_tk='Firma QBS2')

        cls.closed_shipment = Shipment.objects.create(
            shipment_code='QBS-CLOSED', date=cls.closed.start_date, season=cls.closed,
            status=_make_status(), country=country,
        )
        cls.active_shipment = Shipment.objects.create(
            shipment_code='QBS-ACTIVE', date=cls.active.start_date, season=cls.active,
            status=_make_status(), country=country,
        )

        # Two firms rode the closed-season truck — the multi-firm shape the card
        # exists to show, and the shape that broke the usage grid.
        cls.closed_rows = [
            QuotaUsageRecord.objects.create(
                usage_date=cls.closed.start_date, export_firm=firm,
                shipment=cls.closed_shipment, kg_used=Decimal('9000'),
                product_type='tomato', status='approved',
            )
            for firm in (cls.firm, cls.other_firm)
        ]
        cls.active_row = QuotaUsageRecord.objects.create(
            usage_date=cls.active.start_date, export_firm=cls.firm,
            shipment=cls.active_shipment, kg_used=Decimal('18100'),
            product_type='tomato', status='approved',
        )

        cls.permitted = _make_user('qbs-gadam', 'export_manager')
        cls.unpermitted = _make_user('qbs-sulgun', 'document_team')

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _ids(self, response) -> set:
        payload = response.json()
        rows = payload if isinstance(payload, list) else payload.get('results', [])
        return {row['id'] for row in rows}

    # --- the filter itself -------------------------------------------------

    def test_filter_returns_only_that_shipments_rows(self):
        self.client.force_authenticate(self.unpermitted)
        response = self.client.get(URL, {'shipment': self.active_shipment.pk})
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(self._ids(response), {self.active_row.pk})

    def test_shipment_with_no_usage_returns_empty(self):
        empty = Shipment.objects.create(
            shipment_code='QBS-EMPTY', date=self.active.start_date, season=self.active,
            status=_make_status(), country=Country.objects.first(),
        )
        self.client.force_authenticate(self.unpermitted)
        response = self.client.get(URL, {'shipment': empty.pk})
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(self._ids(response), set())

    # --- the closed-season relaxation, and its gate ------------------------

    def test_permitted_role_sees_a_closed_seasons_shipment(self):
        """Rule A: a direct link resolves, so the card must not come back empty."""
        self.client.force_authenticate(self.permitted)
        response = self.client.get(URL, {'shipment': self.closed_shipment.pk})
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(self._ids(response), {row.pk for row in self.closed_rows})

    def test_permitted_role_sees_every_firm_on_the_truck(self):
        self.client.force_authenticate(self.permitted)
        response = self.client.get(URL, {'shipment': self.closed_shipment.pk})
        self.assertEqual(len(self._ids(response)), 2)

    def test_unpermitted_role_cannot_reach_a_closed_season_through_the_filter(self):
        """The gate. Without it, `?shipment=` routes around the 403 on `?season=`."""
        self.client.force_authenticate(self.unpermitted)
        response = self.client.get(URL, {'shipment': self.closed_shipment.pk})
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(self._ids(response), set())

    def test_the_403_this_filter_must_not_route_around(self):
        """Control: the same role, the same season, named the documented way."""
        self.client.force_authenticate(self.unpermitted)
        response = self.client.get(URL, {'season': self.closed.pk})
        self.assertEqual(response.status_code, 403, response.content[:400])

    # --- the relaxation must not leak ---------------------------------------

    def test_unfiltered_list_still_scopes_by_season(self):
        self.client.force_authenticate(self.permitted)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.content[:400])
        ids = self._ids(response)
        self.assertIn(self.active_row.pk, ids)
        for row in self.closed_rows:
            self.assertNotIn(row.pk, ids)

    def test_a_bad_season_id_still_404s_with_the_filter_present(self):
        """`resolve_season()` runs unconditionally — the filter is not an escape hatch."""
        self.client.force_authenticate(self.permitted)
        response = self.client.get(
            URL, {'shipment': self.active_shipment.pk, 'season': 999999}
        )
        self.assertEqual(response.status_code, 404, response.content[:400])
