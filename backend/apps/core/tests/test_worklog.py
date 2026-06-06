"""Worklog tests — service + WS dispatch + API.

Run:
    python manage.py test apps.core.tests.test_worklog
"""
import asyncio
from datetime import datetime, timedelta, timezone

from channels.db import database_sync_to_async
from channels.testing.websocket import WebsocketCommunicator
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.core.models import User, WorkSession
from apps.core.services import worklog
from config.asgi import application


def _make_user(username: str, role: str = 'warehouse_chief') -> User:
    user = User(username=username, role=role, first_name=username.capitalize())
    user.set_password('testpass123')
    user.save()
    return user


def _client(user: User) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


# ── Service ──────────────────────────────────────────────────────────────


class WorklogServiceTests(TransactionTestCase):
    """Heartbeat cap + reaper logic — synchronous service-layer tests."""

    def test_heartbeat_adds_capped_delta(self) -> None:
        user = _make_user('alice')
        # Open session — last_heartbeat_at = now.
        session_id = asyncio.run(worklog.open_session(user.id, 'tab-1', 'agent | ip'))
        s = WorkSession.objects.get(id=session_id)
        self.assertEqual(s.active_seconds, 0)

        # Force last_heartbeat_at to ~25 s ago (within cap).
        WorkSession.objects.filter(id=session_id).update(
            last_heartbeat_at=datetime.now(timezone.utc) - timedelta(seconds=25),
        )
        asyncio.run(worklog.record_heartbeat(session_id))
        s.refresh_from_db()
        self.assertGreaterEqual(s.active_seconds, 24)
        self.assertLessEqual(s.active_seconds, 27)  # tolerate scheduler jitter

    def test_heartbeat_caps_long_sleep_gap(self) -> None:
        """A 6 h sleep + one tick must add ≤ 2× HEARTBEAT_INTERVAL_SECONDS."""
        user = _make_user('bob')
        session_id = asyncio.run(worklog.open_session(user.id, 'tab-2', ''))
        WorkSession.objects.filter(id=session_id).update(
            last_heartbeat_at=datetime.now(timezone.utc) - timedelta(hours=6),
        )
        asyncio.run(worklog.record_heartbeat(session_id))
        s = WorkSession.objects.get(id=session_id)
        self.assertLessEqual(s.active_seconds, worklog.HEARTBEAT_CAP_SECONDS + 1)

    def test_close_session_idempotent(self) -> None:
        user = _make_user('carol')
        session_id = asyncio.run(worklog.open_session(user.id, '', ''))
        asyncio.run(worklog.close_session(session_id))
        first = WorkSession.objects.get(id=session_id).ended_at
        asyncio.run(worklog.close_session(session_id))
        second = WorkSession.objects.get(id=session_id).ended_at
        self.assertEqual(first, second)  # second close is a no-op (filter ended_at__isnull=True)

    def test_reaper_closes_stale(self) -> None:
        user = _make_user('dan')
        # Live session — heartbeat 10 s ago, should NOT be reaped.
        live_id = asyncio.run(worklog.open_session(user.id, '', ''))
        WorkSession.objects.filter(id=live_id).update(
            last_heartbeat_at=datetime.now(timezone.utc) - timedelta(seconds=10),
        )
        # Stale session — heartbeat 10 min ago, should be reaped.
        stale_id = asyncio.run(worklog.open_session(user.id, '', ''))
        old_hb = datetime.now(timezone.utc) - timedelta(minutes=10)
        WorkSession.objects.filter(id=stale_id).update(last_heartbeat_at=old_hb)

        reaped = worklog.reap_stale()
        self.assertEqual(reaped, 1)
        self.assertIsNone(WorkSession.objects.get(id=live_id).ended_at)
        ended = WorkSession.objects.get(id=stale_id).ended_at
        self.assertIsNotNone(ended)
        # ended_at preserves last_heartbeat_at (not "now"), so dead time isn't credited.
        self.assertAlmostEqual(
            ended.replace(microsecond=0),
            old_hb.replace(microsecond=0),
            delta=timedelta(seconds=1),
        )


# ── WS dispatch ──────────────────────────────────────────────────────────


@database_sync_to_async
def _async_make_user(username: str) -> User:
    return _make_user(username)


@database_sync_to_async
def _async_token(user: User) -> str:
    return str(AccessToken.for_user(user))


@database_sync_to_async
def _async_session_count(user_id: int) -> int:
    return WorkSession.objects.filter(user_id=user_id).count()


@database_sync_to_async
def _async_get_session(user_id: int) -> WorkSession:
    return WorkSession.objects.filter(user_id=user_id).first()


class WorklogConsumerTests(TransactionTestCase):
    def test_connect_opens_session_and_disconnect_closes_it(self) -> None:
        async def run() -> None:
            user = await _async_make_user('eve')
            token = await _async_token(user)
            comm = WebsocketCommunicator(application, '/ws/app/')
            comm.scope['headers'].append((b'cookie', f'access_token={token}'.encode()))
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()  # drain connected frame
            self.assertEqual(await _async_session_count(user.id), 1)

            # `worklog.start` patches identity onto the already-open row.
            await comm.send_json_to({
                'channel': 'worklog.heartbeat',
                'type': 'start',
                'payload': {'tab_session_id': 'tab-abc-123', 'client_info': 'TestUA | 127.0.0.1'},
            })
            # `worklog.heartbeat / tick` adds to active_seconds.
            await comm.send_json_to({
                'channel': 'worklog.heartbeat',
                'type': 'tick',
                'payload': {},
            })
            # Give the consumer a chance to flush. No reply expected.
            await asyncio.sleep(0.1)

            await comm.disconnect()
            await asyncio.sleep(0.05)

            session = await _async_get_session(user.id)
            self.assertEqual(session.tab_session_id, 'tab-abc-123')
            self.assertIsNotNone(session.ended_at)

        asyncio.run(run())


# ── API ──────────────────────────────────────────────────────────────────


class WorklogApiTests(TestCase):
    def setUp(self) -> None:
        self.alice = _make_user('alice', role='warehouse_chief')
        self.bob = _make_user('bob', role='export_manager')
        # Two sessions for Alice today, one for Bob today, one for Alice yesterday.
        now = datetime.now(timezone.utc)
        WorkSession.objects.create(
            user=self.alice, started_at=now, last_heartbeat_at=now, ended_at=now,
            active_seconds=3600, tab_session_id='a1',
        )
        WorkSession.objects.create(
            user=self.alice, started_at=now, last_heartbeat_at=now, ended_at=now,
            active_seconds=900, tab_session_id='a2',
        )
        WorkSession.objects.create(
            user=self.bob, started_at=now, last_heartbeat_at=now, ended_at=now,
            active_seconds=120, tab_session_id='b1',
        )
        yesterday = now - timedelta(days=1)
        WorkSession.objects.create(
            user=self.alice, started_at=yesterday, last_heartbeat_at=yesterday, ended_at=yesterday,
            active_seconds=7200, tab_session_id='a-y',
        )

    def test_me_endpoint_sums_today_for_request_user(self) -> None:
        resp = _client(self.alice).get('/api/v1/core/worklog/me/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        # Alice has 3600 + 900 = 4500 active_seconds today.
        self.assertEqual(body['today_active_seconds'], 4500)
        # And a yesterday row of 7200 — total = 4500 + 7200 = 11700.
        self.assertEqual(body['total_active_seconds'], 11700)

    def test_list_endpoint_returns_every_user(self) -> None:
        resp = _client(self.bob).get('/api/v1/core/worklog/')
        self.assertEqual(resp.status_code, 200)
        usernames = {row['user_name'] for row in resp.json()['results']}
        # Both Alice and Bob should appear — no admin gate.
        self.assertIn('Alice', usernames)
        self.assertIn('Bob', usernames)

    def test_team_endpoint_includes_inactive_users_with_zero(self) -> None:
        carol = _make_user('carol', role='document_team')
        resp = _client(self.alice).get('/api/v1/core/worklog/team/')
        self.assertEqual(resp.status_code, 200)
        by_name = {r['user_name']: r['active_seconds'] for r in resp.json()['results']}
        self.assertEqual(by_name.get('Carol'), 0)  # no sessions yet
        self.assertEqual(by_name.get('Alice'), 4500)
        self.assertEqual(by_name.get('Bob'), 120)
