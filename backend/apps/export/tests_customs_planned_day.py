"""Tests for the customs_clearance_planned_day field added in Stream A2.

Covers:
- Field persists to DB and round-trips correctly
- Field is present in _ALL_PATCHABLE_FIELDS
- DEFAULT_SHEET_ROWS contains an entry for the field
"""
from django.test import TestCase

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment
from apps.export.serializers import _ALL_PATCHABLE_FIELDS
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS


def _get_or_create_shipment() -> Shipment:
    """Create minimal valid Shipment for field tests.

    Uses get_or_create so the suite is safe to run alongside other tests
    that share the same test DB state.
    Season name is <=10 chars to satisfy core.Season.name max_length=10.
    """
    season, _ = Season.objects.get_or_create(
        name='A2-test',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': False},
    )
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='yuklenme',
        defaults={'name_tk': 'yuklenme', 'name_en': 'Loading', 'step_order': 1, 'phase': 'LOADING'},
    )
    shipment, _ = Shipment.objects.get_or_create(
        cargo_code='A2TEST01',
        defaults={'date': '2026-01-15', 'season': season, 'status': status},
    )
    return shipment


class CustomsClearancePlannedDayFieldTests(TestCase):
    """Verify the customs_clearance_planned_day model field behaviour."""

    def test_field_persists_valid_choice(self) -> None:
        """Setting 'wed' saves to DB and comes back unchanged."""
        shipment = _get_or_create_shipment()
        shipment.customs_clearance_planned_day = 'wed'
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.customs_clearance_planned_day, 'wed')

    def test_field_default_is_empty_string(self) -> None:
        """Newly created shipments have an empty string, not None."""
        season, _ = Season.objects.get_or_create(
            name='A2-test-b',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': False},
        )
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme',
            defaults={'name_tk': 'yuklenme', 'name_en': 'Loading', 'step_order': 1, 'phase': 'LOADING'},
        )
        fresh = Shipment.objects.create(
            cargo_code='A2TEST02',
            date='2026-01-16',
            season=season,
            status=status,
        )
        fresh.refresh_from_db()
        self.assertEqual(fresh.customs_clearance_planned_day, '')
        self.assertIsNotNone(fresh.customs_clearance_planned_day)
        fresh.delete()

    def test_all_choices_accepted(self) -> None:
        """Every defined weekday choice round-trips without error."""
        shipment = _get_or_create_shipment()
        choices = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        for day in choices:
            shipment.customs_clearance_planned_day = day
            shipment.save()
            shipment.refresh_from_db()
            self.assertEqual(
                shipment.customs_clearance_planned_day, day,
                f"Choice '{day}' did not round-trip correctly",
            )


class CustomsClearancePlannedDaySerializerTests(TestCase):
    """Verify serializer and patchable-fields whitelist include the new field."""

    def test_field_in_patchable_fields(self) -> None:
        """customs_clearance_planned_day must be in _ALL_PATCHABLE_FIELDS."""
        self.assertIn(
            'customs_clearance_planned_day',
            _ALL_PATCHABLE_FIELDS,
            '_ALL_PATCHABLE_FIELDS is missing customs_clearance_planned_day',
        )


class CustomsClearancePlannedDaySheetRowTests(TestCase):
    """Verify DEFAULT_SHEET_ROWS has an entry for the new field."""

    def test_sheet_row_exists(self) -> None:
        """DEFAULT_SHEET_ROWS must contain an entry with field_key='customs_clearance_planned_day'."""
        field_keys = [r['field_key'] for r in DEFAULT_SHEET_ROWS]
        self.assertIn(
            'customs_clearance_planned_day',
            field_keys,
            'DEFAULT_SHEET_ROWS is missing an entry for customs_clearance_planned_day',
        )

    def test_sheet_row_has_correct_owner(self) -> None:
        """The row's owner (default_who_key) must point to Sirin (document_team)."""
        row = next(
            (r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'customs_clearance_planned_day'),
            None,
        )
        self.assertIsNotNone(row, 'Sheet row for customs_clearance_planned_day not found')
        self.assertEqual(
            row['default_who_key'],
            'sheet.who.sirin',
            f"Expected owner 'sheet.who.sirin', got '{row['default_who_key']}'",
        )

    def test_sheet_row_is_dropdown(self) -> None:
        """The row's input_type must be 'dropdown' (weekday choices)."""
        row = next(
            (r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'customs_clearance_planned_day'),
            None,
        )
        self.assertIsNotNone(row)
        self.assertEqual(row['input_type'], 'dropdown')
