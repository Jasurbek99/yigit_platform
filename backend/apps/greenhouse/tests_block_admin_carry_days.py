"""Tests for GreenhouseBlockAdminSerializer carry_days field.

Covers:
    1. GET /api/v1/greenhouse/admin/blocks/{id}/ returns carry_days with its value
    2. PATCH /api/v1/greenhouse/admin/blocks/{id}/ sets carry_days to a non-default value (3) and persists

Usage:
    python manage.py test apps.greenhouse.tests_block_admin_carry_days --keepdb --verbosity=2
"""
import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, User, LoadingLocation, TomatoVariety


def _make_user(username: str, role: str) -> User:
    """Create and return a User with the given role."""
    user = User(username=username, role=role)
    user.set_password('testpass123')
    user.save()
    return user


def _make_client(user: User) -> APIClient:
    """Return an APIClient authenticated as user."""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class GreenhouseBlockAdminCarryDaysTests(TestCase):
    """PATCH and GET carry_days on /api/v1/greenhouse/admin/blocks/"""

    def setUp(self):
        self.director = _make_user('carry_days_director', 'director')

        # Create location and variety needed for the block
        self.location = LoadingLocation.objects.create(
            name='Test Location',
        )

        self.variety = TomatoVariety.objects.create(
            name='Test Variety',
        )

        # Create a test block with default carry_days=7
        self.block = GreenhouseBlock.objects.create(
            code='TEST_A',
            name='Test Block A',
            location=self.location,
            variety_main=self.variety,
            area_m2=1000,
            section_count=5,
            sowing_date=datetime.date(2026, 1, 1),
            is_active=True,
            carry_days=7,  # default
        )

    def test_get_block_returns_carry_days(self):
        """GET /api/v1/greenhouse/admin/blocks/{id}/ includes carry_days."""
        client = _make_client(self.director)
        url = f'/api/v1/greenhouse/admin/blocks/{self.block.id}/'

        resp = client.get(url)

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('carry_days', resp.data)
        self.assertEqual(resp.data['carry_days'], 7)

    def test_patch_block_sets_carry_days_and_persists(self):
        """PATCH /api/v1/greenhouse/admin/blocks/{id}/ updates carry_days and persists."""
        client = _make_client(self.director)
        url = f'/api/v1/greenhouse/admin/blocks/{self.block.id}/'

        # PATCH with new carry_days value
        payload = {'carry_days': 3}
        resp = client.patch(url, payload, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['carry_days'], 3)

        # Verify persistence by reading from DB
        self.block.refresh_from_db()
        self.assertEqual(self.block.carry_days, 3)

    def test_patch_rejects_a_wildly_large_carry_days(self):
        """2026-09-25: no upper bound meant one typo'd block (e.g. 3650) sized
        the board's walk window for EVERY block. 3650 is well under
        PositiveSmallIntegerField's own 32767 ceiling, so this must be the
        new validator rejecting it, not the field's own range check."""
        client = _make_client(self.director)
        url = f'/api/v1/greenhouse/admin/blocks/{self.block.id}/'

        resp = client.patch(url, {'carry_days': 3650}, format='json')

        self.assertEqual(resp.status_code, 400, resp.data)
        self.block.refresh_from_db()
        self.assertEqual(self.block.carry_days, 7)

    def test_patch_rejects_zero_carry_days(self):
        """2026-09-25: the frontend's antd rule (min:1) was the only thing
        that blocked 0 — a direct PATCH bypassed it, and 0 would make the
        board's carry-day walk expire the block's stock on arrival."""
        client = _make_client(self.director)
        url = f'/api/v1/greenhouse/admin/blocks/{self.block.id}/'

        resp = client.patch(url, {'carry_days': 0}, format='json')

        self.assertEqual(resp.status_code, 400, resp.data)
        self.block.refresh_from_db()
        self.assertEqual(self.block.carry_days, 7)
