from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from apps.transport.models import DevicePosition
from apps.transport.serializers import LivePositionSerializer


class LivePositionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Latest position per device, served from our DB (never Traccar live)."""

    serializer_class = LivePositionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # small, bounded set (one row per device)

    def get_queryset(self):
        return (
            DevicePosition.objects
            .select_related('device', 'device__truck')
            .order_by('device__name')
        )
