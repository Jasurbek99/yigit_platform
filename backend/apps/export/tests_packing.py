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
from apps.greenhouse.services.actual_rollup import parse_shipment_code_date

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


class UnjoinTests(PackingFixtures):
    """Spec §1.3."""

    def _unjoin(self, ship: Shipment, user: User | None = None):
        return self.client_for(user or self.manager).post(
            f'/api/v1/export/shipments/{ship.pk}/unjoin/', {}, format='json',
        )

    def test_unjoin_moves_packing_to_a_new_supply_plan(self):
        ship = self.make('gumruk_girish', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), datetime.date(2026, 9, 28))],
                         weight_net=Decimal('9000'))
        Shipment.objects.filter(pk=ship.pk).update(export_code='EXP-1', harvest_status='ok')
        resp = self._unjoin(ship)
        self.assertEqual(resp.status_code, 200, resp.data)
        new = Shipment.objects.get(pk=resp.data['new_supply_id'])
        self.assertEqual(resp.data['new_supply_code'], new.shipment_code)
        self.assertEqual(new.status.code, 'draft')
        self.assertIsNone(new.country_id)
        self.assertEqual(new.export_code, 'EXP-1')
        self.assertEqual(new.harvest_status, 'ok')
        self.assertEqual(list(new.block_sources.values_list('block_id', 'weight_kg', 'harvest_date')),
                         [(self.block_a.pk, Decimal('9000.00'), datetime.date(2026, 9, 28))])
        ship.refresh_from_db()
        self.assertFalse(ship.block_sources.exists())
        self.assertIsNone(ship.export_code)
        self.assertEqual(ship.status.code, 'gumruk_girish')
        self.assertEqual(ship.weight_net, Decimal('9000'))  # not draft → untouched

    def test_unjoin_from_draft_clears_net(self):
        ship = self.make('draft', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), None)], weight_net=Decimal('9000'))
        self._unjoin(ship)
        ship.refresh_from_db()
        self.assertIsNone(ship.weight_net)

    def test_unjoin_unweighed_blocks_carry_declared_total(self):
        ship = self.make('draft', destination=True,
                         blocks=[(self.block_a, None, None)], weight_net=Decimal('18000'))
        resp = self._unjoin(ship)
        new = Shipment.objects.get(pk=resp.data['new_supply_id'])
        self.assertEqual(new.weight_net, Decimal('18000'))

    def test_unjoin_new_code_uses_export_row_date(self):
        ship = self.make('gumruk_girish', destination=True, date=datetime.date(2026, 9, 25),
                         blocks=[(self.block_a, Decimal('9000'), None)])
        resp = self._unjoin(ship)
        self.assertEqual(parse_shipment_code_date(resp.data['new_supply_code']),
                         datetime.date(2026, 9, 25))

    def test_unjoin_logs_both_rows_and_notifies_loading_head(self):
        solt = _user('solt_pk_unjoin', 'loading_dept_head')
        clerk = _user('sirin_pk_unjoin', 'document_team')
        ship = self.make('gumruk_girish', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), None)])
        resp = self._unjoin(ship)
        new_id = resp.data['new_supply_id']
        self.assertTrue(ShipmentStatusLog.objects.filter(shipment=ship, comment__contains='detached').exists())
        self.assertTrue(ShipmentStatusLog.objects.filter(shipment_id=new_id).exists())
        self.assertTrue(Notification.objects.filter(user=solt).exists())
        self.assertTrue(Notification.objects.filter(user=clerk).exists())  # documents started
        self.assertFalse(Notification.objects.filter(user=self.manager).exists())  # actor

    def test_unjoin_refused_without_packing_after_loading_or_with_pallets(self):
        from apps.export.models import Pallet
        empty = self.make('gumruk_girish', destination=True)
        loading = self.make('yuklenme', destination=True, blocks=[(self.block_a, Decimal('1'), None)])
        palleted = self.make('gumruk_chykysh', destination=True, blocks=[(self.block_b, Decimal('1'), None)])
        Pallet.objects.create(**_pallet_kwargs(palleted, self.block_b))
        for ship in (empty, loading, palleted):
            with self.subTest(code=ship.shipment_code):
                self.assertEqual(self._unjoin(ship).status_code, 400)

    def test_unjoin_refused_on_a_free_supply_plan(self):
        free = self.make('draft', blocks=[(self.block_a, Decimal('9000'), None)])
        self.assertEqual(self._unjoin(free).status_code, 400)

    def test_sales_rep_may_not_unjoin(self):
        ship = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('1'), None)])
        self.assertEqual(self._unjoin(ship, _user('rep_pk_unjoin', 'sales_rep')).status_code, 403)


class SwapPackingTests(PackingFixtures):
    """Spec §1.4."""

    def _swap(self, a: Shipment, other_id: int, user: User | None = None):
        return self.client_for(user or self.manager).post(
            f'/api/v1/export/shipments/{a.pk}/swap-packaging/', {'other_id': other_id}, format='json',
        )

    def _blocks(self, ship: Shipment):
        return sorted(ship.block_sources.values_list('block_id', 'weight_kg', 'harvest_date'))

    def test_swap_exchanges_packing_only(self):
        a = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('9000'), None)])
        b = self.make('draft', destination=True, blocks=[(self.block_b, Decimal('7000'), None)])
        Shipment.objects.filter(pk=a.pk).update(export_code='A-CODE', truck_plate='AA 1111')
        Shipment.objects.filter(pk=b.pk).update(export_code='B-CODE', truck_plate='BB 2222')
        resp = self._swap(a, b.pk)
        self.assertEqual(resp.status_code, 200, resp.data)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual(self._blocks(a), [(self.block_b.pk, Decimal('7000.00'), None)])
        self.assertEqual(self._blocks(b), [(self.block_a.pk, Decimal('9000.00'), None)])
        self.assertEqual((a.export_code, b.export_code), ('B-CODE', 'A-CODE'))
        self.assertEqual((a.truck_plate, b.truck_plate), ('AA 1111', 'BB 2222'))  # not packing
        self.assertEqual(a.country_id, self.country.pk)

    def test_swap_same_block_same_date_on_both_sides(self):
        day = datetime.date(2026, 9, 28)
        a = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('9000'), day)])
        b = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('4000'), day)])
        resp = self._swap(a, b.pk)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self._blocks(a), [(self.block_a.pk, Decimal('4000.00'), day)])
        self.assertEqual(self._blocks(b), [(self.block_a.pk, Decimal('9000.00'), day)])

    def test_swap_weight_rule_per_side(self):
        a = self.make('draft', destination=True, blocks=[(self.block_a, Decimal('9000'), None)],
                      weight_net=Decimal('9000'))
        b = self.make('gumruk_girish', destination=True, blocks=[(self.block_b, Decimal('7000'), None)],
                      weight_net=Decimal('17500'))
        self._swap(a, b.pk)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual(a.weight_net, Decimal('7000'))   # draft follows packing
        self.assertEqual(b.weight_net, Decimal('17500'))  # documents started, entered net kept

    def test_swap_unweighed_packing_into_draft_carries_total(self):
        free = self.make('draft', blocks=[(self.block_a, None, None)], weight_net=Decimal('18000'))
        truck = self.make('draft', destination=True, blocks=[(self.block_b, Decimal('7000'), None)],
                          weight_net=Decimal('7000'))
        self._swap(truck, free.pk)
        truck.refresh_from_db()
        self.assertEqual(truck.weight_net, Decimal('18000'))

    def test_swap_with_a_free_supply_plan_replaces_the_truck_packing(self):
        truck = self.make('gumruk_chykysh', destination=True, blocks=[(self.block_a, Decimal('9000'), None)])
        free = self.make('draft', blocks=[(self.block_b, Decimal('7000'), None)])
        self.assertEqual(self._swap(truck, free.pk).status_code, 200)
        truck.refresh_from_db()
        self.assertEqual(self._blocks(truck), [(self.block_b.pk, Decimal('7000.00'), None)])

    def test_swap_refused(self):
        from apps.export.models import Pallet
        full = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('1'), None)])
        empty = self.make('gumruk_girish', destination=True)
        loading = self.make('yuklenme', destination=True, blocks=[(self.block_b, Decimal('1'), None)])
        palleted = self.make('gumruk_chykysh', destination=True, blocks=[(self.block_b, Decimal('1'), None)])
        Pallet.objects.create(**_pallet_kwargs(palleted, self.block_b))
        for other in (empty, loading, palleted):
            with self.subTest(other=other.shipment_code):
                self.assertEqual(self._swap(full, other.pk).status_code, 400)
        self.assertEqual(self._swap(full, full.pk).status_code, 400)

    def test_swap_with_consumed_source_returns_404(self):
        target = self.make('gumruk_girish', destination=True)
        source = self.make('draft', blocks=[(self.block_a, Decimal('9000'), None)])
        other = self.make('gumruk_girish', destination=True, blocks=[(self.block_b, Decimal('1'), None)])
        source_id = source.pk
        self.client_for(self.manager).post(
            f'/api/v1/export/shipments/{target.pk}/join/', {'source_id': source_id}, format='json')
        self.assertEqual(self._swap(other, source_id).status_code, 404)
        other.refresh_from_db()
        self.assertEqual(other.block_sources.count(), 1)

    def test_swap_logs_and_notifies(self):
        solt = _user('solt_pk_swap', 'loading_dept_head')
        a = self.make('draft', destination=True, blocks=[(self.block_a, Decimal('1'), None)])
        b = self.make('draft', blocks=[(self.block_b, Decimal('1'), None)])
        self._swap(a, b.pk)
        for ship in (a, b):
            self.assertTrue(ShipmentStatusLog.objects.filter(shipment=ship, comment__contains='swapped').exists())
        self.assertTrue(Notification.objects.filter(user=solt).exists())

    def test_old_swap_endpoint_is_gone(self):
        a = self.make('draft', destination=True)
        resp = self.client_for(self.manager).post(
            f'/api/v1/export/shipments/{a.pk}/swap/', {'other_id': a.pk, 'fields': ['truck_plate']},
            format='json')
        self.assertEqual(resp.status_code, 404)


class BoardListTests(PackingFixtures):
    """Spec Part 2 §4 — the board's one query."""

    def test_status_code_in_returns_pre_loading_rows_with_ids(self):
        wanted = [self.make(code, destination=True) for code in ('draft', 'gumruk_girish', 'gumruk_chykysh')]
        self.make('yuklenme', destination=True)
        # The exact query useJoinBoard() sends.
        resp = self.client_for(self.manager).get(
            '/api/v1/export/shipments/?status_code__in=draft,gumruk_girish,gumruk_chykysh'
            f'&page_size=200&ordering=harvest_age_desc&season={self.season.pk}')
        self.assertEqual(resp.status_code, 200, resp.data)
        rows = {r['id']: r for r in resp.data['results']}
        self.assertEqual(set(rows), {s.pk for s in wanted})
        row = rows[wanted[1].pk]
        self.assertEqual(row['country'], self.country.pk)
        self.assertEqual(row['customer'], self.customer.pk)
        self.assertEqual(row['status_code'], 'gumruk_girish')
        self.assertIn('block_sources', row)
        self.assertIn('truck_plate', row)

    def test_plain_draft_list_unchanged(self):
        self.make('draft')
        resp = self.client_for(self.manager).get(
            f'/api/v1/export/shipments/?status_code=draft&page_size=200&season={self.season.pk}')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('block_sources', resp.data['results'][0])
