"""Sheet-change broadcast — tells open Sheet tabs that something moved.

The payload deliberately carries NO row data: only which shipments changed and
who changed them. Each client refetches through its own `/shipments/sheet/`
call, so per-role field filtering stays in the endpoint where it already lives
and nothing can leak to a viewer who shouldn't see it.

Audience is the `presence.sheet` group — exactly the sockets that sent a
`presence.sheet join` frame, i.e. the users currently looking at the Sheet.

This is the only place in the backend that reaches the channel layer from
synchronous code. Callers are DRF `finalize_response` hooks, which run after
the action's `transaction.atomic()` block has exited (ATOMIC_REQUESTS is False
on this project), so the data is already committed when we broadcast — no
`transaction.on_commit` wrapper is needed or wanted.

Public API:
    broadcast_sheet_change(shipment_ids, by_user_id) -> None
    poke_sheet(request, response, shipment_ids)      -> None
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.core.services.presence import SHEET_GROUP

logger = logging.getLogger(__name__)

WRITE_METHODS = ('POST', 'PATCH', 'PUT', 'DELETE')


def broadcast_sheet_change(shipment_ids: Iterable[Any], by_user_id: int | None) -> None:
    """Push a `sheet.changed` poke to every socket viewing the Sheet.

    Ids are coerced to int because detail routes hand us `self.kwargs['pk']`,
    which DRF pulls out of the URL regex as a string.

    Never raises. The write that triggered this has already been committed and
    a 200 is on its way to the client; a Redis outage must not turn that into
    a 500. Worst case the other tabs stay stale until their next refetch.
    """
    ids = sorted({int(i) for i in shipment_ids if i is not None})
    if not ids:
        return
    try:
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(SHEET_GROUP, {
            'type': 'sheet.changed',  # → AppConsumer.sheet_changed
            'shipment_ids': ids,
            'by_user_id': by_user_id,
        })
    except Exception:  # noqa: BLE001 — see docstring; the write already succeeded
        logger.exception('broadcast_sheet_change failed for ids=%s', ids)


def poke_sheet(request, response, shipment_ids: Iterable[Any]) -> None:
    """Broadcast only if this request was a write that actually succeeded.

    Single decision point shared by every ViewSet's `finalize_response`, so the
    "was this a successful write?" rule lives in one place instead of three.
    """
    if request.method not in WRITE_METHODS:
        return
    if not (200 <= response.status_code < 300):
        return
    user = getattr(request, 'user', None)
    broadcast_sheet_change(shipment_ids, getattr(user, 'id', None))
