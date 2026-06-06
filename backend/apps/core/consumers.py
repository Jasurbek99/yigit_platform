"""WebSocket consumers.

`AppConsumer` is the single multiplexed socket per browser tab. Frames carry
an envelope `{channel, type, payload}`. This Phase 1 stub only handles a
`hello` ping/pong so the handshake can be smoke-tested end-to-end. Phase 2
adds the `presence.sheet` channel dispatch.
"""
import logging

from channels.generic.websocket import AsyncJsonWebsocketConsumer

logger = logging.getLogger(__name__)


CLOSE_CODE_UNAUTHENTICATED = 4401


class AppConsumer(AsyncJsonWebsocketConsumer):
    """Single multiplexed WS for the whole app."""

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
        logger.debug('AppConsumer disconnect user=%s code=%s', self.scope.get('user'), close_code)

    async def receive_json(self, content, **kwargs) -> None:
        channel = content.get('channel')
        msg_type = content.get('type')

        # Phase 1 stub: ping/pong so the client can smoke-test the round trip.
        if channel == 'system' and msg_type == 'ping':
            await self.send_json({'channel': 'system', 'type': 'pong', 'payload': content.get('payload')})
            return

        # Unknown channel/type for now — log and ignore. Phase 2 wires
        # `presence.sheet` dispatch here.
        logger.info('AppConsumer unhandled frame channel=%s type=%s', channel, msg_type)
