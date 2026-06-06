"""Work-time logging — persist per-WS-connection sessions.

Design (locked decisions):
  * One row per WS connection lifetime (tab open → tab close).
  * "Tab open at all" counts as working — no Page Visibility / input tracking.
    Each heartbeat just confirms the socket is alive; we add the elapsed
    time since the last heartbeat to `active_seconds`, capped to neutralise
    laptop-sleep gaps.
  * `min(now - last_heartbeat_at, 2 × heartbeat_interval)` is the per-tick cap.
    Sleep for 6 h, wake up, send one tick → adds ≤ 2 × interval, not 6 h.
  * Reaper closes sessions whose `last_heartbeat_at` falls behind
    `WS_IDLE_THRESHOLD_SECONDS` — invoked by host cron, never by an in-process
    timer (would race across uvicorn workers).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from channels.db import database_sync_to_async
from django.db.models import F

from apps.core.models import WorkSession

logger = logging.getLogger(__name__)


HEARTBEAT_INTERVAL_SECONDS = int(os.environ.get('WS_HEARTBEAT_INTERVAL_SECONDS', '30'))
IDLE_THRESHOLD_SECONDS = int(os.environ.get('WS_IDLE_THRESHOLD_SECONDS', '120'))
# Per-heartbeat add is capped at 2× the configured interval so a long
# laptop sleep that resumes with one tick doesn't add hours of "work".
HEARTBEAT_CAP_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 2


def _now() -> datetime:
    return datetime.now(timezone.utc)


@database_sync_to_async
def open_session(user_id: int, tab_session_id: str, client_info: str) -> int:
    """Insert a new open session row, return its pk."""
    now = _now()
    session = WorkSession.objects.create(
        user_id=user_id,
        started_at=now,
        last_heartbeat_at=now,
        active_seconds=0,
        last_state='active',
        tab_session_id=(tab_session_id or '')[:40],
        client_info=(client_info or '')[:300],
    )
    return session.id


@database_sync_to_async
def patch_session_identity(session_id: int, tab_session_id: str, client_info: str) -> None:
    """Back-patch tab_session_id / client_info on an already-open session.

    Called when the client sends `worklog.start` after the WS handshake; the
    consumer can't know the tab UUID until the first JS-side frame.
    """
    fields: dict[str, str] = {}
    if tab_session_id:
        fields['tab_session_id'] = tab_session_id[:40]
    if client_info:
        fields['client_info'] = client_info[:300]
    if not fields:
        return
    WorkSession.objects.filter(id=session_id, ended_at__isnull=True).update(**fields)


@database_sync_to_async
def record_heartbeat(session_id: int) -> None:
    """Add a capped delta to `active_seconds` and bump `last_heartbeat_at`.

    No-ops if the session is already ended (the WS reconnected and a new
    session was opened in between).
    """
    now = _now()
    session = WorkSession.objects.filter(id=session_id, ended_at__isnull=True).only(
        'id', 'last_heartbeat_at', 'active_seconds',
    ).first()
    if session is None:
        return
    delta = (now - session.last_heartbeat_at).total_seconds()
    add = min(max(delta, 0.0), float(HEARTBEAT_CAP_SECONDS))
    WorkSession.objects.filter(id=session_id, ended_at__isnull=True).update(
        last_heartbeat_at=now,
        active_seconds=F('active_seconds') + int(round(add)),
    )


@database_sync_to_async
def close_session(session_id: int) -> None:
    """Mark the session ended at now. Idempotent."""
    now = _now()
    WorkSession.objects.filter(id=session_id, ended_at__isnull=True).update(
        ended_at=now,
    )


def reap_stale() -> int:
    """Close every session whose heartbeat is older than the idle threshold.

    Sync (called from a management command run by cron). Returns the number
    of rows closed. Sets `ended_at = last_heartbeat_at` so a session that
    silently died at 14:32 isn't credited with the dead time up to the
    reaper run at 14:35.
    """
    cutoff = _now() - timedelta(seconds=IDLE_THRESHOLD_SECONDS)
    qs = WorkSession.objects.filter(ended_at__isnull=True, last_heartbeat_at__lt=cutoff)
    # MSSQL doesn't allow UPDATE … SET col = other_col in a single ORM call
    # with F() across the same column we filter on cleanly; do per-row updates
    # in a small loop. The qs is bounded (only stale rows), so this is cheap.
    count = 0
    for session in qs.only('id', 'last_heartbeat_at'):
        WorkSession.objects.filter(id=session.id, ended_at__isnull=True).update(
            ended_at=session.last_heartbeat_at,
        )
        count += 1
    if count:
        logger.info('worklog reaper closed %d stale session(s)', count)
    return count
