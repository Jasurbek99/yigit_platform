"""Two simultaneous retries must execute the view exactly once.

This test exists SEPARATELY from the sequential-replay test because a
sequential retry passes even against a check-then-create implementation. Only a
parallel test proves the insert-first design actually holds.

TransactionTestCase is required: TestCase wraps each test in a transaction the
worker threads cannot see into, so the INSERTs would never collide.
"""
import threading
import time

from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.urls import path
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.views import APIView

from apps.core.idempotency import idempotent
from apps.core.models import IdempotencyKey, User

EXECUTIONS: list[int] = []

# Released when both threads are ready, so their requests start together.
# It CANNOT live inside the view body — the losing thread never reaches the
# view (it fails the INSERT and returns early), so a barrier there would
# deadlock the winner.
_START = threading.Barrier(2, timeout=15)


class _SlowProbeView(APIView):
    @idempotent
    def post(self, request, *args, **kwargs):
        EXECUTIONS.append(1)
        # Stay in flight long enough that the loser's INSERT lands while this
        # request is still running — that is the case the 409 branch exists for.
        time.sleep(0.5)
        return Response({'ok': True}, status=status.HTTP_201_CREATED)


urlpatterns = [path('slow-probe/', _SlowProbeView.as_view())]


@override_settings(ROOT_URLCONF=__name__)
class IdempotencyConcurrencyTest(TransactionTestCase):
    def setUp(self):
        EXECUTIONS.clear()
        _START.reset()
        self.user = User.objects.create_user(
            username='idem_race', password='x', role='export_manager',
        )

    def test_two_simultaneous_requests_execute_the_view_once(self):
        results: list[int] = []

        def fire():
            try:
                client = APIClient()
                client.force_authenticate(self.user)
                _START.wait()
                response = client.post(
                    '/slow-probe/', {}, format='json',
                    HTTP_IDEMPOTENCY_KEY='race-key-000001',
                )
                results.append(response.status_code)
            finally:
                # Each thread opens its own connection; Django does not close
                # them and TransactionTestCase teardown would hang otherwise.
                connection.close()

        threads = [threading.Thread(target=fire) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        self.assertEqual(len(results), 2, 'both requests must return')
        self.assertEqual(
            len(EXECUTIONS), 1,
            'the view body must execute exactly once across both threads',
        )
        self.assertEqual(
            IdempotencyKey.objects.filter(key='race-key-000001').count(), 1,
        )
        # The loser sees the winner mid-flight (409) or already done (201).
        # A 5xx here means the IntegrityError escaped instead of being handled.
        self.assertNotIn(
            500, results,
            'the losing request must be handled, not blow up',
        )
        self.assertIn(sorted(results), ([201, 201], [201, 409]))
