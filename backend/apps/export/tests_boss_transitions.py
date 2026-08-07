"""Boss can drive the shipment state machine (2026-08-05 boss-process-visibility).

`transition_to()` gates each edge on the role that owns it, unless the actor's
role is in PRIVILEGED_ROLES. The boss must be able to unstick any step without
logging in as the owning role — but a closed season must still stay frozen.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    ShipmentStatusType,
    User,
)
from apps.core.models import Season
from apps.core.seasons import SeasonClosedError
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services import transition_to
from apps.export.services.shipment import CANCEL_ROLES, TRANSITIONS


def _grant_shipment_crud(*roles: str) -> None:
    """Give each role full `shipment` resource permissions.

    ShipmentViewSet carries ``DynamicResourcePermission``, which reads
    RoleResourcePermission and denies a role with no row — so without this the
    endpoint tests below would 403 at the DRF layer and never reach the guard
    they exist to exercise (i.e. pass, or fail, for the wrong reason). Mirrors
    the post-0033 production matrix, where boss holds shipment VCRUD.
    Also clears the permission cache, which get_resource_perm() populates.
    """
    from django.core.cache import cache

    from apps.core.models import RoleResourcePermission

    for role in roles:
        RoleResourcePermission.objects.update_or_create(
            role=role,
            resource_code='shipment',
            defaults={
                'can_view': True, 'can_create': True,
                'can_edit': True, 'can_delete': True,
            },
        )
    cache.clear()


def _create_all_statuses():
    """State machine v2 status types (12 active + 3 retired)."""
    statuses = [
        ('draft',           0,  'DRAFT',    True),
        ('gumruk_girish',   1,  'CUSTOMS',  True),
        ('gumruk_chykysh',  2,  'CUSTOMS',  True),
        ('yuklenme',        3,  'LOADING',  True),
        ('yola_chykdy',     4,  'TRANSIT',  True),
        ('serhet_gechdi',   5,  'BORDER',   True),
        ('dest_entry',      6,  'BORDER',   True),
        ('barysh_gumrugi',  7,  'BORDER',   True),
        ('transshipment',   8,  'SALES',    True),
        ('bardy',           9,  'SALES',    True),
        ('satylyar',       10,  'SALES',    True),
        ('satyldy',        11,  'SALES',    True),
        ('tamamlandy',     12,  'COMPLETE', True),
        ('cancelled',      99,  'CANCELLED', True),
        ('serhet_tm',     100,  'BORDER',   False),
        ('yolda',         101,  'TRANSIT',  False),
        ('hasabat',       102,  'COMPLETE', False),
    ]
    for code, order, phase, is_active in statuses:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk':    code,
                'name_en':    code,
                'step_order': order,
                'phase':      phase,
                'is_active':  is_active,
            },
        )


class BossTransitionTests(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30'
        )
        self.boss = User.objects.create_user(
            username='bossuser', password='pass', role='boss'
        )
        _create_all_statuses()
        draft = ShipmentStatusType.objects.get(code='draft')
        self.country = Country.objects.create(
            name_tk='KZ', name_en='KZ', name_ru='KZ', code='KZ'
        )
        self.customer = Customer.objects.create(name='TestCustomer-Boss')
        self.block = GreenhouseBlock.objects.create(code='F-B1', name='Test block B1')
        self.shipment = Shipment.objects.create(
            shipment_code='BOSS-001',
            date='2025-11-01',
            season=self.season,
            status=draft,
            country=self.country,
            customer=self.customer,
            has_peregruz=False,
        )
        # transition_to()'s draft-leave guard needs both halves of the two-row flow.
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block, weight_kg=10000,
        )

    def test_boss_may_trigger_a_transition_owned_by_another_role(self):
        """draft -> gumruk_girish is document_team's edge. Boss must pass."""
        transition_to(self.shipment, 'gumruk_girish', self.boss)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')

    def test_boss_still_cannot_skip_steps(self):
        """Privilege bypasses the ROLE check, never the state machine itself."""
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'tamamlandy', self.boss)

    def test_boss_cannot_write_to_a_closed_season(self):
        """D1 write freeze outranks privilege.

        Season.is_closed is a read-only property derived from closed_at
        (apps/core/models/products.py); set closed_at directly rather than
        the property to trip assert_season_open().
        """
        self.season.closed_at = timezone.now()
        self.season.save(update_fields=['closed_at'])
        with self.assertRaises(SeasonClosedError):
            transition_to(self.shipment, 'gumruk_girish', self.boss)


class CancelIsNotAGenericTransitionTests(TestCase):
    """Cancelling must go through /cancel/, never the generic /transition/.

    /cancel/ carries side effects the generic path skips: open Tasks are
    marked CANCELLED, draft QuotaUsageRecords are deleted and a reason is
    mandatory. A shipment cancelled through /transition/ lands in 'cancelled'
    with dangling work items, so the endpoint refuses that target for EVERY
    role — including the ones that may legitimately cancel.

    Note on mechanism: boss is in ``services.shipment.PRIVILEGED_ROLES``, which
    bypasses the per-edge role list inside ``transition_to()`` entirely. So the
    cancel edge's own role list is not what stops him — this endpoint guard is.
    CANCEL_ROLES is asserted separately below to keep the two concerns from
    silently moving together again.
    """

    def setUp(self) -> None:
        self.season = Season.objects.create(
            name='2025-C', start_date='2025-09-01', end_date='2026-06-30'
        )
        self.boss = User.objects.create_user(
            username='boss_cancel', password='pass', role='boss'
        )
        self.manager = User.objects.create_user(
            username='mgr_cancel', password='pass', role='export_manager'
        )
        _grant_shipment_crud('boss', 'export_manager')
        _create_all_statuses()
        self.country = Country.objects.create(
            name_tk='KZ2', name_en='KZ2', name_ru='KZ2', code='K2'
        )
        self.customer = Customer.objects.create(name='TestCustomer-Cancel')
        self.block = GreenhouseBlock.objects.create(code='F-B2', name='Test block B2')
        self.shipment = Shipment.objects.create(
            shipment_code='BOSS-CANCEL-001',
            date='2025-11-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            country=self.country,
            customer=self.customer,
            has_peregruz=False,
        )
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block, weight_kg=10000,
        )
        self.client = APIClient()

    def _transition(self, user, new_status: str):
        self.client.force_authenticate(user=user)
        return self.client.post(
            f'/api/v1/export/shipments/{self.shipment.pk}/transition/',
            {'new_status': new_status},
            format='json',
        )

    def test_boss_cannot_reach_cancelled_through_the_transition_endpoint(self) -> None:
        """The path that skipped /cancel/'s side effects now 400s."""
        resp = self._transition(self.boss, 'cancelled')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('cancel/', resp.data['error'])
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'draft')

    def test_cancel_roles_are_also_refused_the_generic_path(self) -> None:
        """The guard is about the PATH, not the role: export_manager may
        cancel, and is still sent to /cancel/ to get the side effects."""
        resp = self._transition(self.manager, 'cancelled')
        self.assertEqual(resp.status_code, 400)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'draft')

    def test_forward_transitions_are_unaffected(self) -> None:
        """Only 'cancelled' is refused — the rest of the state machine is untouched."""
        resp = self._transition(self.boss, 'gumruk_girish')
        self.assertEqual(resp.status_code, 200)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')

    def test_cancel_edges_do_not_list_boss(self) -> None:
        """CANCEL_ROLES must not be derived from PRIVILEGED_ROLES.

        Fails the moment someone writes ``CANCEL_ROLES = PRIVILEGED_ROLES |
        {'admin'}`` again — which silently rewrote every cancel edge below.
        """
        self.assertEqual(CANCEL_ROLES, {'admin', 'export_manager', 'director'})
        for from_code, edges in TRANSITIONS.items():
            for edge in edges:
                if edge[0] == 'cancelled':
                    self.assertNotIn(
                        'boss', edge[1],
                        f'cancel edge from {from_code!r} lists boss',
                    )


class CancelEndpointGatingUnchangedTests(TestCase):
    """/cancel/'s own role gate is untouched by the boss widening.

    It reads ``apps.core.roles.PRIVILEGED_ROLES`` (admin/export_manager/
    director) — a DIFFERENT constant from the one this branch widened.
    """

    def setUp(self) -> None:
        self.season = Season.objects.create(
            name='2025-G', start_date='2025-09-01', end_date='2026-06-30'
        )
        self.boss = User.objects.create_user(
            username='boss_gate', password='pass', role='boss'
        )
        self.manager = User.objects.create_user(
            username='mgr_gate', password='pass', role='export_manager'
        )
        _grant_shipment_crud('boss', 'export_manager')
        _create_all_statuses()
        self.country = Country.objects.create(
            name_tk='KZ3', name_en='KZ3', name_ru='KZ3', code='K3'
        )
        self.customer = Customer.objects.create(name='TestCustomer-Gate')
        self.client = APIClient()

    def _shipment(self, code: str) -> Shipment:
        return Shipment.objects.create(
            shipment_code=code,
            date='2025-11-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='gumruk_girish'),
            country=self.country,
            customer=self.customer,
            has_peregruz=False,
        )

    def _cancel(self, user, shipment: Shipment):
        self.client.force_authenticate(user=user)
        return self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/',
            {'reason': 'test cancellation'},
            format='json',
        )

    def test_boss_is_still_rejected_by_the_cancel_endpoint(self) -> None:
        """Boss never had this; closing /transition/ must not have opened it."""
        shipment = self._shipment('BOSS-GATE-001')
        resp = self._cancel(self.boss, shipment)
        self.assertEqual(resp.status_code, 403)
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'gumruk_girish')

    def test_export_manager_can_still_cancel(self) -> None:
        """The role that legitimately cancels still can — with a reason."""
        shipment = self._shipment('MGR-GATE-001')
        resp = self._cancel(self.manager, shipment)
        self.assertEqual(resp.status_code, 200)
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'cancelled')

    def test_cancel_endpoint_still_requires_a_reason(self) -> None:
        """The mandatory reason the generic path never supplied."""
        shipment = self._shipment('MGR-GATE-002')
        self.client.force_authenticate(user=self.manager)
        resp = self.client.post(
            f'/api/v1/export/shipments/{shipment.pk}/cancel/', {}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'gumruk_girish')
