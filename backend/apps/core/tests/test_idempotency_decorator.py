"""@idempotent decorator — tested against a throwaway view, not a real endpoint.

Keeping the probe view local means these tests describe the MECHANISM and stay
readable when the real endpoints change shape.
"""
from django.test import TestCase, override_settings
from django.urls import path
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.views import APIView

from apps.core.idempotency import idempotent
from apps.core.models import IdempotencyKey, User

CALLS: list[str] = []


class _ProbeView(APIView):
    """Records every real execution so tests can assert the view ran once."""

    @idempotent
    def post(self, request, *args, **kwargs):
        CALLS.append(request.data.get('marker', ''))
        outcome = request.data.get('outcome', 'ok')
        if outcome == 'bad_request':
            return Response({'error': 'nope'}, status=status.HTTP_400_BAD_REQUEST)
        if outcome == 'boom':
            raise RuntimeError('view exploded')
        return Response(
            {'created': request.data.get('marker', '')},
            status=status.HTTP_201_CREATED,
        )


urlpatterns = [path('probe/', _ProbeView.as_view())]


@override_settings(ROOT_URLCONF=__name__)
class IdempotentDecoratorTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='idem_dec', password='x', role='export_manager',
        )

    def setUp(self):
        CALLS.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _post(self, body, key=None):
        headers = {'HTTP_IDEMPOTENCY_KEY': key} if key else {}
        return self.client.post('/probe/', body, format='json', **headers)

    def test_no_header_passes_through_and_writes_no_row(self):
        r1 = self._post({'marker': 'a'})
        r2 = self._post({'marker': 'a'})
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(len(CALLS), 2)
        self.assertEqual(IdempotencyKey.objects.count(), 0)

    def test_same_key_twice_runs_view_once_and_replays_body(self):
        r1 = self._post({'marker': 'a'}, key='key-aaaa-1111')
        r2 = self._post({'marker': 'DIFFERENT'}, key='key-aaaa-1111')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(len(CALLS), 1, 'view must execute exactly once')
        self.assertEqual(r2.json(), r1.json())
        self.assertEqual(r2.json()['created'], 'a', 'replay returns the FIRST body')

    def test_in_flight_key_returns_409(self):
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/probe/', key='key-bbbb-2222',
        )
        response = self._post({'marker': 'a'}, key='key-bbbb-2222')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()['error'], 'idempotency_in_progress')
        self.assertEqual(len(CALLS), 0)

    def test_validation_400_frees_the_key(self):
        r1 = self._post({'marker': 'a', 'outcome': 'bad_request'}, key='key-cccc-3333')
        self.assertEqual(r1.status_code, 400)
        self.assertEqual(
            IdempotencyKey.objects.count(), 0,
            'a rejected request must not burn the key',
        )
        r2 = self._post({'marker': 'fixed'}, key='key-cccc-3333')
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r2.json()['created'], 'fixed')

    def test_exception_keeps_the_key_and_replay_reports_failure(self):
        with self.assertRaises(RuntimeError):
            self._post({'marker': 'a', 'outcome': 'boom'}, key='key-dddd-4444')
        record = IdempotencyKey.objects.get(key='key-dddd-4444')
        self.assertEqual(record.status_code, 500)
        response = self._post({'marker': 'a'}, key='key-dddd-4444')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            len(CALLS), 1,
            'a half-written create must not run a second time',
        )

    def test_malformed_key_rejected(self):
        for bad in ('short', 'has spaces here', 'x' * 65, 'bad!chars@here'):
            with self.subTest(key=bad):
                response = self._post({'marker': 'a'}, key=bad)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['error'], 'invalid_idempotency_key')
        self.assertEqual(len(CALLS), 0)
        self.assertEqual(IdempotencyKey.objects.count(), 0)
