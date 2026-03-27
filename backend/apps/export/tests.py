from django.test import TestCase

from apps.core.models import ShipmentStatusType, Season, User
from apps.export.models import Shipment, ShipmentStatusLog
from apps.export.services import transition_to, TRANSITIONS


def _create_all_statuses():
    """Create all 13 shipment status types used in the lifecycle."""
    statuses = [
        ('yuklenme',      1,  'LOADING'),
        ('gumruk_girish', 2,  'CUSTOMS'),
        ('gumruk_chykysh',3,  'CUSTOMS'),
        ('yola_chykdy',   4,  'TRANSIT'),
        ('serhet_tm',     5,  'BORDER'),
        ('serhet_gechdi', 6,  'BORDER'),
        ('barysh_gumrugi',7,  'BORDER'),
        ('yolda',         8,  'TRANSIT'),
        ('bardy',         9,  'SALES'),
        ('satylyar',      10, 'SALES'),
        ('satyldy',       11, 'SALES'),
        ('hasabat',       12, 'COMPLETE'),
        ('tamamlandy',    13, 'COMPLETE'),
    ]
    for code, order, phase in statuses:
        ShipmentStatusType.objects.create(
            code=code,
            name_tk=code,
            name_en=code,
            step_order=order,
            phase=phase,
        )


class TransitionServiceTest(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30'
        )
        self.user = User.objects.create_user(
            username='testuser', password='pass', role='warehouse_chief'
        )
        _create_all_statuses()
        self.loading_status = ShipmentStatusType.objects.get(code='yuklenme')
        self.shipment = Shipment.objects.create(
            cargo_code='TEST-001',
            date='2025-11-01',
            season=self.season,
            status=self.loading_status,
        )

    def test_valid_transition(self):
        """A valid sequential transition must update the shipment status."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')

    def test_ad1_timestamp_set_on_departed(self):
        """AD-1: departed_at must be set when transitioning to yola_chykdy."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        transition_to(self.shipment, 'gumruk_chykysh', self.user)
        transition_to(self.shipment, 'yola_chykdy', self.user)
        self.shipment.refresh_from_db()
        self.assertIsNotNone(self.shipment.departed_at)

    def test_ad1_timestamp_not_set_for_intermediate_status(self):
        """AD-1: serhet_tm has no timestamp mapping — none of the AD-1 fields should be set."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        transition_to(self.shipment, 'gumruk_chykysh', self.user)
        transition_to(self.shipment, 'yola_chykdy', self.user)
        transition_to(self.shipment, 'serhet_tm', self.user)
        self.shipment.refresh_from_db()
        # border_crossed_at is set by serhet_gechdi, not serhet_tm
        self.assertIsNone(self.shipment.border_crossed_at)

    def test_invalid_transition_raises(self):
        """Skipping steps should raise ValueError."""
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'tamamlandy', self.user)

    def test_invalid_transition_backwards_raises(self):
        """Backwards transitions should raise ValueError."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'yuklenme', self.user)

    def test_status_log_created(self):
        """Each transition must append one row to ShipmentStatusLog."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        self.assertEqual(ShipmentStatusLog.objects.filter(shipment=self.shipment).count(), 1)

    def test_status_log_comment_stored(self):
        """Comment text must be persisted in the status log entry."""
        transition_to(self.shipment, 'gumruk_girish', self.user, comment='Docs checked')
        log_entry = ShipmentStatusLog.objects.get(shipment=self.shipment)
        self.assertEqual(log_entry.comment, 'Docs checked')

    def test_multiple_transitions_produce_multiple_log_entries(self):
        """Two transitions should produce two log entries."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        transition_to(self.shipment, 'gumruk_chykysh', self.user)
        self.assertEqual(ShipmentStatusLog.objects.filter(shipment=self.shipment).count(), 2)

    def test_terminal_status_has_no_transitions(self):
        """tamamlandy is terminal — TRANSITIONS dict must return empty list."""
        self.assertEqual(TRANSITIONS['tamamlandy'], [])

    def test_full_lifecycle(self):
        """Walk all 13 statuses in order and verify final status is tamamlandy."""
        chain = [
            'gumruk_girish', 'gumruk_chykysh', 'yola_chykdy', 'serhet_tm',
            'serhet_gechdi', 'barysh_gumrugi', 'yolda', 'bardy',
            'satylyar', 'satyldy', 'hasabat', 'tamamlandy',
        ]
        for code in chain:
            transition_to(self.shipment, code, self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'tamamlandy')
        # All 12 transitions logged (shipment started at yuklenme)
        self.assertEqual(ShipmentStatusLog.objects.filter(shipment=self.shipment).count(), 12)
