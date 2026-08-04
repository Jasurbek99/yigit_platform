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
    """GET /api/v1/core/team-kpi/?period=today|week|month|season&season=<id>

    One row per active user, ranked by tasks completed in the window.
    Visible to every authenticated user (no role gate).

    `?season=<id>` only applies when `period=season` (spec §4.3) — it
    parameterises which season's date range backs the window, the same
    pattern as `dashboard`/`boss`; it is never used to filter the
    leaderboard by a `season=` FK (there is no `SeasonScopedMixin` here).
    Defaults to the active season when omitted. A closed `?season=` needs
    `closed_season.can_view`, same gate as every other scoped endpoint —
    deliberate, not an oversight: "no role gate" means everyone sees the
    same CURRENT leaderboard, not that the closed-season archive is exempt
    from the archive permission the rest of the feature enforces. Browsing
    the default (current) window is completely unaffected either way.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request) -> Response:
        try:
            period = parse_period(request.query_params.get('period'))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        season = None
        if period == 'season':
            from apps.core.seasons import resolve_season
            season = resolve_season(request)

        cache_key = f'team-kpi:{period}:{season.pk if season else "none"}'
        results = cache.get(cache_key)
        if results is None:
            results = compute_team_kpi(period, season)
            cache.set(cache_key, results, _CACHE_TTL)

        return Response({'period': period, 'results': results})
