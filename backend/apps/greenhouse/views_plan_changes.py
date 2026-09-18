"""Plan change requests — the in-week revision queue and log (ADR-024)."""
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.core.permissions import SeasonNotClosed
from apps.core.seasons import SeasonScopedMixin
from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.serializers import PlanChangeRequestSerializer
from apps.greenhouse.services.plan_change_service import approve_plan_change, reject_plan_change


class PlanChangeRequestViewSet(SeasonScopedMixin, ReadOnlyModelViewSet):
    """
    GET  /api/v1/greenhouse/plan-change-requests/?status=&year=&week=&block=&season=
    GET  /api/v1/greenhouse/plan-change-requests/{id}/
    POST /api/v1/greenhouse/plan-change-requests/{id}/approve/   body {"note": "..."} (optional)
    POST /api/v1/greenhouse/plan-change-requests/{id}/reject/    body {"note": "..."} (optional)

    Reads are open to any authenticated user, like day-entries. Deciding is
    export_manager / admin / boss, enforced in the service.
    """

    permission_classes = [IsAuthenticated, SeasonNotClosed]
    serializer_class = PlanChangeRequestSerializer
    season_field = 'entry__season'
    queryset = PlanChangeRequest.objects.select_related('entry__block', 'requested_by', 'decided_by')

    def get_queryset(self):
        qs = super().get_queryset()
        if getattr(self, 'action', None) == 'list':
            qs = self.apply_season_scope(qs)
        params = self.request.query_params
        if status_filter := params.get('status'):
            qs = qs.filter(status=status_filter)
        if year := params.get('year'):
            qs = qs.filter(entry__weekly_plan__year=year)
        if week := params.get('week'):
            qs = qs.filter(entry__weekly_plan__week_number=week)
        if block := params.get('block'):
            qs = qs.filter(entry__block_id=block)
        return qs

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        return self._decide(approve_plan_change, request)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        return self._decide(reject_plan_change, request)

    def _decide(self, decide, request) -> Response:
        change = self.get_object()
        try:
            decide(change, request.user, request.data.get('note', ''))
        except PermissionError as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(change).data)
