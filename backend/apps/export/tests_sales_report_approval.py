"""«Hasabaty gözden geçir we tassykla» — docs/Tasks.md item 37 (owner, 2026-09-29).

At satyldy an export manager (either of them; admin / boss / director too) must
approve the sales report before the shipment closes (tamamlandy). Approve only —
no reject path; remarks go through comments.
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import Command as SeedTaskRulesCommand
from apps.export.models import SalesReport, Shipment, TaskState
from apps.export.services.task_rules import generate_tasks_for_status

STATUSES = [('yola_chykdy', 4, 'TRANSIT'), ('satylyar', 10, 'SALES'), ('satyldy', 11, 'SALES'),
            ('tamamlandy', 12, 'COMPLETE')]


class SalesReportApprovalTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for code, order, phase in STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase},
            )
        SeedTaskRulesCommand().handle(reset=False)
        # ShipmentViewSet's resource permissions come from the matrix.
        from django.core.management import call_command
        call_command('seed_permissions', verbosity=0)
        cls.rep = User.objects.create_user(username='sra_rep', password='pw', role='sales_rep')
        cls.em = User.objects.create_user(username='sra_em', password='pw', role='export_manager')
        cls.boss = User.objects.create_user(username='sra_boss', password='pw', role='boss')
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )

    def _sold(self, code='SRA-1', with_report=True) -> Shipment:
        shipment = Shipment.objects.create(
            shipment_code=code, date='2026-01-01', season=self.season,
            status=ShipmentStatusType.objects.get(code='satyldy'),
            created_by=self.rep, updated_by=self.rep,
        )
        if with_report:
            SalesReport.objects.create(shipment=shipment, created_by=self.rep, currency='KZT')
        generate_tasks_for_status(shipment, 'satyldy')
        shipment.save()          # resolve + auto-advance, as any Sheet save would
        shipment.refresh_from_db()
        return shipment

    def _approve(self, user, shipment):
        client = APIClient()
        client.force_authenticate(user)
        return client.post(f'/api/v1/export/shipments/{shipment.id}/sales-report/approve/')

    def test_report_alone_no_longer_closes_the_shipment(self):
        shipment = self._sold()
        self.assertEqual(shipment.status.code, 'satyldy')
        task = shipment.tasks.get(title_key='tasks.approve_sales_report')
        self.assertEqual(task.assignee_role, 'export_manager')
        self.assertEqual(task.state, TaskState.OPEN)

    def test_export_manager_approves_and_the_shipment_closes(self):
        shipment = self._sold()
        resp = self._approve(self.em, shipment)
        self.assertEqual(resp.status_code, 200, resp.content)
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')
        report = SalesReport.objects.get(shipment=shipment)
        self.assertIsNotNone(report.approved_at)
        self.assertEqual(report.approved_by, self.em)
        self.assertEqual(shipment.tasks.get(title_key='tasks.approve_sales_report').state, TaskState.DONE)
        self.assertEqual(resp.data['sales_report']['approved_by_name'], 'sra_em')

    def test_boss_may_approve_sales_rep_may_not(self):
        shipment = self._sold('SRA-2')
        self.assertEqual(self._approve(self.rep, shipment).status_code, 403)
        self.assertEqual(self._approve(self.boss, shipment).status_code, 200)

    def test_approving_twice_keeps_the_first_approval(self):
        shipment = self._sold('SRA-3')
        self._approve(self.em, shipment)
        first = SalesReport.objects.get(shipment=shipment).approved_at
        self.assertEqual(self._approve(self.boss, shipment).status_code, 200)
        report = SalesReport.objects.get(shipment=shipment)
        self.assertEqual((report.approved_at, report.approved_by), (first, self.em))

    def test_approval_waits_for_the_report(self):
        """E2E 2026-10-01: the truck reached satyldy before the rep sent the
        report, and the export manager got an «approve» card with nothing to
        approve. Item 37 follows 36 — the card comes once the report is in."""
        shipment = Shipment.objects.create(
            shipment_code='SRA-5', date='2026-01-01', season=self.season,
            status=ShipmentStatusType.objects.get(code='yola_chykdy'),
            created_by=self.rep, updated_by=self.rep,
        )
        generate_tasks_for_status(shipment, 'yola_chykdy')          # «Hasabat doldur» opens
        # Test shortcut past the transit steps (not under test here).
        Shipment.objects.filter(pk=shipment.pk).update(status=ShipmentStatusType.objects.get(code='satyldy'))
        shipment.refresh_from_db()
        generate_tasks_for_status(shipment, 'satyldy')
        self.assertFalse(shipment.tasks.filter(title_key='tasks.approve_sales_report').exists())

        client = APIClient()
        client.force_authenticate(self.rep)
        resp = client.post(f'/api/v1/export/shipments/{shipment.id}/sales-report/', {'currency': 'KZT'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.content)
        self.assertEqual(shipment.tasks.get(title_key='tasks.submit_sales_report').state, TaskState.DONE)
        self.assertEqual(shipment.tasks.get(title_key='tasks.approve_sales_report').state, TaskState.OPEN)

    def test_a_report_sent_in_transit_gets_its_approval_on_satyldy_entry(self):
        """The common path: the rep fills the report mid-transit, so «Hasabat
        doldur» is done long before satyldy. Entering satyldy must then create
        the approve card at once — else E3 holds the step with no card."""
        from apps.export.services import transition_to

        shipment = Shipment.objects.create(
            shipment_code='SRA-6', date='2026-01-01', season=self.season,
            status=ShipmentStatusType.objects.get(code='yola_chykdy'),
            created_by=self.rep, updated_by=self.rep,
        )
        generate_tasks_for_status(shipment, 'yola_chykdy')
        client = APIClient()
        client.force_authenticate(self.rep)
        resp = client.post(f'/api/v1/export/shipments/{shipment.id}/sales-report/', {'currency': 'KZT'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.content)
        self.assertFalse(shipment.tasks.filter(title_key='tasks.approve_sales_report').exists())

        # Test shortcut past the transit steps; the satyldy entry itself is real.
        Shipment.objects.filter(pk=shipment.pk).update(status=ShipmentStatusType.objects.get(code='satylyar'))
        shipment.refresh_from_db()
        transition_to(shipment, 'satyldy', self.em, is_auto=True)
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'satyldy')
        self.assertEqual(shipment.tasks.get(title_key='tasks.approve_sales_report').state, TaskState.OPEN)

    def test_no_report_nothing_to_approve(self):
        shipment = self._sold('SRA-4', with_report=False)
        self.assertEqual(self._approve(self.em, shipment).status_code, 400)
