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
from apps.export.services.packaging import net_update, packaging_weight
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


def _pallet_kwargs(shipment: Shipment, block: GreenhouseBlock) -> dict:
    """Minimal Pallet row — the model's required fields only."""
    from apps.core.models import CrateType, TomatoVariety
    crate, _ = CrateType.objects.get_or_create(name='PK crate', defaults={'weight_kg': Decimal('0.543')})
    variety, _ = TomatoVariety.objects.get_or_create(name='PK variety')
    return {
        'shipment': shipment, 'pallet_number': 1, 'crate_type': crate, 'crate_count': 10,
        'gross_weight_kg': Decimal('500'), 'pallet_weight_kg': Decimal('20'),
        'additions_kg': Decimal('0'), 'variety': variety, 'sub_block': block,
        'created_by': shipment.created_by,
    }


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


class PackagingWeightTests(PackingFixtures):
    """Spec, Terms — packaging_weight and the weight rule."""

    def test_all_blocks_weighed_sums_them(self):
        ship = self.make(blocks=[(self.block_a, Decimal('6000'), None),
                                 (self.block_b, Decimal('4000'), None)])
        self.assertEqual(packaging_weight(ship), Decimal('10000'))

    def test_unweighed_draft_uses_declared_total(self):
        ship = self.make(blocks=[(self.block_a, None, None)], weight_net=Decimal('18000'))
        self.assertEqual(packaging_weight(ship), Decimal('18000'))

    def test_no_blocks_is_none(self):
        self.assertIsNone(packaging_weight(self.make()))

    def test_draft_row_takes_incoming(self):
        ship = self.make('draft', destination=True, weight_net=Decimal('1'))
        self.assertEqual(net_update(ship, Decimal('9000')), {'weight_net': Decimal('9000')})
        self.assertEqual(net_update(ship, None), {'weight_net': None})

    def test_customs_row_fills_only_empty_net(self):
        empty = self.make('gumruk_girish', destination=True)
        filled = self.make('gumruk_girish', destination=True, weight_net=Decimal('17500'))
        self.assertEqual(net_update(empty, Decimal('9000')), {'weight_net': Decimal('9000')})
        self.assertEqual(net_update(filled, Decimal('9000')), {})


class LateJoinTests(PackingFixtures):
    """Spec §1.2 — join up to gumruk_chykysh."""

    def _join(self, target: Shipment, source: Shipment, user: User | None = None):
        return self.client_for(user or self.manager).post(
            f'/api/v1/export/shipments/{target.pk}/join/', {'source_id': source.pk}, format='json',
        )

    def _supply(self, kg=Decimal('12000')) -> Shipment:
        return self.make('draft', blocks=[(self.block_a, kg, None)])

    def test_join_into_each_pre_loading_status(self):
        for code in ('draft', 'gumruk_girish', 'gumruk_chykysh'):
            with self.subTest(status=code):
                target = self.make(code, destination=True)
                resp = self._join(target, self._supply())
                self.assertEqual(resp.status_code, 200, resp.data)
                target.refresh_from_db()
                self.assertEqual(target.status.code, code)  # status never moves
                self.assertEqual(target.block_sources.count(), 1)

    def test_join_refused_once_loading_started(self):
        target = self.make('yuklenme', destination=True)
        resp = self._join(target, self._supply())
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_join_refused_when_target_has_pallets(self):
        from apps.export.models import Pallet
        target = self.make('gumruk_chykysh', destination=True)
        Pallet.objects.create(**_pallet_kwargs(target, self.block_a))
        resp = self._join(target, self._supply())
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_late_join_fills_empty_net(self):
        target = self.make('gumruk_girish', destination=True)
        self._join(target, self._supply(Decimal('12000')))
        target.refresh_from_db()
        self.assertEqual(target.weight_net, Decimal('12000'))

    def test_late_join_keeps_entered_net_and_gross(self):
        target = self.make('gumruk_girish', destination=True, weight_net=Decimal('17500'))
        Shipment.objects.filter(pk=target.pk).update(weight_gross=Decimal('19000'))
        self._join(target, self._supply(Decimal('12000')))
        target.refresh_from_db()
        self.assertEqual(target.weight_net, Decimal('17500'))
        self.assertEqual(target.weight_gross, Decimal('19000'))

    def test_loading_dept_head_may_join(self):
        solt = _user('solt_pk_join', 'loading_dept_head')
        target = self.make('gumruk_girish', destination=True)
        resp = self._join(target, self._supply(), user=solt)
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_sales_rep_may_not_join(self):
        rep = _user('rep_pk_join', 'sales_rep')
        target = self.make('gumruk_girish', destination=True)
        resp = self._join(target, self._supply(), user=rep)
        self.assertEqual(resp.status_code, 403, resp.data)
