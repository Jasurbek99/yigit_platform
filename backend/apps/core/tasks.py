"""Periodic maintenance for core-owned tables."""

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from apps.core.models import IdempotencyKey

logger = logging.getLogger(__name__)

IDEMPOTENCY_KEY_TTL_HOURS = 24


@shared_task
def purge_expired_idempotency_keys() -> int:
    """Delete idempotency keys past their TTL. Returns the row count."""
    cutoff = timezone.now() - timedelta(hours=IDEMPOTENCY_KEY_TTL_HOURS)
    deleted, _ = IdempotencyKey.objects.filter(created_at__lt=cutoff).delete()
    if deleted:
        logger.info('Purged %d expired idempotency keys', deleted)
    return deleted
