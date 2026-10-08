"""Tell Planning a free trip does not suit us (contract TripRejection).

The rejection stays on the trip until Planning swaps the truck, trailer or
driver, or cancels the trip (trip_sync._upsert clears it). It can be sent again
only while its push failed (Planning never got the reason).
"""
from django.db import transaction
from django.utils import timezone

from apps.core.models import User
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_push import enqueue_rejection
from apps.transport.services.trip_push_ops import is_rejection_error

REJECTION_REASON_MAX = ExternalTrip._meta.get_field('rejection_reason').max_length


class RejectionError(ValueError):
    """A refused rejection; `code` is the API error key, `http_status` 400 or 409."""

    def __init__(self, code: str, http_status: int):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


def _clean_reason(reason: object) -> str:
    """The stripped reason, or RejectionError when it is not text, empty or too long."""
    text = reason.strip() if isinstance(reason, str) else ''
    if not text:
        raise RejectionError('reason_required', 400)
    if len(text) > REJECTION_REASON_MAX:
        raise RejectionError('reason_too_long', 400)
    return text


def reject_trip(trip: ExternalTrip, reason: object, user: User) -> None:
    """Mark a free, open trip rejected and send the reason to Planning once.

    `reason` is the raw request value. A rejected trip is rejected again only
    when its last push failed: Planning has not got the reason yet.
    """
    reason = _clean_reason(reason)
    with transaction.atomic():
        trip = ExternalTrip.objects.select_for_update().get(pk=trip.pk)
        if trip.status in ExternalTrip.CLOSED_STATUSES:
            raise RejectionError('trip_closed', 409)
        if trip.shipment_id:
            raise RejectionError('trip_linked', 409)
        if trip.rejected_at and not is_rejection_error(trip.last_push_error):
            raise RejectionError('trip_rejected', 409)
        trip.rejection_reason, trip.rejected_at, trip.rejected_by = reason, timezone.now(), user
        trip.save(update_fields=list(ExternalTrip.REJECTION_FIELDS))
        enqueue_rejection(trip, reason)
