"""Tests for the Sheet's role-block grouping data: migration 0063's backfill
and the who-key → role table it depends on.

Two concerns, one feature:

1. ``SheetRowRoleGroupBackfillTests`` — migration
   ``0063_sheet_row_role_group`` adds ``SheetRowSetting.role_group`` and
   backfills it from ``default_who_key``. The forward path is update-only and
   idempotent; the reverse is NOT a true inverse (see the test that pins it).

2. ``WhoKeyRoleMapDriftTests`` — the who-key → role table now exists in three
   hand-synced copies:

       * ``backfill_sheet_row_defaults.WHO_TO_ROLE``      (backend, live)
       * ``sheetRoleBlocks.ts:WHO_KEY_ROLE``              (frontend, live)
       * ``0063_sheet_row_role_group._WHO_SLUG_TO_ROLE``  (frozen in history)

   The first two must agree — a row grouped under one role on the backend and
   another on the frontend is exactly the drift that produced both August 2026
   Sheet-permission incidents. The migration's copy is deliberately excluded:
   a migration records what was true when it ran and must not follow the org
   chart, so asserting on it would force a rewrite of applied history.

Run with:
    python manage.py test apps.export.tests_sheet_row_role_group --verbosity=2
"""
from __future__ import annotations

import importlib
import re
from pathlib import Path

from django.apps import apps as django_apps
from django.conf import settings
from django.test import TestCase

from apps.export.management.commands.backfill_sheet_row_defaults import WHO_TO_ROLE
from apps.export.models import SheetRowSetting
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

_MIGRATION = importlib.import_module(
    'apps.export.migrations.0063_sheet_row_role_group'
)

# frontend/src/components/sheet/sheetRoleBlocks.ts — BASE_DIR is backend/.
_TS_PATH = (
    Path(settings.BASE_DIR).parent
    / 'frontend' / 'src' / 'components' / 'sheet' / 'sheetRoleBlocks.ts'
)


def _make_setting(field_key: str, **kwargs) -> SheetRowSetting:
    """Minimal SheetRowSetting — the backfill only reads field_key/role_group."""
    defaults = {
        'row_number': kwargs.pop('row_number', 1),
        'display_order': kwargs.pop('display_order', 1024),
    }
    return SheetRowSetting.objects.create(field_key=field_key, **defaults, **kwargs)


class SheetRowRoleGroupBackfillTests(TestCase):
    """migration 0063 RunPython pair, called directly against the real registry."""

    def _backfill(self):
        _MIGRATION.backfill_role_group(django_apps, None)

    def _reverse(self):
        _MIGRATION.clear_role_group(django_apps, None)

    def setUp(self):
        SheetRowSetting.objects.all().delete()

    def test_backfill_maps_every_default_row_to_its_owning_role(self):
        """Each provisioned default row gets the role its default_who_key names.

        Walks the whole DEFAULT_SHEET_ROWS list rather than spot-checking one
        row, so a who-key added to sheet_rows.py without a matching entry in
        the migration's table shows up here as a blank role_group.
        """
        for i, row in enumerate(DEFAULT_SHEET_ROWS):
            _make_setting(row['field_key'], row_number=i + 1, display_order=(i + 1) * 1024)

        self._backfill()

        by_key = {s.field_key: s.role_group for s in SheetRowSetting.objects.all()}
        mismatches = []
        for row in DEFAULT_SHEET_ROWS:
            who_slug = row['default_who_key'].rsplit('.', 1)[-1]
            expected = _MIGRATION._WHO_SLUG_TO_ROLE.get(who_slug, '')
            actual = by_key[row['field_key']]
            if actual != expected:
                mismatches.append(
                    f"{row['field_key']}: role_group={actual!r}, "
                    f"expected {expected!r} (who={row['default_who_key']!r})"
                )
        self.assertEqual(mismatches, [], 'Backfilled role_group is wrong:\n' + '\n'.join(mismatches))

    def test_backfill_leaves_a_custom_row_blank(self):
        """A custom row has no DEFAULT_SHEET_ROWS entry, so the backfill has no
        who-key to resolve and must leave it alone — an admin placing it in a
        block is the only thing that may set its role_group."""
        _make_setting('custom_seal_note', row_number=100, is_custom=True,
                      label_en='Seal note')

        self._backfill()

        self.assertEqual(
            SheetRowSetting.objects.get(field_key='custom_seal_note').role_group, ''
        )

    def test_backfill_never_creates_rows(self):
        """Provisioning SheetRowSetting rows is backfill_sheet_row_defaults's
        job. 0063 is update-only — on an empty table it must be a no-op."""
        self._backfill()
        self.assertEqual(SheetRowSetting.objects.count(), 0)

    def test_backfill_leaves_an_existing_value_untouched(self):
        """Idempotency + admin-config safety: a row that already carries a
        role_group is filtered out by `role_group=''` and must not be reset to
        the default mapping on a re-run."""
        row = DEFAULT_SHEET_ROWS[0]
        _make_setting(row['field_key'], role_group='finansist')

        self._backfill()

        self.assertEqual(
            SheetRowSetting.objects.get(field_key=row['field_key']).role_group,
            'finansist',
        )

    def test_backfill_is_idempotent(self):
        """Second run changes nothing — the first run's writes are no longer
        blank, so they are filtered out."""
        for i, row in enumerate(DEFAULT_SHEET_ROWS[:5]):
            _make_setting(row['field_key'], row_number=i + 1, display_order=(i + 1) * 1024)

        self._backfill()
        first = {s.field_key: s.role_group for s in SheetRowSetting.objects.all()}
        self._backfill()
        second = {s.field_key: s.role_group for s in SheetRowSetting.objects.all()}

        self.assertEqual(first, second)

    def test_reverse_clears_what_the_backfill_wrote(self):
        """The intended half of the reverse: rolling 0063 back returns the
        default rows to blank."""
        for i, row in enumerate(DEFAULT_SHEET_ROWS[:5]):
            _make_setting(row['field_key'], row_number=i + 1, display_order=(i + 1) * 1024)
        self._backfill()

        self._reverse()

        # set(), not .distinct() — SheetRowSetting.Meta.ordering puts the sort
        # column in the SELECT list, so DISTINCT dedupes on (role_group, order).
        self.assertEqual(
            set(SheetRowSetting.objects.values_list('role_group', flat=True)),
            {''},
        )

    def test_reverse_also_blanks_an_admin_set_override(self):
        """DEFECT PIN — documented in docs/QA_COVERAGE_2026-08-27.md §4.

        `clear_role_group` filters on `role_group__in=<every seeded role>`, so
        it cannot tell a value it wrote from one an admin chose. A custom row
        an admin deliberately placed in the `transport` block is blanked by a
        rollback of 0063, and a re-apply then backfills nothing over it (custom
        rows aren't in DEFAULT_SHEET_ROWS) — the placement is simply lost.

        This test asserts what the code does TODAY so the behaviour is visible
        rather than silent. When the reverse is narrowed to "only rows whose
        role_group still equals their own default mapping, never is_custom
        rows", this test must be inverted to assert the override survives.
        """
        _make_setting('custom_admin_note', row_number=100, is_custom=True,
                      role_group='transport', label_en='Admin note')

        self._reverse()

        self.assertEqual(
            SheetRowSetting.objects.get(field_key='custom_admin_note').role_group,
            '',
            'reverse no longer blanks admin overrides — narrow this test to the fixed behaviour',
        )


class WhoKeyRoleMapDriftTests(TestCase):
    """The backend and frontend who-key → role tables must stay identical.

    Pure-Python/text comparison — no DB, no HTTP. Fails the moment one copy is
    edited without the other, which is the cheapest guard available against the
    failure mode behind both August 2026 Sheet-permission incidents.
    """

    @staticmethod
    def _parse_frontend_map() -> dict[str, str]:
        text = _TS_PATH.read_text(encoding='utf-8')
        block = re.search(
            r'export const WHO_KEY_ROLE[^{]*\{(.*?)\n\};', text, re.DOTALL
        )
        assert block is not None, (
            f'WHO_KEY_ROLE literal not found in {_TS_PATH} — the constant was '
            f'renamed or reshaped; update this parser.'
        )
        body = re.sub(r'//[^\n]*', '', block.group(1))  # drop line comments
        return dict(re.findall(r"'([^']+)'\s*:\s*'([^']+)'", body))

    def setUp(self):
        if not _TS_PATH.parent.exists():
            self.skipTest(f'frontend checkout absent at {_TS_PATH.parent}')

    def test_frontend_map_parses(self):
        """Guards the parser itself — a silently-empty parse would make every
        other assertion in this class vacuous."""
        parsed = self._parse_frontend_map()
        self.assertGreater(len(parsed), 5, f'suspiciously small WHO_KEY_ROLE: {parsed}')
        for who_key, role in parsed.items():
            self.assertTrue(who_key.startswith('sheet.who.'), who_key)
            self.assertTrue(role, who_key)

    def test_backend_and_frontend_cover_the_same_who_keys(self):
        frontend = set(self._parse_frontend_map())
        backend = {f'sheet.who.{slug}' for slug in WHO_TO_ROLE}
        self.assertEqual(
            frontend, backend,
            'WHO_KEY_ROLE (sheetRoleBlocks.ts) and WHO_TO_ROLE '
            '(backfill_sheet_row_defaults.py) name different who-keys.\n'
            f'  frontend only: {sorted(frontend - backend)}\n'
            f'  backend only:  {sorted(backend - frontend)}',
        )

    def test_backend_and_frontend_agree_on_every_role(self):
        """WHO_TO_ROLE values are lists (a who-key may grant several roles edit
        access); WHO_KEY_ROLE is a single role because a row renders in exactly
        one block. The frontend's choice must be one of the backend's roles."""
        frontend = self._parse_frontend_map()
        mismatches = []
        for who_key, fe_role in frontend.items():
            be_roles = WHO_TO_ROLE.get(who_key.removeprefix('sheet.who.'), [])
            if fe_role not in be_roles:
                mismatches.append(f'{who_key}: frontend={fe_role!r}, backend={be_roles}')
        self.assertEqual(
            mismatches, [],
            'who-key → role drift between sheetRoleBlocks.ts and '
            'backfill_sheet_row_defaults.py:\n' + '\n'.join(mismatches),
        )

    def test_every_frontend_role_is_a_real_role_code(self):
        """A typo'd role code groups rows under a block no user can ever be in."""
        from apps.core.models.user import ROLE_CHOICES

        valid = {code for code, _label in ROLE_CHOICES}
        unknown = {r for r in self._parse_frontend_map().values() if r not in valid}
        self.assertEqual(unknown, set(), f'not in ROLE_CHOICES: {sorted(unknown)}')

    def test_every_sheet_row_who_key_is_mapped(self):
        """The other direction: a row added to sheet_rows.py with a who-key
        absent from WHO_KEY_ROLE renders outside every role block and silently
        disables banding for it — no error, just a row floating loose."""
        mapped = set(self._parse_frontend_map())
        used = {r['default_who_key'] for r in DEFAULT_SHEET_ROWS}
        self.assertEqual(
            used - mapped, set(),
            f'DEFAULT_SHEET_ROWS uses who-keys WHO_KEY_ROLE does not map: '
            f'{sorted(used - mapped)}',
        )

    def test_no_new_dead_who_key_mappings(self):
        """A mapping for a who-key no row uses is dead weight that outlives the
        person it was named after.

        `sheet.who.malik` is already dead: R4 was repurposed from Malik's
        "Goşmaça bellik" (Shipment.notes) to Şirin's `transport_docs_given_at`
        (see sheet_rows.py R4), and no other row names him. Kept in both maps
        deliberately — the copies must stay identical, and dropping a key from
        one of them is exactly the drift this class exists to catch. Listed
        here so a NEW dead entry still fails.
        """
        known_dead = {'sheet.who.malik'}
        used = {r['default_who_key'] for r in DEFAULT_SHEET_ROWS}
        mapped = set(self._parse_frontend_map())
        self.assertEqual(
            mapped - used - known_dead, set(),
            f'WHO_KEY_ROLE maps who-keys no DEFAULT_SHEET_ROWS row uses: '
            f'{sorted(mapped - used - known_dead)}',
        )
        self.assertTrue(
            known_dead <= mapped,
            f'{sorted(known_dead - mapped)} is no longer mapped — drop it from '
            f'known_dead here, and from WHO_TO_ROLE/WHO_KEY_ROLE together.',
        )
