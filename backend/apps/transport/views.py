from django.shortcuts import get_object_or_404
from rest_framework import filters, mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.export.models import Shipment
from apps.transport.models import (
    DevicePosition, Driver, TraccarDevice, ShipmentDeviceLink, Trailer, TruckHead,
)
from apps.transport.permissions import CanEditFleet, CanEditShipment, CanViewFleetMap
from apps.transport.serializers import (
    DriverSerializer, LivePositionSerializer, TrailerSerializer, TransportDeviceSerializer,
    TruckHeadSerializer,
)
from apps.transport.services.matching import resolve_device_for_shipment


class LivePositionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Latest position per device, served from our DB (never Traccar live)."""

    serializer_class = LivePositionSerializer
    # The only endpoint the Fleet Map page reads, so the only one the seller's
    # exclusion from that page (owner request, 2026-08-23) has to be enforced on.
    permission_classes = [IsAuthenticated, CanViewFleetMap]
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
                DevicePosition.objects.filter(device=device, valid=True)
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


class TruckHeadViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                       mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Fleet tractors — list (active) for pickers, create (inline/admin), update/deactivate."""

    serializer_class = TruckHeadSerializer
    pagination_class = None
    filter_backends = [filters.SearchFilter]
    search_fields = ['plate_number', 'owner_name']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAuthenticated(), CanEditFleet()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = TruckHead.objects.all().order_by('plate_number')
        include_inactive = self.request.query_params.get('include_inactive') == 'true'
        if self.action == 'list' and not include_inactive:
            qs = qs.filter(is_active=True)   # pickers show active only
        return qs


class DriverViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                    mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Driver registry — list (active) for pickers, create/update/deactivate for admin.

    Same shape as TrailerViewSet. No destroy: `Shipment.driver_id` is a loose
    integer with no FK to protect it, so a deleted row would leave dangling
    references — deactivate instead.
    """

    serializer_class = DriverSerializer
    pagination_class = None
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'phone']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAuthenticated(), CanEditFleet()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = Driver.objects.all().order_by('name')
        include_inactive = self.request.query_params.get('include_inactive') == 'true'
        if self.action == 'list' and not include_inactive:
            qs = qs.filter(is_active=True)
        return qs


class TrailerViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                     mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Fleet trailers — list (active) for pickers, create (inline/admin), update/deactivate."""

    serializer_class = TrailerSerializer
    pagination_class = None
    filter_backends = [filters.SearchFilter]
    search_fields = ['plate_number']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAuthenticated(), CanEditFleet()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = Trailer.objects.all().order_by('plate_number')
        include_inactive = self.request.query_params.get('include_inactive') == 'true'
        if self.action == 'list' and not include_inactive:
            qs = qs.filter(is_active=True)
        return qs
