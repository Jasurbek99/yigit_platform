from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.export.models import Shipment
from apps.transport.models import DevicePosition, TraccarDevice, ShipmentDeviceLink
from apps.transport.permissions import CanEditShipment
from apps.transport.serializers import LivePositionSerializer, TransportDeviceSerializer
from apps.transport.services.matching import resolve_device_for_shipment


class LivePositionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Latest position per device, served from our DB (never Traccar live)."""

    serializer_class = LivePositionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # small, bounded set (one row per device)

    def get_queryset(self):
        return (
            DevicePosition.objects
            .filter(valid=True)
            .select_related('device', 'device__truck')
            .order_by('device__name')
        )


class ShipmentTruckPositionView(APIView):
    """Latest position of the shipment's resolved truck (manual>auto>none)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, shipment_id):
        shipment = get_object_or_404(Shipment, pk=shipment_id)
        device, resolved_by = resolve_device_for_shipment(shipment)
        data = {'resolved_by': resolved_by, 'device': None, 'position': None}
        if device is not None:
            data['device'] = {
                'traccar_id': device.traccar_id,
                'plate': device.truck.plate if device.truck else None,
                'fleet_no': device.truck.fleet_no if device.truck else None,
            }
            pos = (
                DevicePosition.objects.filter(device=device)
                .select_related('device', 'device__truck').first()
            )
            if pos is not None:
                data['position'] = LivePositionSerializer(pos).data
        return Response(data)


class ShipmentDeviceLinkView(APIView):
    """Manual override: PUT sets/replaces, DELETE clears (revert to auto)."""

    permission_classes = [IsAuthenticated, CanEditShipment]

    def put(self, request, shipment_id):
        shipment = get_object_or_404(Shipment, pk=shipment_id)
        device = get_object_or_404(TraccarDevice, traccar_id=request.data.get('traccar_id'))
        ShipmentDeviceLink.objects.update_or_create(
            shipment=shipment, defaults={'device': device, 'created_by': request.user},
        )
        return Response({'ok': True})

    def delete(self, request, shipment_id):
        ShipmentDeviceLink.objects.filter(shipment_id=shipment_id).delete()
        return Response(status=204)


class TransportDeviceViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """All registry devices for the override picker."""

    permission_classes = [IsAuthenticated]
    pagination_class = None
    serializer_class = TransportDeviceSerializer

    def get_queryset(self):
        return TraccarDevice.objects.select_related('truck').order_by('name')
