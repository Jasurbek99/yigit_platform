"""WebSocket consumers.

`AppConsumer` is the single multiplexed socket per browser tab. Frames carry
an envelope `{channel, type, payload}`. Channels implemented:
  - `system`           : connected / ping-pong / disconnect
  - `presence.sheet`   : join / leave / roster broadcast (Phase 2)
  - `worklog.heartbeat`: start / tick (Phase 3)

A WorkSession row is opened automatically on accept and closed on disconnect,
so even clients that never send a `worklog` frame still get their time logged.
The `worklog.start` frame carries the client-side `tab_session_id` /
`client_info` and back-patches the already-open row.
"""
import logging

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.core.services import presence, worklog

logger = logging.getLogger(__name__)


CLOSE_CODE_UNAUTHENTICATED = 4401


class AppConsumer(AsyncJsonWebsocketConsumer):
    """Single multiplexed WS for the whole app."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._in_sheet = False
        self._work_session_id: int | None = None

    async def connect(self) -> None:
        user = self.scope.get('user')
        if user is None or user.is_anonymous:
            logger.info('AppConsumer reject anonymous handshake')
            await self.close(code=CLOSE_CODE_UNAUTHENTICATED)
            return
        await self.accept()
        logger.info('AppConsumer accepted user=%s channel=%s', user.username, self.channel_name)
        # Each side-effect on connect is wrapped so a single failure (DB hiccup,
        # bad header) doesn't tear the socket down and trigger a reconnect storm.
        try:
            self._work_session_id = await worklog.open_session(
                user_id=user.id,
                tab_session_id='',
                client_info=self._client_info_string(),
            )
        except Exception:  # pragma: no cover — defensive
            logger.exception('worklog.open_session failed on connect; continuing without session')
        try:
            await self.send_json({
                'channel': 'system',
                'type': 'connected',
                'payload': {
                    'user_id': user.id,
                    'username': user.username,
                    'heartbeat_interval_seconds': worklog.HEARTBEAT_INTERVAL_SECONDS,
                },
            })
        except Exception:  # pragma: no cover
            logger.exception('AppConsumer send connected frame failed')

    async def disconnect(self, close_code: int) -> None:
        user = self.scope.get('user')
        username = getattr(user, 'username', '?') if user is not None else '?'
        logger.info('AppConsumer disconnect user=%s code=%s channel=%s', username, close_code, self.channel_name)
        if self._in_sheet:
            try:
                await presence.leave_sheet(self.channel_name)
            except Exception:  # pragma: no cover
                logger.exception('presence.leave_sheet failed on disconnect')
            self._in_sheet = False
        if self._work_session_id is not None:
            try:
                await worklog.close_session(self._work_session_id)
            except Exception:  # pragma: no cover
                logger.exception('worklog.close_session failed on disconnect')
            self._work_session_id = None

    async def receive_json(self, content, **kwargs) -> None:
        channel = content.get('channel')
        msg_type = content.get('type')

        if channel == 'system' and msg_type == 'ping':
            await self.send_json({'channel': 'system', 'type': 'pong', 'payload': content.get('payload')})
            return

        if channel == 'presence.sheet':
            await self._handle_presence_sheet(msg_type)
            return

        if channel == 'worklog.heartbeat':
            await self._handle_worklog(msg_type, content.get('payload') or {})
            return

        logger.info('AppConsumer unhandled frame channel=%s type=%s', channel, msg_type)

    # ── presence.sheet dispatch ──────────────────────────────────────────

    async def _handle_presence_sheet(self, msg_type: str) -> None:
        from datetime import datetime, timezone
        user = self.scope['user']
        if msg_type == 'join':
            joined_at = datetime.now(timezone.utc).isoformat()
            info = presence.build_user_info(user, joined_at)
            try:
                await presence.join_sheet(self.channel_name, info)
                self._in_sheet = True
            except Exception:
                # Channel-layer / Redis failure — log and keep the socket open
                # so the rest of the app (worklog heartbeat, system frames)
                # keeps working. The user just doesn't appear in the roster.
                logger.exception('presence.join_sheet failed; socket kept open')
        elif msg_type == 'leave':
            if self._in_sheet:
                try:
                    await presence.leave_sheet(self.channel_name)
                except Exception:
                    logger.exception('presence.leave_sheet failed')
                self._in_sheet = False
        else:
            logger.info('presence.sheet: unknown type=%s', msg_type)

    # ── worklog.heartbeat dispatch ───────────────────────────────────────

    async def _handle_worklog(self, msg_type: str, payload: dict) -> None:
        if self._work_session_id is None:
            return
        if msg_type == 'start':
            # Client identifies the tab — back-patch the row opened on connect
            # so future analytics can dedupe multi-tab the same way reconnects
            # within a tab stay logically one session.
            tab = (payload.get('tab_session_id') or '')[:40]
            client = (payload.get('client_info') or '')[:300]
            if tab or client:
                try:
                    await worklog.patch_session_identity(self._work_session_id, tab, client)
                except Exception:  # pragma: no cover
                    logger.exception('worklog.patch_session_identity failed')
        elif msg_type == 'tick':
            try:
                await worklog.record_heartbeat(self._work_session_id)
            except Exception:  # pragma: no cover
                logger.exception('worklog.record_heartbeat failed')
        else:
            logger.info('worklog.heartbeat: unknown type=%s', msg_type)

    # ── group event handler — presence broadcast ────────────────────────

    async def presence_sheet_roster(self, event) -> None:
        await self.send_json({
            'channel': 'presence.sheet',
            'type': 'roster',
            'payload': {'users': event.get('roster', [])},
        })

    # ── helpers ─────────────────────────────────────────────────────────

    def _client_info_string(self) -> str:
        """Best-effort User-Agent + remote IP from the ASGI scope headers."""
        ua = ''
        ip = ''
        for name, value in self.scope.get('headers', []):
            if name == b'user-agent':
                ua = value.decode('latin-1', errors='replace')[:240]
            elif name in (b'x-real-ip', b'x-forwarded-for') and not ip:
                ip = value.decode('latin-1', errors='replace').split(',')[0].strip()[:50]
        return f'{ua} | {ip}'.strip(' |')
