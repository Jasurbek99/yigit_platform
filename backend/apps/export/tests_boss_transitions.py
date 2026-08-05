"""Boss can drive the shipment state machine (2026-08-05 boss-process-visibility).

`transition_to()` gates each edge on the role that owns it, unless the actor's
role is in PRIVILEGED_ROLES. The boss must be able to unstick any step without
logging in as the owning role — but a closed season must still stay frozen.
"""
from django.test import TestCase
from django.utils import timezone

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
