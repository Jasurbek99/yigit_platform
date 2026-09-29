"""Packing part moves — loading barrier, late join, unjoin, swap-packaging.

Spec: docs/superpowers/specs/2026-09-29-packaging-join-board-design.md
"""
import datetime
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, Customer, GreenhouseBlock, Season, ShipmentStatusType, User
from apps.export.models import Notification, Shipment, ShipmentBlockSource, ShipmentStatusLog
from apps.export.services.shipment import transition_to

#: (code, step_order, phase) — same values as tests_cancel.ALL_TEST_STATUSES.
STATUSES = [
    ('draft', 0, 'DRAFT'),
    ('gumruk_girish', 1, 'CUSTOMS'),
    ('gumruk_chykysh', 2, 'CUSTOMS'),
    ('yuklenme', 3, 'LOADING'),
    ('yola_chykdy', 4, 'TRANSIT'),
    ('cancelled', 99, 'CANCELLED'),
]


def _statuses() -> None:
    for code, order, phase in STATUSES:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={'name_tk': code, 'name_en': code, 'step_order': order, 'phase': phase},
        )


def _user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class PackingFixtures(TestCase):
    """Shared world: statuses, season, one destination, three blocks."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _statuses()
        cls.season, _ = Season.objects.get_or_create(
            name='pk-test',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.country, _ = Country.objects.get_or_create(
            code='PK', defaults={'name_tk': 'PK', 'name_en': 'PK', 'name_ru': 'PK'},
        )
        cls.customer, _ = Customer.objects.get_or_create(name='PackingTestCustomer')
        cls.block_a, _ = GreenhouseBlock.objects.get_or_create(code='PA', defaults={'name': 'PA'})
        cls.block_b, _ = GreenhouseBlock.objects.get_or_create(code='PB', defaults={'name': 'PB'})
        cls.manager = _user('gadam_pk', 'export_manager')

    _seq = 0

    def make(self, status: str = 'draft', *, destination: bool = False,
             blocks: list[tuple] | None = None, weight_net=None,
             date: datetime.date = datetime.date(2026, 9, 29)) -> Shipment:
        """Create one shipment row. blocks = [(block, weight_kg, harvest_date), ...]."""
        PackingFixtures._seq += 1
        ship = Shipment.objects.create(
            shipment_code=f'{date:%d%m}{900 + PackingFixtures._seq}/{date:%y}',
            date=date,
            season=self.season,
            status=ShipmentStatusType.objects.get(code=status),
            country=self.country if destination else None,
            customer=self.customer if destination else None,
            weight_net=weight_net,
            created_by=self.manager,
        )
        for block, kg, harvest in blocks or []:
            ShipmentBlockSource.objects.create(
                shipment=ship, block=block, weight_kg=kg, harvest_date=harvest,
            )
        return ship

    def client_for(self, user: User) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client


class LoadingBarrierTests(PackingFixtures):
    """Spec §1.1 — documents may start before packing; loading may not."""

    def test_destination_plan_without_packing_leaves_draft(self):
        ship = self.make('draft', destination=True)
        transition_to(ship, 'gumruk_girish', self.manager)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'gumruk_girish')

    def test_supply_plan_without_destination_still_cannot_leave_draft(self):
        ship = self.make('draft', blocks=[(self.block_a, Decimal('9000'), None)])
        with self.assertRaises(ValueError) as ctx:
            transition_to(ship, 'gumruk_girish', self.manager)
        self.assertIn('country', str(ctx.exception))
        self.assertIn('customer', str(ctx.exception))

    def test_loading_refused_without_packing(self):
        ship = self.make('gumruk_chykysh', destination=True)
        with self.assertRaises(ValueError) as ctx:
            transition_to(ship, 'yuklenme', self.manager)
        self.assertIn('Packing not joined', str(ctx.exception))
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'gumruk_chykysh')

    def test_loading_allowed_with_packing(self):
        ship = self.make('gumruk_chykysh', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), None)])
        transition_to(ship, 'yuklenme', self.manager)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'yuklenme')

    def test_cancel_still_allowed_without_packing(self):
        ship = self.make('gumruk_chykysh', destination=True)
        transition_to(ship, 'cancelled', self.manager)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'cancelled')


class LoadingStartedPatchTests(PackingFixtures):
    """Spec §1.1 — a visible 400 instead of a silent stall at gumruk_chykysh."""

    def _patch(self, ship: Shipment):
        return self.client_for(self.manager).patch(
            f'/api/v1/export/shipments/{ship.pk}/',
            {'loading_started_at': '2026-09-29T08:00:00Z'},
            format='json',
        )

    def test_loading_started_refused_on_customs_row_without_packing(self):
        ship = self.make('gumruk_chykysh', destination=True)
        resp = self._patch(ship)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('loading_started_at', resp.data)
        self.assertIn('Packing not joined', str(resp.data['loading_started_at']))
        ship.refresh_from_db()
        self.assertIsNone(ship.loading_started_at)
        self.assertEqual(ship.status.code, 'gumruk_chykysh')

    def test_loading_started_accepted_on_customs_row_with_packing(self):
        ship = self.make('gumruk_chykysh', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), None)])
        resp = self._patch(ship)
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_legacy_row_after_loading_without_blocks_can_still_be_edited(self):
        ship = self.make('yola_chykdy', destination=True)
        resp = self._patch(ship)
        self.assertEqual(resp.status_code, 200, resp.data)
