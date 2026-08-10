"""IdempotencyKey model — the unique constraint IS the mechanism.

The decorator in apps/core/idempotency.py relies on INSERT-then-fail to resolve
two concurrent retries, so these tests exercise the constraint directly rather
than through a view.
"""
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.core.models import IdempotencyKey, User


class IdempotencyKeyModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='idem_user', password='x', role='export_manager',
        )
        cls.other = User.objects.create_user(
            username='idem_other', password='x', role='export_manager',
        )

    def test_same_user_endpoint_key_twice_raises(self):
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                IdempotencyKey.objects.create(
                    user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
                )

    def test_same_key_different_endpoint_allowed(self):
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/contracts/contracts/', key='abcd1234',
        )
        self.assertEqual(IdempotencyKey.objects.count(), 2)

    def test_same_key_different_user_allowed(self):
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        IdempotencyKey.objects.create(
            user=self.other, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        self.assertEqual(IdempotencyKey.objects.count(), 2)

    def test_new_row_is_in_flight(self):
        record = IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        self.assertIsNone(record.status_code)
        self.assertIsNone(record.response_body)
