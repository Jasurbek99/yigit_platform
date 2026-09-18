"""Approve / reject in-week plan revisions, and admin direct-edit baseline reset (ADR-024).

Usage:
    python manage.py test apps.greenhouse.tests.test_plan_change_decisions --verbosity=2
"""
from decimal import Decimal

from django.test import TestCase

from apps.export.models import AuditLog, Notification
from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.services.harvest_day_service import set_plan_value
from apps.greenhouse.services.plan_change_service import (
    approve_plan_change, reject_plan_change, request_plan_change,
)
from apps.greenhouse.tests.plan_change_fixtures import (
    AFTER_WEEK_UTC, BEFORE_WEEK_UTC, IN_WEEK_UTC, build_world, frozen_now, make_entry,
)


class TestApprove(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCD')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']

    def _pending(self, weekday=0, plan_value=Decimal('10000'), requested=Decimal('11000'), plan_state='on_time'):
        entry = make_entry(self.w, weekday=weekday, plan_value=plan_value, plan_state=plan_state)
        return entry, request_plan_change(entry, requested, self.gm)

    def test_export_manager_approval_writes_the_value_and_audits(self):
        entry, change = self._pending()
        approve_plan_change(change, self.w.users['export_manager'], 'ok')
        entry.refresh_from_db()
        change.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('11000'))
        self.assertEqual(entry.plan_submitted_by, self.gm)  # the requester authored the value
        self.assertEqual(change.status, PlanChangeRequest.STATUS_APPROVED)
        self.assertEqual(change.decided_by, self.w.users['export_manager'])
        self.assertEqual(change.decision_note, 'ok')
        self.assertTrue(AuditLog.objects.filter(
            model_name='HarvestDayEntry', object_id=str(entry.id),
            action='plan_value_set', detail__contains='APPROVED',
        ).exists())
        self.assertTrue(Notification.objects.filter(user=self.gm, kind='plan_change_approved').exists())

    def test_admin_and_boss_can_approve(self):
        for weekday, role in enumerate(('admin', 'boss')):
            with self.subTest(role=role):
                entry, change = self._pending(weekday=weekday)
                approve_plan_change(change, self.w.users[role])
                entry.refresh_from_db()
                self.assertEqual(entry.plan_value, Decimal('11000'))

    def test_other_roles_cannot_decide(self):
        for weekday, role in enumerate(('greenhouse_manager', 'director', 'document_team')):
            with self.subTest(role=role):
                _, change = self._pending(weekday=weekday)
                with self.assertRaises(PermissionError):
                    approve_plan_change(change, self.w.users[role])
                with self.assertRaises(PermissionError):
                    reject_plan_change(change, self.w.users[role])
                change.refresh_from_db()
                self.assertEqual(change.status, PlanChangeRequest.STATUS_PENDING)

    def test_a_decided_request_cannot_be_decided_again(self):
        _, change = self._pending()
        approve_plan_change(change, self.w.users['export_manager'])
        with self.assertRaises(ValueError):
            approve_plan_change(change, self.w.users['export_manager'])
        with self.assertRaises(ValueError):
            reject_plan_change(change, self.w.users['export_manager'])

    def test_an_over_long_note_is_refused_and_the_request_stays_pending(self):
        """F7: validated before the claiming UPDATE — reject has no atomic block around it."""
        for weekday, decide in enumerate((approve_plan_change, reject_plan_change)):
            with self.subTest(decide=decide.__name__):
                _, change = self._pending(weekday=weekday)
                with self.assertRaises(ValueError):
                    decide(change, self.w.users['export_manager'], 'x' * 501)
                change.refresh_from_db()
                self.assertEqual(change.status, PlanChangeRequest.STATUS_PENDING)

    def test_approving_an_empty_cell_computes_its_plan_state(self):
        entry, change = self._pending(plan_value=None, requested=Decimal('7000'), plan_state='')
        approve_plan_change(change, self.w.users['export_manager'])
        entry.refresh_from_db()
        # requested_at defaults to the real clock, which is always past W24's
        # Monday 00:00 (the critical-late moment) — hence critical_late.
        self.assertEqual(entry.plan_state, 'critical_late')

    def test_deciding_is_not_time_gated(self):
        """Spec rule 10: a request can be approved after its week has ended."""
        entry, change = self._pending()
        with frozen_now(AFTER_WEEK_UTC):
            approve_plan_change(change, self.w.users['export_manager'])
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('11000'))

    def test_approving_a_revision_keeps_the_original_plan_state(self):
        entry, change = self._pending(plan_state='on_time')
        approve_plan_change(change, self.w.users['export_manager'])
        entry.refresh_from_db()
        self.assertEqual(entry.plan_state, 'on_time')


class TestReject(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCJ')

    def test_reject_leaves_the_value_and_notifies(self):
        gm = self.w.users['greenhouse_manager']
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), gm)
        reject_plan_change(change, self.w.users['export_manager'], 'too high')
        entry.refresh_from_db()
        change.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('10000'))
        self.assertEqual(change.status, PlanChangeRequest.STATUS_REJECTED)
        self.assertEqual(change.decision_note, 'too high')
        note = Notification.objects.get(user=gm, kind='plan_change_rejected')
        self.assertIn('too high', note.message)


class TestAdminDirectEdit(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCA')

    def test_in_week_admin_edit_resets_baseline_and_supersedes_pending(self):
        gm, admin = self.w.users['greenhouse_manager'], self.w.users['admin']
        entry = make_entry(self.w, plan_value=Decimal('10000'), baseline=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), gm)
        with frozen_now(IN_WEEK_UTC):
            set_plan_value(entry, Decimal('20000'), admin, reason='harvest moved')
        entry.refresh_from_db()
        change.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('20000'))
        self.assertEqual(entry.plan_baseline_value, Decimal('20000'))
        self.assertEqual(change.status, PlanChangeRequest.STATUS_SUPERSEDED)
        self.assertEqual(change.decided_by, admin)

    def test_in_week_admin_zero_does_not_freeze_a_zero_baseline(self):
        """Rule 2: a 0 baseline would leave the cell unbounded all week — store NULL."""
        entry = make_entry(self.w, plan_value=Decimal('10000'), baseline=Decimal('10000'))
        with frozen_now(IN_WEEK_UTC):
            set_plan_value(entry, Decimal('0'), self.w.users['admin'], reason='hail')
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('0'))
        self.assertIsNone(entry.plan_baseline_value)

    def test_admin_edit_before_week_start_leaves_baseline_alone(self):
        entry = make_entry(self.w, plan_value=None)
        with frozen_now(BEFORE_WEEK_UTC):
            set_plan_value(entry, Decimal('9000'), self.w.users['admin'])
        entry.refresh_from_db()
        self.assertIsNone(entry.plan_baseline_value)
