"""Truck Board API: Planning trips and their link to shipments (spec §10)."""
from collections.abc import Callable

from django.http import HttpResponse
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import DynamicResourcePermission
from apps.core.seasons import SeasonClosedError, resolve_season
from apps.export.models import Shipment
from apps.transport.models import ExternalTrip, ExternalTripSyncState
from apps.transport.permissions import CanAssignTrips, CanViewTruckBoard
from apps.transport.serializers_trips import CandidateShipmentSerializer, ExternalTripSerializer
from apps.transport.services.matching import device_for_plate
from apps.transport.services.trip_assignment import AssignmentError, assign_trip, move_trip, unassign_trip
from apps.transport.services.trip_changes import accept_trip_change
from apps.transport.services.trips_client import TripsApiUnavailable, get_trips_client


def _positions_by_plate(trips: list[ExternalTrip]) -> dict:
    positions = {}
    for trip in trips:
        device = device_for_plate(trip.tractor_plate)
        position = getattr(device, 'position', None) if device else None
        if position is not None and position.valid:
            positions[trip.tractor_plate] = position
    return positions


def _trip_payload(trip: ExternalTrip) -> dict:
    trip = ExternalTrip.objects.select_related('shipment').get(pk=trip.pk)
    return ExternalTripSerializer(trip, context={'positions': _positions_by_plate([trip])}).data


def _error(code: str, http_status: int) -> Response:
    return Response({'error': code}, status=http_status)


class ExternalTripViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Trips mirrored from Planning. Reads need the Truck Board page; writes need shipment_assign edit."""

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
        if params.get('date'):
            qs = qs.filter(planned_departure=params['date'])
        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action in ('list', 'retrieve'):
            trips = [self.get_object()] if self.action == 'retrieve' else list(self.get_queryset())
            context['positions'] = _positions_by_plate(trips)
        return context

    def _run(self, action_fn: Callable[[ExternalTrip], None]) -> Response:
        """Run one link action and map its refusals to the contract error shape."""
        trip = self.get_object()
        try:
            action_fn(trip)
        except AssignmentError as exc:
            return _error(exc.code, status.HTTP_409_CONFLICT)
        except SeasonClosedError:
            return _error('season_closed', status.HTTP_409_CONFLICT)
        return Response(_trip_payload(trip))

    def _target(self, request: Request) -> Shipment | Response:
        shipment_id = request.data.get('shipment_id')
        if not shipment_id:
            return _error('shipment_id_required', status.HTTP_400_BAD_REQUEST)
        shipment = Shipment.objects.select_related('status', 'country').filter(pk=shipment_id).first()
        return shipment or _error('shipment_not_found', status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['get'])
    def document(self, request, pk=None):
        trip = self.get_object()
        try:
            pdf = get_trips_client().get_document(str(trip.integration_trip_id))
        except TripsApiUnavailable as exc:
            code = 'no_documents' if exc.status_code == 404 else 'planning_unavailable'
            return _error(code, status.HTTP_502_BAD_GATEWAY)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="trip-{trip.integration_trip_id}.pdf"'
        return response

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        shipment = self._target(request)
        if isinstance(shipment, Response):
            return shipment
        confirm = bool(request.data.get('confirm_unknown_country'))
        return self._run(lambda trip: assign_trip(trip, shipment, request.user, confirm_unknown_country=confirm))

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        shipment = self._target(request)
        if isinstance(shipment, Response):
            return shipment
        confirm = bool(request.data.get('confirm_unknown_country'))
        return self._run(lambda trip: move_trip(trip, shipment, request.user, confirm_unknown_country=confirm))

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        return self._run(lambda trip: unassign_trip(trip, request.user))

    @action(detail=True, methods=['post'], url_path='accept-change')
    def accept_change(self, request, pk=None):
        return self._run(lambda trip: accept_trip_change(trip, request.user))

    @action(detail=False, methods=['get'], url_path='sync-state')
    def sync_state(self, request):
        state = ExternalTripSyncState.load()
        return Response({
            'last_success_at': state.last_success_at, 'last_error': state.last_error,
            'is_mock': get_trips_client().is_mock,
        })

    @action(detail=False, methods=['get'], url_path='candidate-shipments')
    def candidate_shipments(self, request):
        # Scoped like every other shipment list: ?season=<id>, else the active season.
        shipments = (
            Shipment.objects.filter(
                season=resolve_season(request), status__code='draft', is_gapy_satys=False, trip_id__isnull=True,
            )
            .select_related('country', 'customer', 'import_firm', 'loading_location', 'city')
            .prefetch_related('block_sources__block', 'firm_splits__export_firm')
            .order_by('date', 'id')
        )
        return Response(CandidateShipmentSerializer(shipments, many=True).data)


class ShipmentTripView(APIView):
    """GET /transport/shipments/{id}/trip/ — the Planning trip on one shipment.

    Gated like the shipment itself (`shipment` resource, view): the payload
    carries driver passport, phone and the truck's live position. The Truck
    Board page permission gates only the board.
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'shipment'

    def get(self, request: Request, shipment_id: int) -> Response:
        trip = ExternalTrip.objects.filter(shipment_id=shipment_id).first()
        if trip is None:
            return _error('no_trip', status.HTTP_404_NOT_FOUND)
        return Response(_trip_payload(trip))
