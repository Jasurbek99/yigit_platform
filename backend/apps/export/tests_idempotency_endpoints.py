"""Idempotency smoke tests for the export app's covered create endpoints.

The mechanism itself is tested in apps/core/tests/test_idempotency*.py. These
tests only prove the decorator is actually WIRED to each real endpoint and that
a retry produces one row, not two.

Fixture helpers mirror apps/export/tests_draft_promote.py.
"""
import datetime as dt

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, Customer, Season, ShipmentStatusType, User
from apps.export.models import (
    CustomsExpense, FinansistAdvance, Shipment, ShipmentComment,
)

SHIPMENTS_URL = '/api/v1/export/shipments/'
COMMENTS_URL = '/api/v1/export/comments/'
ADVANCES_URL = '/api/v1/export/advances/'
EXPENSES_URL = '/api/v1/export/customs-expenses/'


def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025',
        defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31',
                  'is_active': True},
    )
    return season


def _make_status(code: str, step_order: int, name_en: str) -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={'name_tk': code, 'name_en': name_en, 'name_ru': name_en,
                  'step_order': step_order, 'phase': 'PREP'},
    )
    return obj


class ShipmentCreateIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _make_status('draft', 0, 'Draft')
        _make_status('yuklenme', 1, 'Loading')
        cls.user = _make_user('idem_em', 'export_manager')
        cls.season = _make_season()
        cls.country = Country.objects.create(
            name_tk='Kazakhstan', name_en='Kazakhstan',
            name_ru='Казахстан', code='KZ',
        )
        cls.customer = Customer.objects.create(name='IdemCustomer')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _payload(self) -> dict:
        return {'country': self.country.id, 'customer': self.customer.id,
                'season': self.season.id}

    def test_repeated_create_yields_one_shipment(self):
        r1 = self.client.post(SHIPMENTS_URL, self._payload(), format='json',
                              HTTP_IDEMPOTENCY_KEY='ship-key-000001')
        r2 = self.client.post(SHIPMENTS_URL, self._payload(), format='json',
                              HTTP_IDEMPOTENCY_KEY='ship-key-000001')

        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r1.json()['shipment_code'], r2.json()['shipment_code'])
        self.assertEqual(Shipment.objects.count(), 1)

    def test_different_keys_yield_two_shipments(self):
        self.client.post(SHIPMENTS_URL, self._payload(), format='json',
                         HTTP_IDEMPOTENCY_KEY='ship-key-000001')
        self.client.post(SHIPMENTS_URL, self._payload(), format='json',
                         HTTP_IDEMPOTENCY_KEY='ship-key-000002')
        self.assertEqual(Shipment.objects.count(), 2)

    def test_no_header_still_creates_two(self):
        """Absence of the header must not change existing behaviour."""
        self.client.post(SHIPMENTS_URL, self._payload(), format='json')
        self.client.post(SHIPMENTS_URL, self._payload(), format='json')
        self.assertEqual(Shipment.objects.count(), 2)


class CommentIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _make_status('draft', 0, 'Draft')
        cls.user = _make_user('idem_cmt', 'export_manager')
        cls.season = _make_season()
        cls.shipment = Shipment.objects.create(
            shipment_code='0108001/26',
            date=dt.date(2026, 8, 1),
            season=cls.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            created_by=cls.user,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_repeated_comment_viewset_create_yields_one_comment(self):
        payload = {'shipment': self.shipment.id, 'content': 'hello'}
        r1 = self.client.post(COMMENTS_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='cmt-key-000001')
        r2 = self.client.post(COMMENTS_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='cmt-key-000001')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.json(), r1.json())
        self.assertEqual(ShipmentComment.objects.count(), 1)

    def test_repeated_legacy_comment_action_yields_one_comment(self):
        url = f'{SHIPMENTS_URL}{self.shipment.id}/comment/'
        self.client.post(url, {'content': 'hi'}, format='json',
                         HTTP_IDEMPOTENCY_KEY='cmt-key-000002')
        self.client.post(url, {'content': 'hi'}, format='json',
                         HTTP_IDEMPOTENCY_KEY='cmt-key-000002')
        self.assertEqual(ShipmentComment.objects.count(), 1)


class AdvanceIdempotencyTest(TestCase):
    """ADVANCE_WRITE = {'admin', 'finansist', 'director'} (apps/core/roles.py:79)."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('idem_fin', 'finansist')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_repeated_advance_create_yields_one_advance(self):
        payload = {'advance_date': '2026-08-10', 'total_amount': '1000.00',
                   'currency': 'USD'}
        r1 = self.client.post(ADVANCES_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='adv-key-000001')
        r2 = self.client.post(ADVANCES_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='adv-key-000001')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.json(), r1.json())
        self.assertEqual(FinansistAdvance.objects.count(), 1)


class CustomsExpenseIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('idem_exp', 'finansist')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_repeated_expense_create_yields_one_expense(self):
        # 'OTHER' is CustomsExpenseCategory.OTHER — choices are uppercase
        # (apps/export/models/finance.py:134-149).
        payload = {'expense_date': '2026-08-10', 'amount': '250.00',
                   'currency': 'TMT', 'category': 'OTHER'}
        r1 = self.client.post(EXPENSES_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='exp-key-000001')
        r2 = self.client.post(EXPENSES_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='exp-key-000001')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.json(), r1.json())
        self.assertEqual(CustomsExpense.objects.count(), 1)
