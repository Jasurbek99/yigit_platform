"""Local sell plan — the cell lock and the autosave/auto-submit path.

Two owner reports from 2026-08-23 (docs/IDEAS.md #3 and #4):

  #3  "Once the local sell plan is approved it is still editable by
       export_manager / document_team. Needs to be locked after approve."
  #4  "Make local sell work the same way as the weekly plan: after the week is
       submitted it should still be possible to fill in the empty fields. Also,
       save on edit — no separate send button."

Which turns PATCH into the only write path that matters, and gives it three
rules — all enforced in `WeeklyLocalSellPlanViewSet.perform_update` on top of
`WeeklyLocalSellPlan.locked_day_fields()`:

  1. approved  → every field locked, for EVERY role including admin (409).
  2. submitted → a writer may still fill a day that is 0; a day that already
                 holds a value is locked to them (409) and stays overridable by
                 an approver.
  3. draft/rejected → the first save carrying a positive day submits the week,
                 so the removed Send button is not needed.

The frontend mirror of rule 2 lives in
`frontend/src/pages/export/LocalSellPlanGrid.cells.ts`; its truth table must
stay byte-for-byte identical to `locked_day_fields()` or cells render editable
and then 409 on blur.
"""
import unittest
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

try:
    from apps.core.models import ExportFirm, Season, User
    from apps.export.models import AuditLog, WeeklyLocalSellPlan
    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


YEAR = 2097
WEEK = 11


def _make_user(username: str, role: str, is_superuser: bool = False) -> "User":
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class LocalSellPlanLockTests(TestCase):
    """PATCH /api/v1/export/local-sell-plans/{pk}/ — locks and auto-submit."""

    @classmethod
    def setUpTestData(cls):
        cls.season, _ = Season.objects.get_or_create(
            name='lsl-lock',
            defaults={'start_date': '2096-09-01', 'end_date': '2097-06-30', 'is_active': True},
        )
        cls.firm, _ = ExportFirm.objects.get_or_create(
            code='LSL-A', defaults={'name_tk': 'Firma Lock', 'is_active': True},
        )
        cls.other_firm, _ = ExportFirm.objects.get_or_create(
            code='LSL-B', defaults={'name_tk': 'Firma Lock B', 'is_active': True},
        )
        # is_superuser clears the DB-seeded DynamicResourcePermission layer only.
        # Every gate under test is a plain `role in ...` comparison with no
        # superuser bypass, so these users still exercise the real rules.
        cls.seller = _make_user('lsl_seller', 'seller', is_superuser=True)
        cls.manager = _make_user('lsl_mgr', 'export_manager', is_superuser=True)
        cls.admin = _make_user('lsl_admin', 'admin', is_superuser=True)

    def setUp(self):
        WeeklyLocalSellPlan.objects.filter(year=YEAR, week_number=WEEK).delete()

    # --- helpers ---------------------------------------------------------

    def _row(self, status='draft', monday=0, tuesday=0, firm=None):
        return WeeklyLocalSellPlan.objects.create(
            export_firm=firm or self.firm, year=YEAR, week_number=WEEK,
            season=self.season, status=status,
            monday_plan_kg=Decimal(str(monday)),
            tuesday_plan_kg=Decimal(str(tuesday)),
        )

    def _patch(self, user, row, payload):
        client = APIClient()
        client.force_authenticate(user)
        return client.patch(
            f'/api/v1/export/local-sell-plans/{row.id}/', payload, format='json',
        )

    def _url(self):
        return '/api/v1/export/local-sell-plans/'

    # --- Rule 1: approved is locked for everyone (idea #3) ---------------

    def test_approved_plan_rejects_patch_from_export_manager(self):
        """The exact defect in idea #3 — this used to be a 200."""
        row = self._row(status='approved', monday=500)
        resp = self._patch(self.manager, row, {'monday_plan_kg': '900.00'})
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(resp.json()['error'], 'plan_approved_locked')
        row.refresh_from_db()
        self.assertEqual(row.monday_plan_kg, Decimal('500.00'))

    def test_approved_plan_rejects_patch_from_admin(self):
        """Spec says everyone. admin is the one role that might plausibly have
        been exempted, and deliberately was not."""
        row = self._row(status='approved', monday=500)
        resp = self._patch(self.admin, row, {'monday_plan_kg': '900.00'})
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(resp.json()['error'], 'plan_approved_locked')
        row.refresh_from_db()
        self.assertEqual(row.monday_plan_kg, Decimal('500.00'))

    def test_approved_plan_rejects_patch_from_seller(self):
        """Regression guard on the `not is_admin` branch that was deleted."""
        row = self._row(status='approved', monday=500)
        resp = self._patch(self.seller, row, {'monday_plan_kg': '900.00'})
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(resp.json()['error'], 'plan_approved_locked')
        row.refresh_from_db()
        self.assertEqual(row.monday_plan_kg, Decimal('500.00'))

    def test_approved_plan_rejects_patch_of_a_non_day_field(self):
        """The approved check runs before any field comparison, so re-pointing
        the row at another firm is refused too."""
        row = self._row(status='approved', monday=500)
        resp = self._patch(self.manager, row, {'export_firm': self.other_firm.id})
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(resp.json()['error'], 'plan_approved_locked')
        row.refresh_from_db()
        self.assertEqual(row.export_firm_id, self.firm.id)

    def test_approved_lock_names_the_week_in_its_message(self):
        """A bare 409 tells the operator nothing. The body must say which week."""
        row = self._row(status='approved', monday=500)
        resp = self._patch(self.manager, row, {'monday_plan_kg': '900.00'})
        self.assertIn(f'W{WEEK}/{YEAR}', resp.json()['message'])

    # --- Rule 2: submitted = fill-empties only (idea #4) -----------------

    def test_submitted_plan_lets_the_seller_fill_an_empty_day(self):
        """Idea #4's core case: the week is out for approval but Tuesday was
        never filled, so the seller can still fill it."""
        row = self._row(status='submitted', monday=500, tuesday=0)
        resp = self._patch(self.seller, row, {'tuesday_plan_kg': '300.00'})
        self.assertEqual(resp.status_code, 200, resp.content)
        row.refresh_from_db()
        self.assertEqual(row.tuesday_plan_kg, Decimal('300.00'))
        self.assertEqual(row.status, 'submitted')

    def test_submitted_plan_locks_a_day_that_already_holds_a_value(self):
        row = self._row(status='submitted', monday=500)
        resp = self._patch(self.seller, row, {'monday_plan_kg': '900.00'})
        self.assertEqual(resp.status_code, 409, resp.content)
        body = resp.json()
        self.assertEqual(body['error'], 'cell_locked_after_submit')
        self.assertEqual(body['fields'], ['monday_plan_kg'])
        row.refresh_from_db()
        self.assertEqual(row.monday_plan_kg, Decimal('500.00'))

    def test_submitted_plan_rejects_the_whole_patch_if_any_day_is_locked(self):
        """One locked field poisons the request — no partial write."""
        row = self._row(status='submitted', monday=500, tuesday=0)
        resp = self._patch(
            self.seller, row,
            {'monday_plan_kg': '900.00', 'tuesday_plan_kg': '300.00'},
        )
        self.assertEqual(resp.status_code, 409, resp.content)
        row.refresh_from_db()
        self.assertEqual(row.monday_plan_kg, Decimal('500.00'))
        self.assertEqual(row.tuesday_plan_kg, Decimal('0.00'))

    def test_submitted_plan_still_lets_an_approver_overwrite_a_filled_day(self):
        """The grid's double-click override path must survive."""
        row = self._row(status='submitted', monday=500)
        resp = self._patch(self.manager, row, {'monday_plan_kg': '900.00'})
        self.assertEqual(resp.status_code, 200, resp.content)
        row.refresh_from_db()
        self.assertEqual(row.monday_plan_kg, Decimal('900.00'))
        self.assertTrue(
            AuditLog.objects.filter(
                action='local_sell_edit', model_name='WeeklyLocalSellPlan',
                object_id=row.id,
            ).exists()
        )

    def test_fill_empties_by_a_seller_is_audited(self):
        """The audit branch used to be `is_admin and ...`; a seller filling an
        empty day on a submitted week is just as much a post-send change."""
        row = self._row(status='submitted', monday=500, tuesday=0)
        resp = self._patch(self.seller, row, {'tuesday_plan_kg': '300.00'})
        self.assertEqual(resp.status_code, 200, resp.content)
        entry = AuditLog.objects.filter(
            action='local_sell_edit', object_id=row.id, user=self.seller,
        ).first()
        self.assertIsNotNone(entry)
        self.assertIn('tuesday_plan_kg', entry.detail)

    # --- Rule 3: autosave submits the week (idea #4, no Send button) -----

    def test_first_save_on_a_draft_auto_submits(self):
        row = self._row(status='draft', monday=0)
        resp = self._patch(self.seller, row, {'monday_plan_kg': '500.00'})
        self.assertEqual(resp.status_code, 200, resp.content)
        # The response body is what flips the grid's cell to locked — assert it,
        # not just the DB.
        self.assertEqual(resp.json()['status'], 'submitted')
        row.refresh_from_db()
        self.assertEqual(row.status, 'submitted')
        self.assertEqual(row.submitted_by_id, self.seller.id)
        self.assertIsNotNone(row.submitted_at)
        self.assertTrue(
            AuditLog.objects.filter(
                action='local_sell_submitted', object_id=row.id,
            ).exists()
        )

    def test_all_zero_save_leaves_the_plan_in_draft(self):
        """`submit_local_sell_plan` raises without a positive day; an all-zero
        week ("nothing to sell") must stay a draft, not 500."""
        row = self._row(status='draft', monday=0)
        resp = self._patch(self.seller, row, {'monday_plan_kg': '0.00'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['status'], 'draft')
        row.refresh_from_db()
        self.assertEqual(row.status, 'draft')

    def test_editing_a_rejected_plan_resubmits_and_clears_the_rejection(self):
        row = self._row(status='rejected', monday=100)
        row.rejection_note = 'too low'
        row.save(update_fields=['rejection_note'])
        resp = self._patch(self.seller, row, {'monday_plan_kg': '700.00'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['status'], 'submitted')
        row.refresh_from_db()
        self.assertEqual(row.status, 'submitted')
        self.assertIsNone(row.rejected_at)
        self.assertIsNone(row.rejected_by_id)
        self.assertIn(row.rejection_note, (None, ''))

    def test_a_filled_draft_day_is_editable_and_the_edit_submits_the_week(self):
        """The lock starts at `submitted`, so a filled DRAFT day is not locked —
        but that same save also auto-submits, which is what makes the first
        value a seller types the last one they can change themselves."""
        row = self._row(status='draft', monday=100)
        resp = self._patch(self.seller, row, {'monday_plan_kg': '250.00'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['status'], 'submitted')
        row.refresh_from_db()
        self.assertEqual(row.monday_plan_kg, Decimal('250.00'))
        # ...and it is now locked to them.
        again = self._patch(self.seller, row, {'monday_plan_kg': '300.00'})
        self.assertEqual(again.status_code, 409, again.content)

    # --- Rule 4 (spec d): approve stays APPROVE-only ---------------------

    def test_approve_still_works_for_an_approver(self):
        row = self._row(status='submitted', monday=500)
        client = APIClient()
        client.force_authenticate(self.manager)
        resp = client.post(f'{self._url()}{row.id}/approve/')
        self.assertEqual(resp.status_code, 200, resp.content)
        row.refresh_from_db()
        self.assertEqual(row.status, 'approved')

    def test_bulk_approve_still_works_and_stays_approve_only(self):
        row = self._row(status='submitted', monday=500)
        client = APIClient()
        client.force_authenticate(self.manager)
        resp = client.post(
            f'{self._url()}bulk-approve/', {'ids': [row.id]}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['approved'], [row.id])

        seller_client = APIClient()
        seller_client.force_authenticate(self.seller)
        denied = seller_client.post(
            f'{self._url()}bulk-approve/', {'ids': [row.id]}, format='json',
        )
        self.assertEqual(denied.status_code, 403, denied.content)

    def test_reject_still_works_and_the_row_becomes_editable_again(self):
        row = self._row(status='submitted', monday=500)
        client = APIClient()
        client.force_authenticate(self.manager)
        resp = client.post(
            f'{self._url()}{row.id}/reject/', {'rejection_note': 'too low'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        row.refresh_from_db()
        self.assertEqual(row.status, 'rejected')
        # And the seller can now touch the filled day again.
        edit = self._patch(self.seller, row, {'monday_plan_kg': '650.00'})
        self.assertEqual(edit.status_code, 200, edit.content)


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class LockedDayFieldsUnitTests(TestCase):
    """`locked_day_fields()` in isolation — the rule the grid mirrors."""

    def _plan(self, status, monday=0, tuesday=0):
        return WeeklyLocalSellPlan(
            status=status,
            monday_plan_kg=Decimal(str(monday)),
            tuesday_plan_kg=Decimal(str(tuesday)),
        )

    def test_draft_locks_nothing(self):
        self.assertEqual(
            self._plan('draft', monday=500).locked_day_fields(is_approver=False), ()
        )

    def test_rejected_locks_nothing(self):
        self.assertEqual(
            self._plan('rejected', monday=500).locked_day_fields(is_approver=False), ()
        )

    def test_submitted_locks_only_the_filled_days_for_a_writer(self):
        self.assertEqual(
            self._plan('submitted', monday=500, tuesday=0).locked_day_fields(
                is_approver=False),
            ('monday_plan_kg',),
        )

    def test_submitted_locks_nothing_for_an_approver(self):
        self.assertEqual(
            self._plan('submitted', monday=500).locked_day_fields(is_approver=True), ()
        )

    def test_approved_locks_every_day_for_an_approver_too(self):
        locked = self._plan('approved', monday=500).locked_day_fields(is_approver=True)
        self.assertEqual(len(locked), 6)
        self.assertIn('saturday_plan_kg', locked)
