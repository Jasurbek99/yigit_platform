"""Main dashboard summary endpoint.

Single GET action at /api/v1/export/dashboard/summary/ that returns
aggregated landing-page data for ALL authenticated users.

Caching: 60 seconds, key 'dashboard:summary'. Cache is invalidated
by server restart or TTL expiry — no explicit invalidation needed
because all data is time-aggregated from live tables.
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
_CACHE_KEY = 'dashboard:summary'


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

        GET /api/v1/export/dashboard/summary/

        Cached for 60 seconds. Returns: season, stats, alerts, routes,
        active_shipments.

        Response shape follows the contract in .claude/rules/api-contract.md
        under '### Dashboard summary'.
        """
        cached = cache.get(_CACHE_KEY)
        if cached is not None:
            return Response(cached)

        data = build_dashboard_summary()
        cache.set(_CACHE_KEY, data, _CACHE_TTL)
        return Response(data)
