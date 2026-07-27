"""Team KPI leaderboard endpoint. Public (radical transparency), 60s cache."""
from __future__ import annotations

from django.core.cache import cache
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.services_team_kpi import compute_team_kpi, parse_period

_CACHE_TTL = 60


class TeamKpiView(APIView):
    """GET /api/v1/core/team-kpi/?period=today|week|month|season

    One row per active user, ranked by tasks completed in the window.
    Visible to every authenticated user (no role gate).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request) -> Response:
        try:
            period = parse_period(request.query_params.get('period'))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        cache_key = f'team-kpi:{period}'
        results = cache.get(cache_key)
        if results is None:
            results = compute_team_kpi(period)
            cache.set(cache_key, results, _CACHE_TTL)

        return Response({'period': period, 'results': results})
