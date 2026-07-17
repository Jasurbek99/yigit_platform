"""Sales-report task wiring — step-4 reminder + satyldy report-existence trigger.

Covers the contract that:
  - a MANUAL_DONE `tasks.submit_sales_report` reminder is generated on step 4
    (yola_chykdy) and does NOT gate auto-advance (the truck still advances on
    its own trigger while the reminder stays open);
  - close_sales_report_task() closes that reminder when the report is saved;
  - the retargeted satyldy trigger (target_fields='sales_report') auto-advances
    to tamamlandy both when the report already exists on satyldy entry
    (early-fill) and when it is filled later at satyldy (late-fill).

Run:
    python manage.py test apps.export.tests_sales_report_task --keepdb
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import SalesReport, Shipment, Task, TaskState
from apps.export.services.task_rules import (
    close_sales_report_task,
    generate_tasks_for_status,
)


V2_STATUSES = [
    ('draft',           0,  'DRAFT'),
    ('gumruk_girish',   1,  'CUSTOMS'),
    ('gumruk_chykysh',  2,  'CUSTOMS'),
    ('yuklenme',        3,  'LOADING'),
    ('yola_chykdy',     4,  'TRANSIT'),
    ('serhet_gechdi',   5,  'BORDER'),
    ('dest_entry',      6,  'BORDER'),
    ('barysh_gumrugi',  7,  'BORDER'),
    ('transshipment',   8,  'SALES'),
    ('bardy',           9,  'SALES'),
    ('satylyar',       10,  'SALES'),
    ('satyldy',        11,  'SALES'),
    ('tamamlandy',     12,  'COMPLETE'),
]

REMINDER_TITLE = 'tasks.submit_sales_report'


def _ensure_statuses():
    for code, order, phase in V2_STATUSES:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk': code, 'name_en': code, 'name_ru': code,
                'step_order': order, 'phase': phase,
            },
        )


class SalesReportTaskTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(username='srt_user', password='pw', role='sales_rep')
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )

    def _make_shipment_at(self, code: str, status_code: str) -> Shipment:
        status = ShipmentStatusType.objects.get(code=status_code)
        shipment = Shipment.objects.create(
            shipment_code=code,
            date='2026-01-01',
            season=self.season,
            status=status,
            created_by=self.user,
            updated_by=self.user,
        )
        generate_tasks_for_status(shipment, status_code)
        return shipment

    def _reminder(self, shipment: Shipment) -> Task | None:
        return shipment.tasks.filter(title_key=REMINDER_TITLE).first()

    # ── reminder generated on step 4 and is a non-gating MANUAL_DONE task ──────
    def test_reminder_generated_on_step4_and_is_manual_done(self):
        shipment = self._make_shipment_at('0101001/26', 'yola_chykdy')
        reminder = self._reminder(shipment)
        self.assertIsNotNone(reminder)
        self.assertEqual(reminder.assignee_role, 'sales_rep')
        self.assertEqual(reminder.completion_rule, 'manual_done')
        self.assertEqual(reminder.state, TaskState.OPEN)

    def test_open_reminder_does_not_block_step4_advance(self):
        """Filling border_crossed_at advances yola_chykdy → serhet_gechdi even
        though the MANUAL_DONE report reminder is still OPEN (non-gating)."""
        shipment = self._make_shipment_at('0101002/26', 'yola_chykdy')
        self.assertEqual(self._reminder(shipment).state, TaskState.OPEN)

        from django.utils import timezone
        shipment.border_crossed_at = timezone.now()
        shipment.updated_by = self.user
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'serhet_gechdi')
        # Reminder still open — it followed the shipment, ungated.
        self.assertEqual(self._reminder(shipment).state, TaskState.OPEN)

    # ── close_sales_report_task closes the reminder without advancing mid-transit
    def test_close_reminder_on_report_fill_no_advance_midtransit(self):
        shipment = self._make_shipment_at('0101003/26', 'yola_chykdy')
        SalesReport.objects.create(shipment=shipment, created_by=self.user)

        closed = close_sales_report_task(shipment, self.user)
        self.assertEqual(closed, 1)

        shipment.refresh_from_db()
        self.assertEqual(self._reminder(shipment).state, TaskState.DONE)
        # Not at satyldy → no auto-advance.
        self.assertEqual(shipment.status.code, 'yola_chykdy')

    def test_close_is_idempotent(self):
        shipment = self._make_shipment_at('0101004/26', 'yola_chykdy')
        SalesReport.objects.create(shipment=shipment, created_by=self.user)
        self.assertEqual(close_sales_report_task(shipment, self.user), 1)
        # Second call finds no OPEN reminder to close.
        self.assertEqual(close_sales_report_task(shipment, self.user), 0)

    # ── satyldy report-existence trigger: early-fill resolves on entry ────────
    def test_satyldy_advances_to_tamamlandy_when_report_exists_early(self):
        """Report saved before satyldy → satylyar advance cascades through
        satyldy straight to tamamlandy on the same save (report already exists)."""
        shipment = self._make_shipment_at('0101005/26', 'satylyar')
        SalesReport.objects.create(shipment=shipment, created_by=self.user)

        from django.utils import timezone
        shipment.sale_ended_at = timezone.now()  # satylyar trigger
        shipment.updated_by = self.user
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')

    # ── satyldy report-existence trigger: late-fill at satyldy advances ───────
    def test_satyldy_advances_when_report_filled_late(self):
        """Shipment sits at satyldy with no report; filling it (via
        close_sales_report_task) resolves the trigger and advances."""
        shipment = self._make_shipment_at('0101006/26', 'satyldy')
        # No report yet → satyldy trigger task open, shipment stays put.
        self.assertEqual(shipment.status.code, 'satyldy')

        SalesReport.objects.create(shipment=shipment, created_by=self.user)
        close_sales_report_task(shipment, self.user)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')

    # ── end-to-end via the real endpoint (fresh reverse-OneToOne after save) ──
    def test_endpoint_fill_at_satyldy_advances_to_tamamlandy(self):
        """POST /shipments/{id}/sales-report/ at satyldy creates the report,
        closes the reminder, and auto-advances the shipment to tamamlandy —
        proving the reverse-OneToOne resolves after a same-request nested write."""
        superuser = User.objects.create_user(
            username='srt_super', password='pw', role='export_manager',
        )
        superuser.is_superuser = True
        superuser.is_staff = True
        superuser.save(update_fields=['is_superuser', 'is_staff'])

        shipment = self._make_shipment_at('0101007/26', 'satyldy')

        client = APIClient()
        client.force_authenticate(user=superuser)
        response = client.post(
            f'/api/v1/export/shipments/{shipment.id}/sales-report/',
            {'currency': 'KZT', 'exchange_rate': '470.0000'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')
