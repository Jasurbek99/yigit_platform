"""Tell Planning a free trip does not suit us (contract TripRejection).

The rejection stays on the trip until Planning swaps the truck, trailer or
driver, or cancels the trip (trip_sync._upsert clears it).
"""
from django.db import transaction
from django.utils import timezone

from apps.core.models import User
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_assignment import AssignmentError
from apps.transport.services.trip_push import enqueue_rejection

REJECTION_REASON_MAX = 512


def reject_trip(trip: ExternalTrip, reason: str, user: User) -> None:
    """Mark a free, open trip rejected and send the reason to Planning once."""
    with transaction.atomic():
        trip = ExternalTrip.objects.select_for_update().get(pk=trip.pk)
        if trip.status in ExternalTrip.CLOSED_STATUSES:
            raise AssignmentError('trip_closed')
        if trip.shipment_id:
            raise AssignmentError('trip_linked')
        trip.rejection_reason, trip.rejected_at, trip.rejected_by = reason, timezone.now(), user
        trip.save(update_fields=list(ExternalTrip.REJECTION_FIELDS))
        enqueue_rejection(trip, reason)
