from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.core.models import IdempotencyKey, User
from apps.core.tasks import purge_expired_idempotency_keys


class PurgeExpiredIdempotencyKeysTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='idem_purge', password='x', role='export_manager',
        )

    def _make(self, key: str, age_hours: int) -> IdempotencyKey:
        record = IdempotencyKey.objects.create(
            user=self.user, endpoint='/probe/', key=key,
        )
        # created_at is auto_now_add, so age has to be forced with an update.
        IdempotencyKey.objects.filter(pk=record.pk).update(
            created_at=timezone.now() - timedelta(hours=age_hours),
        )
        return record

    def test_deletes_only_rows_older_than_24h(self):
        self._make('fresh-key-0001', age_hours=1)
        self._make('stale-key-0001', age_hours=25)
        self._make('stale-key-0002', age_hours=200)

        deleted = purge_expired_idempotency_keys()

        self.assertEqual(deleted, 2)
        remaining = list(IdempotencyKey.objects.values_list('key', flat=True))
        self.assertEqual(remaining, ['fresh-key-0001'])

    def test_is_safe_to_run_on_an_empty_table(self):
        self.assertEqual(purge_expired_idempotency_keys(), 0)
