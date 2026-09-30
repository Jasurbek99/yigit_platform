"""Gate guard endpoint — thin wrapper over services/gate.py.

GET  /api/v1/export/gate/                 — the guard's three lists
POST /api/v1/export/gate/{id}/arrive/     — «Ýyladyşhana geldi»
POST /api/v1/export/gate/{id}/depart/     — «Ýyladyşhanadan çykdy»
POST /api/v1/export/gate/{id}/undo/       — {"event": "arrive" | "depart"}

A guard always works his own User.loading_location; any ?location= he sends
is ignored. Other roles holding the `gate` grant (admin, boss) must send one.
"""
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.core.models import LoadingLocation
from apps.core.permissions import DynamicResourcePermission, resource_edit_permission
from apps.core.roles import GATE_GUARD_ROLE
from apps.core.services import sheet_events
from apps.export.models import Shipment
from apps.export.services import gate
from apps.export.services.gate_tasks import sync_gate_tasks

UNDO_EVENTS = ('arrive', 'depart')


class _LocationError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _location_for(request) -> LoadingLocation:
    user = request.user
    if getattr(user, 'role', None) == GATE_GUARD_ROLE:
        if user.loading_location_id is None:
            raise _LocationError('no_location')
        return user.loading_location
    raw = request.query_params.get('location')
    if not raw:
        raise _LocationError('location_required')
    try:
        return LoadingLocation.objects.get(pk=int(raw))
    except (ValueError, LoadingLocation.DoesNotExist) as exc:
        raise _LocationError('bad_location') from exc


def _error(code: str, http_status: int) -> Response:
    return Response({'error': code}, status=http_status)


class GateViewSet(ViewSet):
    resource_code = 'gate'

    def get_permissions(self):
        if self.action == 'list':
            return [IsAuthenticated(), DynamicResourcePermission()]
        # POSTs edit an existing truck — gate on can_edit, not can_create.
        return [IsAuthenticated(), resource_edit_permission('gate')()]

    def list(self, request):
        try:
            location = _location_for(request)
        except _LocationError as exc:
            return _error(exc.code, status.HTTP_400_BAD_REQUEST)
        sync_gate_tasks(location)
        now = timezone.now()
        return Response({
            'location': {'id': location.pk, 'name': location.name},
            'expected': [gate.gate_row(s, now=now) for s in gate.expected(location)],
            'inside': [gate.gate_row(s, 'arrive', now) for s in gate.inside(location)],
            'recently_left': [
                gate.gate_row(s, 'depart', now) for s in gate.recently_left(location, now)
            ],
        })

    @action(detail=True, methods=['post'])
    def arrive(self, request, pk=None):
        return self._act(request, pk, 'arrive', lambda sid, loc: gate.arrive(sid, loc, request.user))

    @action(detail=True, methods=['post'])
    def depart(self, request, pk=None):
        return self._act(request, pk, 'depart', lambda sid, loc: gate.depart(sid, loc, request.user))

    @action(detail=True, methods=['post'])
    def undo(self, request, pk=None):
        event = request.data.get('event')
        if event not in UNDO_EVENTS:
            return _error('bad_event', status.HTTP_400_BAD_REQUEST)
        # After undoing a departure the truck is inside again and its arrival
        # may still be undoable; after undoing an arrival it is back in
        # Gelmeli, where nothing is undoable (final-fix review F7).
        undo_event = 'arrive' if event == 'depart' else None
        return self._act(request, pk, undo_event, lambda sid, loc: gate.undo(sid, loc, request.user, event))

    def finalize_response(self, request, response, *args, **kwargs):
        """Tell open Sheet tabs a gate mark happened (final-fix review F1).

        Mirrors ShipmentViewSet.finalize_response (views.py): poke_sheet()
        itself drops anything that is not a successful write, so GET /gate/
        is a no-op here for free.
        """
        response = super().finalize_response(request, response, *args, **kwargs)
        pk = self.kwargs.get('pk')
        ids = [int(pk)] if pk is not None and str(pk).isdigit() else []
        sheet_events.poke_sheet(request, response, ids)
        return response

    def _act(self, request, pk, undo_event, run) -> Response:
        try:
            location = _location_for(request)
        except _LocationError as exc:
            return _error(exc.code, status.HTTP_400_BAD_REQUEST)
        try:
            shipment_id = int(pk)
        except (TypeError, ValueError):
            return _error('not_found', status.HTTP_404_NOT_FOUND)
        try:
            shipment = run(shipment_id, location)
        except Shipment.DoesNotExist:
            return _error('not_found', status.HTTP_404_NOT_FOUND)
        except gate.GateError as exc:
            return _error(exc.code, status.HTTP_409_CONFLICT)
        return Response(gate.gate_row(shipment, undo_event))
