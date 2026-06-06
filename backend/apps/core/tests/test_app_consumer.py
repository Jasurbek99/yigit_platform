"""WebSocket integration tests for AppConsumer.

Covers:
    1. Anonymous handshake → server closes with 4401.
    2. Cookie-JWT handshake → `system.connected` frame on accept.
    3. `system.ping` round-trips to `system.pong`.
    4. Two clients join `presence.sheet` → both see each other in the roster
       broadcast.
    5. One client disconnects → the other receives a shrunk roster.

Uses Channels' in-memory channel layer (auto-selected under DJANGO_TESTING).

Run:
    python manage.py test apps.core.tests.test_app_consumer --keepdb --verbosity=2
"""
import asyncio

from channels.db import database_sync_to_async
from channels.testing.websocket import WebsocketCommunicator
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.core.models import User
from apps.core.services import presence
from config.asgi import application


def _cookie_header(token: str) -> tuple[bytes, bytes]:
    return (b'cookie', f'access_token={token}'.encode())


@database_sync_to_async
def _make_user(username: str, role: str = 'warehouse_chief') -> User:
    user = User(username=username, role=role, first_name=username.capitalize())
    user.set_password('testpass123')
    user.save()
    return user


@database_sync_to_async
def _token_for(user: User) -> str:
    return str(AccessToken.for_user(user))


async def _connect(token: str | None) -> WebsocketCommunicator:
    comm = WebsocketCommunicator(application, '/ws/app/')
    if token:
        comm.scope['headers'].append(_cookie_header(token))
    return comm


class AppConsumerTests(TransactionTestCase):
    """Driven via asyncio.run so each test exercises the real consumer."""

    def setUp(self) -> None:
        # Each test starts with a clean in-process roster.
        presence._memory_roster.clear()

    def test_anonymous_handshake_rejected(self) -> None:
        async def run() -> None:
            comm = await _connect(token=None)
            connected, code = await comm.connect()
            self.assertFalse(connected)
            self.assertEqual(code, 4401)

        asyncio.run(run())

    def test_authenticated_handshake_emits_connected_frame(self) -> None:
        async def run() -> None:
            user = await _make_user('alice')
            token = await _token_for(user)
            comm = await _connect(token)
            connected, _ = await comm.connect()
            self.assertTrue(connected)

            hello = await comm.receive_json_from()
            self.assertEqual(hello['channel'], 'system')
            self.assertEqual(hello['type'], 'connected')
            self.assertEqual(hello['payload']['username'], 'alice')

            await comm.disconnect()

        asyncio.run(run())

    def test_ping_pong(self) -> None:
        async def run() -> None:
            user = await _make_user('alice')
            token = await _token_for(user)
            comm = await _connect(token)
            await comm.connect()
            await comm.receive_json_from()  # drain connected frame

            await comm.send_json_to({'channel': 'system', 'type': 'ping', 'payload': {'n': 7}})
            pong = await comm.receive_json_from()
            self.assertEqual(pong, {'channel': 'system', 'type': 'pong', 'payload': {'n': 7}})

            await comm.disconnect()

        asyncio.run(run())

    def test_presence_join_broadcasts_to_both_clients(self) -> None:
        async def run() -> None:
            alice = await _make_user('alice')
            bob = await _make_user('bob', role='export_manager')
            alice_token = await _token_for(alice)
            bob_token = await _token_for(bob)

            a = await _connect(alice_token)
            b = await _connect(bob_token)
            await a.connect()
            await b.connect()
            await a.receive_json_from()  # drain connected
            await b.receive_json_from()

            # Alice joins first → both receive a roster with just Alice.
            await a.send_json_to({'channel': 'presence.sheet', 'type': 'join'})
            roster_a1 = await a.receive_json_from()
            self.assertEqual(roster_a1['channel'], 'presence.sheet')
            self.assertEqual(roster_a1['type'], 'roster')
            users_a1 = roster_a1['payload']['users']
            self.assertEqual([u['username'] for u in users_a1], ['alice'])

            # Bob joins → both receive an updated roster with Alice + Bob.
            await b.send_json_to({'channel': 'presence.sheet', 'type': 'join'})
            roster_a2 = await a.receive_json_from()
            roster_b2 = await b.receive_json_from()
            self.assertEqual({u['username'] for u in roster_a2['payload']['users']}, {'alice', 'bob'})
            self.assertEqual({u['username'] for u in roster_b2['payload']['users']}, {'alice', 'bob'})

            await a.disconnect()
            await b.disconnect()

        asyncio.run(run())

    def test_disconnect_shrinks_roster(self) -> None:
        async def run() -> None:
            alice = await _make_user('alice')
            bob = await _make_user('bob', role='export_manager')
            a = await _connect(await _token_for(alice))
            b = await _connect(await _token_for(bob))
            await a.connect()
            await b.connect()
            await a.receive_json_from()
            await b.receive_json_from()

            await a.send_json_to({'channel': 'presence.sheet', 'type': 'join'})
            await a.receive_json_from()
            await b.send_json_to({'channel': 'presence.sheet', 'type': 'join'})
            await a.receive_json_from()
            await b.receive_json_from()

            # Bob disconnects → Alice gets a roster of just herself.
            await b.disconnect()
            roster_a = await a.receive_json_from()
            self.assertEqual([u['username'] for u in roster_a['payload']['users']], ['alice'])

            await a.disconnect()

        asyncio.run(run())
