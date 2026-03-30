from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import ShipmentStatusType, Season, User
from apps.export.models import Shipment, ShipmentStatusLog, SalesReport
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
        # export_manager is a privileged role — it can trigger any valid transition.
        # Use it in tests that walk multi-step chains to avoid per-step role setup.
        self.user = User.objects.create_user(
            username='testuser', password='pass', role='export_manager'
        )
        self.warehouse_user = User.objects.create_user(
            username='wh_user', password='pass', role='warehouse_chief'
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
        # warehouse_chief is the allowed role for yuklenme → gumruk_girish.
        transition_to(self.shipment, 'gumruk_girish', self.warehouse_user)
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

    def test_role_enforcement_raises_permission_error(self):
        """Wrong role on a step must raise PermissionError."""
        # document_team is not allowed to trigger yuklenme → gumruk_girish (warehouse_chief only).
        doc_user = User.objects.create_user(
            username='doc_user', password='pass', role='document_team'
        )
        with self.assertRaises(PermissionError):
            transition_to(self.shipment, 'gumruk_girish', doc_user)

    def test_privileged_role_bypasses_role_restriction(self):
        """export_manager can trigger any valid transition regardless of per-step role."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')

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


class SalesReportTest(TestCase):
    """Tests for POST/PATCH /api/v1/export/shipments/{id}/sales-report/."""

    def setUp(self):
        self.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30'
        )
        _create_all_statuses()
        self.hasabat_status = ShipmentStatusType.objects.get(code='hasabat')
        self.loading_status = ShipmentStatusType.objects.get(code='yuklenme')
        self.serhet_tm_status = ShipmentStatusType.objects.get(code='serhet_tm')

        self.sales_user = User.objects.create_user(
            username='sales_rep_1', password='pass', role='sales_rep'
        )
        self.manager_user = User.objects.create_user(
            username='mgr_1', password='pass', role='export_manager'
        )
        self.wh_user = User.objects.create_user(
            username='wh_1', password='pass', role='warehouse_chief'
        )

        self.shipment_at_hasabat = Shipment.objects.create(
            cargo_code='0101001/25',
            date='2025-01-01',
            season=self.season,
            status=self.hasabat_status,
        )
        self.shipment_at_serhet_tm = Shipment.objects.create(
            cargo_code='0101002/25',
            date='2025-01-02',
            season=self.season,
            status=self.serhet_tm_status,
        )

        self.client = APIClient()

    def _url(self, shipment_id: int) -> str:
        return f'/api/v1/export/shipments/{shipment_id}/sales-report/'

    def test_sales_report_created_at_hasabat(self):
        """POST sales-report at hasabat must create a SalesReport and return 200."""
        self.client.force_authenticate(user=self.sales_user)
        payload = {
            'price_per_kg': '0.8500',
            'total_usd': '15725.00',
            'weight_sold_kg': '18500.00',
            'weight_rejected_kg': '120.00',
            'transport_cost_usd': '300.00',
            'market_fee_usd': '50.00',
            'other_expenses_usd': '25.00',
            'notes': 'All sold without issues.',
        }
        response = self.client.post(self._url(self.shipment_at_hasabat.id), payload, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        # Verify DB row was created.
        report = SalesReport.objects.get(shipment=self.shipment_at_hasabat)
        self.assertEqual(str(report.price_per_kg), '0.8500')
        self.assertEqual(str(report.weight_sold_kg), '18500.00')
        # Verify response contains nested sales_report.
        self.assertIn('sales_report', response.data)
        self.assertEqual(response.data['sales_report']['price_per_kg'], '0.8500')

    def test_sales_report_patch_updates_existing(self):
        """PATCH sales-report updates an existing report without losing other fields."""
        # Create an initial report.
        report = SalesReport.objects.create(
            shipment=self.shipment_at_hasabat,
            created_by=self.sales_user,
            price_per_kg='0.8000',
            weight_sold_kg='18000.00',
        )
        self.client.force_authenticate(user=self.sales_user)
        response = self.client.patch(
            self._url(self.shipment_at_hasabat.id),
            {'price_per_kg': '0.9000'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        report.refresh_from_db()
        # Price updated.
        self.assertEqual(str(report.price_per_kg), '0.9000')
        # Other field preserved.
        self.assertEqual(str(report.weight_sold_kg), '18000.00')

    def test_sales_report_blocked_before_hasabat(self):
        """POST at step 5 (serhet_tm) must return 400."""
        self.client.force_authenticate(user=self.sales_user)
        response = self.client.post(
            self._url(self.shipment_at_serhet_tm.id),
            {'price_per_kg': '0.85'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('hasabat', response.data['error'])

    def test_sales_report_wrong_role(self):
        """POST as warehouse_chief must return 403."""
        self.client.force_authenticate(user=self.wh_user)
        response = self.client.post(
            self._url(self.shipment_at_hasabat.id),
            {'price_per_kg': '0.85'},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_sales_report_export_manager_allowed(self):
        """export_manager (privileged) must be able to POST a sales report."""
        self.client.force_authenticate(user=self.manager_user)
        response = self.client.post(
            self._url(self.shipment_at_hasabat.id),
            {'price_per_kg': '0.9200', 'total_usd': '17020.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(SalesReport.objects.filter(shipment=self.shipment_at_hasabat).exists())
