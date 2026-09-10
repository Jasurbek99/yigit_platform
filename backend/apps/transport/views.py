from django.db.models import Count
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.export.models import Shipment
from apps.transport.models import (
    DevicePosition, Driver, DriverDocument, TraccarDevice, ShipmentDeviceLink,
    Trailer, TruckHead, TruckHeadDocument,
)
from apps.transport.permissions import (
    CanAccessFleetDocuments, CanEditFleet, CanEditShipment, CanViewFleetMap,
    can_edit_fleet,
)
from apps.transport.serializers import (
    DriverAdminSerializer, DriverDocumentSerializer, DriverSerializer,
    LivePositionSerializer, TrailerSerializer, TransportDeviceSerializer,
    TruckHeadDocumentSerializer, TruckHeadSerializer,
)
from apps.transport.services.files import (
    MAX_FILES_PER_RECORD, detect_mime, sanitise_filename, validate_fleet_document,
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
        if self.action in ('documents', 'delete_document', 'download_document'):
            return [IsAuthenticated(), CanAccessFleetDocuments()]
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAuthenticated(), CanEditFleet()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = TruckHead.objects.annotate(
            document_count_annotated=Count('documents'),
        ).order_by('plate_number')
        include_inactive = self.request.query_params.get('include_inactive') == 'true'
        if self.action == 'list' and not include_inactive:
            qs = qs.filter(is_active=True)   # pickers show active only
        return qs

    @action(detail=True, methods=['get', 'post'], url_path='documents')
    def documents(self, request, pk=None):
        """List this tractor's tech passport scans, or upload one or more.

        Multipart files are read from the ``files`` form key, so a single
        request can carry every page. Every file is validated (size, .jpg/.pdf
        extension, magic bytes) before any row is written — a half-accepted
        upload would leave the operator guessing which page landed. Returns the
        truck's full document list either way.
        """
        truck_head = self.get_object()
        if request.method == 'GET':
            return Response(
                TruckHeadDocumentSerializer(truck_head.documents.all(), many=True).data
            )

        files = request.FILES.getlist('files')
        if not files:
            return Response({'error': 'No files provided.'}, status=400)

        existing = truck_head.documents.count()
        if existing + len(files) > MAX_FILES_PER_RECORD:
            return Response(
                {'error': f'Maximum {MAX_FILES_PER_RECORD} documents allowed per truck.'},
                status=400,
            )

        for f in files:
            validate_fleet_document(f)

        created = [
            TruckHeadDocument.objects.create(
                truck_head=truck_head,
                file=f,
                original_filename=sanitise_filename(f.name),
                # The file's own magic bytes, not the browser's Content-Type —
                # the download action serves this value straight back.
                mime_type=detect_mime(f),
                size_bytes=f.size,
                uploaded_by=request.user,
            )
            for f in files
        ]
        return Response(TruckHeadDocumentSerializer(created, many=True).data, status=201)

    @action(
        detail=True,
        methods=['delete'],
        url_path='documents/(?P<doc_id>[0-9]+)',
    )
    def delete_document(self, request, pk=None, doc_id=None):
        """Delete one tech passport scan, file and row together."""
        truck_head = self.get_object()
        document = truck_head.documents.filter(pk=doc_id).first()
        if document is None:
            return Response({'error': 'Document not found.'}, status=404)

        document.file.delete(save=False)
        document.delete()
        return Response(status=204)

    @action(
        detail=True,
        methods=['get'],
        url_path='documents/(?P<doc_id>[0-9]+)/download',
    )
    def download_document(self, request, pk=None, doc_id=None):
        """Stream one tech passport scan inline, for preview in a new tab."""
        truck_head = self.get_object()
        document = truck_head.documents.filter(pk=doc_id).first()
        if document is None:
            return Response({'error': 'Document not found.'}, status=404)

        return FileResponse(
            document.file.open('rb'),
            content_type=document.mime_type or 'application/octet-stream',
            as_attachment=False,
            filename=document.original_filename,
        )


class DriverViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                    mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Driver registry — list (active) for pickers, create/update/deactivate for admin.

    Same shape as TrailerViewSet. No destroy: `Shipment.driver_id` is a loose
    integer with no FK to protect it, so a deleted row would leave dangling
    references — deactivate instead.
    """

    pagination_class = None
    filter_backends = [filters.SearchFilter]

    @property
    def search_fields(self):
        """Passport serial is searchable only by the roles allowed to read it.

        Leaving it in the shared list would hand back the oracle the split
        serializer exists to close: a picker user could type a serial and read
        the matching driver's name out of the response.
        """
        fields = ['name', 'phone']
        if can_edit_fleet(getattr(self, 'request', None) and self.request.user):
            fields.append('passport_serial')
        return fields

    def get_serializer_class(self):
        # Passport identity only for the people who maintain the catalog. The
        # pickers on the Sheet and the shipment drawer read this same route.
        if can_edit_fleet(self.request.user):
            return DriverAdminSerializer
        return DriverSerializer

    def get_permissions(self):
        if self.action in ('documents', 'delete_document', 'download_document'):
            return [IsAuthenticated(), CanAccessFleetDocuments()]
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAuthenticated(), CanEditFleet()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = Driver.objects.annotate(
            document_count_annotated=Count('documents'),
        ).order_by('name')
        include_inactive = self.request.query_params.get('include_inactive') == 'true'
        if self.action == 'list' and not include_inactive:
            qs = qs.filter(is_active=True)
        return qs

    @action(detail=True, methods=['get', 'post'], url_path='documents')
    def documents(self, request, pk=None):
        """List this driver's passport scans, or upload one or more.

        Multipart files are read from the ``files`` form key, so a single
        request can carry both passport pages. Every file is validated (size,
        .jpg/.pdf extension, magic bytes) before any row is written — a
        half-accepted upload would leave the operator guessing which page landed.
        Returns the driver's full document list either way.
        """
        driver = self.get_object()
        if request.method == 'GET':
            return Response(
                DriverDocumentSerializer(driver.documents.all(), many=True).data
            )

        files = request.FILES.getlist('files')
        if not files:
            return Response({'error': 'No files provided.'}, status=400)

        existing = driver.documents.count()
        if existing + len(files) > MAX_FILES_PER_RECORD:
            return Response(
                {'error': f'Maximum {MAX_FILES_PER_RECORD} documents allowed per driver.'},
                status=400,
            )

        for f in files:
            validate_fleet_document(f)

        created = [
            DriverDocument.objects.create(
                driver=driver,
                file=f,
                original_filename=sanitise_filename(f.name),
                # The file's own magic bytes, not the browser's Content-Type —
                # the download action serves this value straight back.
                mime_type=detect_mime(f),
                size_bytes=f.size,
                uploaded_by=request.user,
            )
            for f in files
        ]
        return Response(DriverDocumentSerializer(created, many=True).data, status=201)

    @action(
        detail=True,
        methods=['delete'],
        url_path='documents/(?P<doc_id>[0-9]+)',
    )
    def delete_document(self, request, pk=None, doc_id=None):
        """Delete one passport scan, file and row together."""
        driver = self.get_object()
        document = driver.documents.filter(pk=doc_id).first()
        if document is None:
            return Response({'error': 'Document not found.'}, status=404)

        document.file.delete(save=False)
        document.delete()
        return Response(status=204)

    @action(
        detail=True,
        methods=['get'],
        url_path='documents/(?P<doc_id>[0-9]+)/download',
    )
    def download_document(self, request, pk=None, doc_id=None):
        """Stream one passport scan inline, for preview in a new tab."""
        driver = self.get_object()
        document = driver.documents.filter(pk=doc_id).first()
        if document is None:
            return Response({'error': 'Document not found.'}, status=404)

        return FileResponse(
            document.file.open('rb'),
            content_type=document.mime_type or 'application/octet-stream',
            as_attachment=False,
            filename=document.original_filename,
        )


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
