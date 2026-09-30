"""Sheet row «Ýyladyşhana geldi» (greenhouse_arrived_at) — spec §1.6 item 4."""
from django.core.management import call_command
from django.test import TestCase

from apps.core.models import User
from apps.core.permissions import can_edit_sheet_field
from apps.export.management.commands.backfill_sheet_row_defaults import WHO_TO_ROLE
from apps.export.serializers import _ALL_PATCHABLE_FIELDS
from apps.export.services.comments import SHEET_FIELD_KEYS
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS


class GreenhouseArrivalRowTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def _row(self) -> dict:
        return next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'greenhouse_arrived_at')

    def test_row_shape(self):
        row = self._row()
        self.assertEqual(row['row_number'], 49)
        self.assertEqual(row['input_type'], 'datetime')
        self.assertEqual(row['default_who_key'], 'sheet.who.garawul')
        self.assertEqual(row['label_key'], 'sheet.row.greenhouse_arrival')
        self.assertFalse(row.get('gapy_hidden', False))  # gapy trucks pass the gate too

    def test_row_sits_right_after_greenhouse_departure(self):
        keys = [r['field_key'] for r in DEFAULT_SHEET_ROWS]
        self.assertEqual(keys.index('greenhouse_arrived_at'), keys.index('departed_at') + 1)

    def test_field_is_patchable_and_commentable(self):
        self.assertIn('greenhouse_arrived_at', _ALL_PATCHABLE_FIELDS)
        self.assertIn('greenhouse_arrived_at', SHEET_FIELD_KEYS)

    def test_loading_roles_edit_it_and_the_guard_does_not(self):
        self.assertEqual(WHO_TO_ROLE['garawul'], ['loading_dept_head', 'loading_dept_head_deputy'])
        for role in ('loading_dept_head', 'loading_dept_head_deputy'):
            with self.subTest(role=role):
                user = User.objects.create_user(username=f'arr_{role}', password='pw', role=role)
                self.assertTrue(can_edit_sheet_field(user, 'greenhouse_arrived_at'))
        guard = User.objects.create_user(username='arr_guard', password='pw', role='garawul')
        self.assertFalse(can_edit_sheet_field(guard, 'greenhouse_arrived_at'))
