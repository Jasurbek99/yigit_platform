"""Retry-safe POST handling via a client-supplied Idempotency-Key header.

The operator-facing problem: on a public network in KZ/RU a Save can reach the
server, succeed, and lose its response. The operator presses Save again and
gets a second truck, a second contract, or a second advance.

The mechanism: INSERT a key row, then run the view. Two concurrent retries race
on the unique constraint and exactly one wins; the loser either replays the
winner's stored response or is told the winner is still running. A
check-then-create would let both through, so the INSERT must come first.
"""

import functools
import json
import logging
import re

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.response import Response

from apps.core.models import IdempotencyKey

logger = logging.getLogger(__name__)

IDEMPOTENCY_HEADER = 'Idempotency-Key'
_META_KEY = 'HTTP_IDEMPOTENCY_KEY'
_KEY_PATTERN = re.compile(r'^[A-Za-z0-9\-]{8,64}$')

# A view returning one of these rejected the request before writing anything,
# so the key is freed and the operator can fix the form and resubmit under the
# same key. Every other status is recorded and replayed.
_FREEING_STATUSES = frozenset({
    status.HTTP_400_BAD_REQUEST,
    status.HTTP_403_FORBIDDEN,
})


def idempotent(view_method):
    """Make a DRF POST handler safe to retry under the same Idempotency-Key.

    No header means no change in behaviour — existing clients, open browser
    tabs and the future mobile CRM keep working untouched.
    """

    @functools.wraps(view_method)
    def wrapper(self, request, *args, **kwargs):
        key = request.META.get(_META_KEY)
        if not key:
            return view_method(self, request, *args, **kwargs)

        if not _KEY_PATTERN.match(key):
            return Response(
                {'error': 'invalid_idempotency_key'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        endpoint = request.path[:200]
        try:
            with transaction.atomic():
                record = IdempotencyKey.objects.create(
                    user=request.user, endpoint=endpoint, key=key,
                )
        except IntegrityError:
            return _replay(request.user, endpoint, key)

        return _run_and_record(record, view_method, self, request, args, kwargs)

    return wrapper


def _replay(user, endpoint: str, key: str) -> Response:
    """Return the winner's stored response, or 409 if it is still running."""
    record = IdempotencyKey.objects.filter(
        user=user, endpoint=endpoint, key=key,
    ).first()
    # record is None when the winner was rejected (400/403) and freed the key
    # between our failed INSERT and this read. Telling the client to retry is
    # correct there too.
    if record is None or record.status_code is None:
        return Response(
            {'error': 'idempotency_in_progress'},
            status=status.HTTP_409_CONFLICT,
        )
    body = json.loads(record.response_body) if record.response_body else {}
    logger.info('Idempotent replay: %s %s -> %s', endpoint, key, record.status_code)
    return Response(body, status=record.status_code)


def _run_and_record(record, view_method, view, request, args, kwargs) -> Response:
    """Execute the view and persist its outcome against the key."""
    try:
        response = view_method(view, request, *args, **kwargs)
    except Exception:
        # ATOMIC_REQUESTS is off and these views write across several models
        # before they can fail, so a partial write may already be on disk.
        # Keeping the key stops a blind retry from re-running it.
        _record(record, 500, {'error': 'server_error'})
        raise

    if response.status_code in _FREEING_STATUSES:
        record.delete()
        return response

    if response.status_code >= 500:
        _record(record, response.status_code, {'error': 'server_error'})
        return response

    _record(record, response.status_code, response.data)
    return response


def _record(record, status_code: int, body) -> None:
    """Persist the outcome, never masking the caller's own exception."""
    try:
        record.status_code = status_code
        # default=str renders Decimal and date the way DRF's JSON renderer
        # would, so a replayed body matches the original.
        record.response_body = json.dumps(body, default=str)
        record.save(update_fields=['status_code', 'response_body'])
    except Exception:
        logger.exception('Failed to record idempotency outcome for key %s', record.key)
