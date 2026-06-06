"""WebSocket consumers.

`AppConsumer` is the single multiplexed socket per browser tab. Frames carry
an envelope `{channel, type, payload}`. Phase 1 added the `system` channel
(connected/ping/pong). Phase 2 adds `presence.sheet` (join/leave/roster).
"""
import logging
from datetime import datetime, timezone

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.core.services import presence

logger = logging.getLogger(__name__)


CLOSE_CODE_UNAUTHENTICATED = 4401


class AppConsumer(AsyncJsonWebsocketConsumer):
    """Single multiplexed WS for the whole app."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._in_sheet = False  # tracks whether this socket has joined presence.sheet

    async def connect(self) -> None:
        user = self.scope.get('user')
        if user is None or user.is_anonymous:
            await self.close(code=CLOSE_CODE_UNAUTHENTICATED)
            return
        await self.accept()
        await self.send_json({
            'channel': 'system',
            'type': 'connected',
            'payload': {'user_id': user.id, 'username': user.username},
        })

    async def disconnect(self, close_code: int) -> None:
        if self._in_sheet:
            try:
                await presence.leave_sheet(self.channel_name)
            except Exception:  # pragma: no cover — defensive: log + swallow
                logger.exception('presence.leave_sheet failed on disconnect')
            self._in_sheet = False
        logger.debug('AppConsumer disconnect user=%s code=%s', self.scope.get('user'), close_code)

    async def receive_json(self, content, **kwargs) -> None:
        channel = content.get('channel')
        msg_type = content.get('type')

        if channel == 'system' and msg_type == 'ping':
            await self.send_json({'channel': 'system', 'type': 'pong', 'payload': content.get('payload')})
            return

        if channel == 'presence.sheet':
            await self._handle_presence_sheet(msg_type)
            return

        logger.info('AppConsumer unhandled frame channel=%s type=%s', channel, msg_type)

    # ── presence.sheet dispatch ──────────────────────────────────────────

    async def _handle_presence_sheet(self, msg_type: str) -> None:
        user = self.scope['user']
        if msg_type == 'join':
            joined_at = datetime.now(timezone.utc).isoformat()
            info = presence.build_user_info(user, joined_at)
            await presence.join_sheet(self.channel_name, info)
            self._in_sheet = True
        elif msg_type == 'leave':
            if self._in_sheet:
                await presence.leave_sheet(self.channel_name)
                self._in_sheet = False
        else:
            logger.info('presence.sheet: unknown type=%s', msg_type)

    # ── group event handler — name matches the {type} dotted form ─────
    #     `presence.sheet.roster` (sent by services.presence._broadcast_roster)
    #     is dispatched here. Channels turns the dotted type into snake-case
    #     method `presence_sheet_roster`.

    async def presence_sheet_roster(self, event) -> None:
        await self.send_json({
            'channel': 'presence.sheet',
            'type': 'roster',
            'payload': {'users': event.get('roster', [])},
        })
