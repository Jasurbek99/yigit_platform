from django.http import HttpResponse
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.export.models import Shipment
from apps.transport.models import ExternalTrip, ExternalTripSyncState
from apps.transport.permissions import CanAssignTrips, CanViewTruckBoard
from apps.transport.serializers_trips import CandidateShipmentSerializer, ExternalTripSerializer
from apps.transport.services.matching import device_for_plate
from apps.transport.services.trip_assignment import (
    AssignmentError, accept_trip_change, assign_trip, move_trip, unassign_trip,
)
from apps.transport.services.trips_client import TripsApiUnavailable, get_trips_client


def _positions_by_plate(trips) -> dict:
    positions = {}
    for trip in trips:
        device = device_for_plate(trip.tractor_plate)
        position = getattr(device, 'position', None) if device else None
        if position is not None and position.valid:
            positions[trip.tractor_plate] = position
    return positions


class ExternalTripViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ExternalTripSerializer
    permission_classes = [IsAuthenticated, CanViewTruckBoard, CanAssignTrips]
    pagination_class = None

    def get_queryset(self):
        qs = ExternalTrip.objects.select_related('shipment')
        params = self.request.query_params
        if params.get('free') == '1':
            qs = qs.filter(shipment__isnull=True).exclude(status__in=ExternalTrip.CLOSED_STATUSES)
        if params.get('linked') == '1':
            qs = qs.filter(shipment__isnull=False)
        if params.get('country'):
            qs = qs.filter(destination_country_code=params['country'])
        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action in ('list', 'retrieve'):
            trips = [self.get_object()] if self.action == 'retrieve' else list(self.get_queryset())
            context['positions'] = _positions_by_plate(trips)
        return context

    @action(detail=True, methods=['get'])
    def document(self, request, pk=None):
        trip = self.get_object()
        try:
            pdf = get_trips_client().get_document(str(trip.integration_trip_id))
        except TripsApiUnavailable as exc:
            code = 'no_documents' if exc.status_code == 404 else 'planning_unavailable'
            return Response({'error': code}, status=status.HTTP_502_BAD_GATEWAY)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="trip-{trip.integration_trip_id}.pdf"'
        return response

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        trip = self.get_object()
        shipment = Shipment.objects.select_related('status', 'country').get(pk=request.data['shipment_id'])
        try:
            assign_trip(trip, shipment, request.user,
                        confirm_unknown_country=bool(request.data.get('confirm_unknown_country')))
        except AssignmentError as exc:
            return Response({'error': exc.code}, status=status.HTTP_409_CONFLICT)
        return Response(ExternalTripSerializer(ExternalTrip.objects.get(pk=trip.pk)).data)

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        trip = self.get_object()
        try:
            unassign_trip(trip, request.user)
        except AssignmentError as exc:
            return Response({'error': exc.code}, status=status.HTTP_409_CONFLICT)
        return Response(ExternalTripSerializer(ExternalTrip.objects.get(pk=trip.pk)).data)

    @action(detail=True, methods=['post'], url_path='accept-change')
    def accept_change(self, request, pk=None):
        trip = self.get_object()
        accept_trip_change(trip, request.user)
        return Response(ExternalTripSerializer(ExternalTrip.objects.get(pk=trip.pk)).data)

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        trip = self.get_object()
        target = Shipment.objects.select_related('status', 'country').get(pk=request.data['shipment_id'])
        try:
            move_trip(trip, target, request.user,
                      confirm_unknown_country=bool(request.data.get('confirm_unknown_country')))
        except AssignmentError as exc:
            return Response({'error': exc.code}, status=status.HTTP_409_CONFLICT)
        return Response(ExternalTripSerializer(ExternalTrip.objects.get(pk=trip.pk)).data)

    @action(detail=False, methods=['get'], url_path='sync-state')
    def sync_state(self, request):
        state = ExternalTripSyncState.load()
        return Response({
            'last_success_at': state.last_success_at, 'last_error': state.last_error,
            'is_mock': get_trips_client().is_mock,
        })

    @action(detail=False, methods=['get'], url_path='candidate-shipments')
    def candidate_shipments(self, request):
        shipments = (
            Shipment.objects.filter(status__code='draft', is_gapy_satys=False, trip_id__isnull=True)
            .select_related('country', 'customer').prefetch_related('block_sources__block')
            .order_by('date', 'id')
        )
        return Response(CandidateShipmentSerializer(shipments, many=True).data)
