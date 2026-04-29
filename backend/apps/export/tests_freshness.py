"""Tests for the freshness / expiration-clock fields on ShipmentListSerializer.

Finding #5b — tomato has a short export window:
  today      → export-grade
  yesterday  → borderline / domestic-grade
  2+ days    → waste risk

These tests use MagicMock stubs so they run without a live MSSQL database.
SimpleTestCase does not create a test DB, which is important because
``manage.py test`` would otherwise try to create an MSSQL schema.
"""

from datetime import date as _date, timedelta
from unittest.mock import MagicMock

from django.test import SimpleTestCase

from apps.export.serializers import ShipmentListSerializer


class FreshnessTest(SimpleTestCase):
    """Validate get_harvest_age_days() and get_freshness() in isolation."""

    def _make_serializer(self) -> ShipmentListSerializer:
        """Return a bare serializer instance (no data, no context needed)."""
        return ShipmentListSerializer()

    # ------------------------------------------------------------------
    # harvest_age_days
    # ------------------------------------------------------------------

    def test_age_today_is_zero(self):
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today())
        self.assertEqual(ser.get_harvest_age_days(mock), 0)

    def test_age_yesterday_is_one(self):
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today() - timedelta(days=1))
        self.assertEqual(ser.get_harvest_age_days(mock), 1)

    def test_age_five_days_ago(self):
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today() - timedelta(days=5))
        self.assertEqual(ser.get_harvest_age_days(mock), 5)

    def test_age_future_date_clamped_to_zero(self):
        """A future date (data-entry error) must not return a negative age."""
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today() + timedelta(days=1))
        self.assertEqual(ser.get_harvest_age_days(mock), 0)

    def test_age_null_date_falls_back_to_today(self):
        """When date is None the method falls back to today, yielding age 0."""
        ser = self._make_serializer()
        mock = MagicMock(date=None)
        self.assertEqual(ser.get_harvest_age_days(mock), 0)

    # ------------------------------------------------------------------
    # freshness label
    # ------------------------------------------------------------------

    def test_freshness_today(self):
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today())
        self.assertEqual(ser.get_freshness(mock), 'today')

    def test_freshness_yesterday(self):
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today() - timedelta(days=1))
        self.assertEqual(ser.get_freshness(mock), 'yesterday')

    def test_freshness_aged_two_days(self):
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today() - timedelta(days=2))
        self.assertEqual(ser.get_freshness(mock), 'aged')

    def test_freshness_aged_five_days(self):
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today() - timedelta(days=5))
        self.assertEqual(ser.get_freshness(mock), 'aged')

    def test_freshness_future_date_is_today(self):
        """Future-dated shipment is clamped → freshness 'today', not an error."""
        ser = self._make_serializer()
        mock = MagicMock(date=_date.today() + timedelta(days=1))
        self.assertEqual(ser.get_freshness(mock), 'today')

    def test_freshness_null_date_is_today(self):
        ser = self._make_serializer()
        mock = MagicMock(date=None)
        self.assertEqual(ser.get_freshness(mock), 'today')
