"""KPI dashboard endpoints.

Four read-only endpoints exposing operational KPIs derived from the Task
and Shipment models. All endpoints require authentication; no role
restriction (the Boss Dashboard reads these, but other roles may also
use them in future reporting screens).

URL prefix: /api/v1/export/kpi/
  GET /api/v1/export/kpi/dashboard/         — full grid (7 KPIs), 60s cache
  GET /api/v1/export/kpi/by-role/?role=X    — role-scoped on_time + avg_duration, 60s
  GET /api/v1/export/kpi/by-phase/          — avg_phase_time map, 5min cache
  GET /api/v1/export/kpi/by-shipment/:id/  — per-shipment phase context, 60s
"""
import logging

from django.core.cache import cache
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.export.services.kpi import (
    kpi_avg_phase_time,
    kpi_avg_task_duration,
    kpi_blocked_age,
    kpi_cycle_time,
    kpi_on_time_rate,
    kpi_stuck_shipments,
    kpi_throughput,
)

logger = logging.getLogger(__name__)

_CACHE_TTL = 60  # seconds


class KpiViewSet(viewsets.ViewSet):
    """Read-only KPI aggregation viewset.

    All four endpoints are GET-only, cache-backed, and require
    IsAuthenticated. No role restriction.
    """

    permission_classes = [IsAuthenticated]

    # ------------------------------------------------------------------
    # dashboard — full 7-KPI grid
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='dashboard')
    def dashboard(self, request) -> Response:
        """Return the full KPI grid for the Boss Dashboard.

        GET /api/v1/export/kpi/dashboard/

        Cached for 60 seconds. Includes:
          - throughput (7-day window)
          - cycle_time (30-day window)
          - avg_phase_time (30-day window)
          - on_time_rate (no role filter, 7-day window)
          - avg_task_duration (no role filter, 7-day window)
          - stuck_shipments (8-day threshold)
          - blocked_age
        """
        cache_key = 'kpi:dashboard:full'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        data = {
            'throughput': kpi_throughput(window_days=7),
            'cycle_time': kpi_cycle_time(window_days=30),
            'avg_phase_time': kpi_avg_phase_time(window_days=30),
            'on_time_rate': kpi_on_time_rate(window_days=7),
            'avg_task_duration': kpi_avg_task_duration(window_days=7),
            'stuck_shipments': kpi_stuck_shipments(threshold_days=8),
            'blocked_age': kpi_blocked_age(),
        }
        cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # by-role — on_time_rate + avg_task_duration for a specific role
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='by-role')
    def by_role(self, request) -> Response:
        """Return role-scoped KPIs: on_time_rate and avg_task_duration.

        GET /api/v1/export/kpi/by-role/?role=sales_rep

        Required query param: ?role=<assignee_role>
        Returns 400 if role is missing or empty.
        Cached for 60 seconds per role.
        """
        role = request.query_params.get('role', '').strip()
        if not role:
            return Response({'error': 'role query param is required'}, status=400)

        cache_key = f'kpi:by_role:{role}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        data = {
            'role': role,
            'on_time_rate': kpi_on_time_rate(role=role, window_days=7),
            'avg_task_duration': kpi_avg_task_duration(role=role, window_days=7),
            'window_days': 7,
        }
        cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # by-phase — avg_phase_time map only
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='by-phase')
    def by_phase(self, request) -> Response:
        """Return average phase durations.

        GET /api/v1/export/kpi/by-phase/

        Cached for 5 minutes (shared with kpi_avg_phase_time internal cache).
        Optional ?window_days=<N> param (default 30).
        """
        try:
            window_days = int(request.query_params.get('window_days', 30))
        except (TypeError, ValueError):
            window_days = 30

        return Response({
            'window_days': window_days,
            'avg_phase_time': kpi_avg_phase_time(window_days=window_days),
        })

    # ------------------------------------------------------------------
    # by-shipment — per-shipment phase context
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='by-shipment/(?P<shipment_id>[0-9]+)')
    def by_shipment(self, request, shipment_id=None) -> Response:
        """Return per-shipment KPI context: in_phase_seconds and phase_avg_seconds.

        GET /api/v1/export/kpi/by-shipment/{id}/

        Thin wrapper around the same data already available on the shipment
        detail endpoint (ShipmentDetailSerializer.get_in_phase_seconds and
        get_phase_avg_seconds). Cached for 60 seconds per shipment.

        Returns 404 if shipment not found.
        """
        from django.db.models import Prefetch
        from apps.export.models import Shipment, ShipmentStatusLog
        from apps.export.services.phases import get_phase, resolve_phase_entry
        from django.utils import timezone as _tz

        cache_key = f'kpi:by_shipment:{shipment_id}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            shipment = (
                Shipment.objects
                .select_related('status', 'season')
                .prefetch_related(
                    Prefetch(
                        'status_log',
                        queryset=ShipmentStatusLog.objects.select_related('status').order_by('-changed_at'),
                    )
                )
                .get(pk=shipment_id)
            )
        except Shipment.DoesNotExist:
            return Response({'error': 'Shipment not found'}, status=404)

        phase_entry = resolve_phase_entry(shipment)
        in_phase_seconds = (
            int((_tz.now() - phase_entry).total_seconds())
            if phase_entry is not None
            else 0
        )

        # Reuse the cached per-status average from kpi_avg_phase_time
        phase_avgs = kpi_avg_phase_time(window_days=30)
        current_phase = get_phase(shipment.status.code if shipment.status_id else None)
        phase_avg_seconds = phase_avgs.get(current_phase)

        data = {
            'shipment_id': shipment.id,
            'cargo_code': shipment.cargo_code,
            'phase': current_phase,
            'in_phase_seconds': in_phase_seconds,
            'phase_avg_seconds': phase_avg_seconds,
            'status_changed_at': (
                shipment.status_changed_at.isoformat()
                if shipment.status_changed_at
                else None
            ),
        }
        cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)
