"""Main dashboard summary endpoint.

Single GET action at /api/v1/export/dashboard/summary/ that returns
aggregated landing-page data for ALL authenticated users.

Caching: 60 seconds, key 'dashboard:summary:<season_id|none>' — the resolved
season parameterises `stats`/`routes` (spec §4.3), so it must be part of the
cache key or a season switch would serve another season's stale numbers
within the TTL. Cache is otherwise invalidated by server restart or TTL
expiry — no explicit invalidation needed because all data is time-aggregated
from live tables.
"""
import logging

from django.core.cache import cache
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.export.services.dashboard_summary import build_dashboard_summary

logger = logging.getLogger(__name__)

_CACHE_TTL = 60  # seconds


class DashboardViewSet(viewsets.ViewSet):
    """Read-only landing-page dashboard viewset.

    No role gate — every authenticated user (all 14 roles) sees the
    same data. The intent is a single shared landing page, not an
    executive-only view.
    """

    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request) -> Response:
        """Return main dashboard summary data.

        GET /api/v1/export/dashboard/summary/?season=<id>  (optional;
                                                              defaults to the
                                                              active season)

        Cached for 60 seconds per resolved season. Returns: season, stats,
        alerts, routes, active_shipments. `stats`/`routes` are date-range
        filtered by the resolved season (spec §4.3) — parameterised, not
        `SeasonScopedMixin`-scoped; `in_transit`/`selling` stay LIVE
        regardless of season. A closed `?season=` needs `closed_season.can_view`
        (raises 403 via `resolve_season()`), same as every other scoped
        endpoint — this page is not exempt from that gate the way `boss` is
        exempt from the *scoping* mixin.

        During the close→open gap (no active season, no `?season=`) this
        returns the all-zero/empty payload rather than a substitute date
        range — D7, spec §3.1. The response shape is unchanged, so the
        frontend renders its normal empty states plus the "no active season"
        banner.

        Response shape follows the contract in .claude/rules/api-contract.md
        under '### Dashboard summary'.
        """
        from apps.core.seasons import resolve_season

        season = resolve_season(request)
        cache_key = f'dashboard:summary:{season.pk if season else "none"}'

        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        data = build_dashboard_summary(season)
        cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)
