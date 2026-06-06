"""Sheet presence — who is currently viewing the Shipment Sheet.

Single global room (`presence.sheet`) on the channel layer. Membership state
lives in Redis (hash `presence:sheet`) so every uvicorn worker sees the same
roster. In tests the channel layer is in-memory; we mirror that with a
module-level dict so the test path needs no Redis.

Public API:
    join_sheet(channel_name, user_info) -> roster
    leave_sheet(channel_name)          -> roster
    roster()                            -> roster
"""
from __future__ import annotations

import json
import logging
from typing import Any

from channels.layers import get_channel_layer
from django.conf import settings

logger = logging.getLogger(__name__)

SHEET_GROUP = 'presence.sheet'
SHEET_REDIS_KEY = 'presence:sheet'


# In-process fallback used when CHANNEL_LAYERS is InMemoryChannelLayer (tests).
_memory_roster: dict[str, dict[str, Any]] = {}
_redis_client = None


def _backend_is_redis() -> bool:
    return 'redis' in settings.CHANNEL_LAYERS['default']['BACKEND'].lower()


async def _redis():
    """Lazy-init the redis.asyncio client. One connection pool per process."""
    global _redis_client
    if _redis_client is None:
        from redis.asyncio import from_url  # local import — only needed in prod path
        _redis_client = from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


async def _hset(channel_name: str, user_info: dict[str, Any]) -> None:
    if _backend_is_redis():
        client = await _redis()
        await client.hset(SHEET_REDIS_KEY, channel_name, json.dumps(user_info))
    else:
        _memory_roster[channel_name] = user_info


async def _hdel(channel_name: str) -> None:
    if _backend_is_redis():
        client = await _redis()
        await client.hdel(SHEET_REDIS_KEY, channel_name)
    else:
        _memory_roster.pop(channel_name, None)


async def _hvals() -> list[dict[str, Any]]:
    if _backend_is_redis():
        client = await _redis()
        raw = await client.hvals(SHEET_REDIS_KEY)
        return [json.loads(v) for v in raw]
    return list(_memory_roster.values())


async def roster() -> list[dict[str, Any]]:
    """Return current sheet roster (one entry per open WS, oldest first)."""
    entries = await _hvals()
    entries.sort(key=lambda e: e.get('joined_at', ''))
    return entries


async def join_sheet(channel_name: str, user_info: dict[str, Any]) -> list[dict[str, Any]]:
    """Add the channel to the sheet group, write metadata, return new roster."""
    layer = get_channel_layer()
    await layer.group_add(SHEET_GROUP, channel_name)
    await _hset(channel_name, user_info)
    new_roster = await roster()
    await _broadcast_roster(new_roster)
    return new_roster


async def leave_sheet(channel_name: str) -> list[dict[str, Any]]:
    """Remove channel from group + metadata; return remaining roster."""
    layer = get_channel_layer()
    await layer.group_discard(SHEET_GROUP, channel_name)
    await _hdel(channel_name)
    new_roster = await roster()
    await _broadcast_roster(new_roster)
    return new_roster


async def _broadcast_roster(current: list[dict[str, Any]]) -> None:
    """Push the full roster to every sheet viewer.

    AppConsumer.presence_sheet_roster forwards the payload to its socket.
    """
    layer = get_channel_layer()
    await layer.group_send(SHEET_GROUP, {
        'type': 'presence.sheet.roster',
        'roster': current,
    })


def _avatar_color_for(user_id: int) -> str:
    """Deterministic colour from a 6-palette so the same user keeps the same dot.

    Tailwind-ish hues, all readable on white. Not security-sensitive.
    """
    palette = [
        '#2563eb',  # blue
        '#16a34a',  # green
        '#dc2626',  # red
        '#9333ea',  # purple
        '#ea580c',  # orange
        '#0891b2',  # teal
    ]
    return palette[user_id % len(palette)]


def build_user_info(user, joined_at_iso: str) -> dict[str, Any]:
    """Shape the serialised user payload sent inside a roster entry.

    Kept here (not in a serializer) because the consumer is async and we want
    to avoid importing DRF serializer plumbing into the WS path.
    """
    first = (user.first_name or '').strip()
    last = (user.last_name or '').strip()
    name = ' '.join(p for p in (first, last) if p) or user.username
    return {
        'user_id': user.id,
        'username': user.username,
        'name': name,
        'role': user.role,
        'color': _avatar_color_for(user.id),
        'joined_at': joined_at_iso,
    }
