"""Clients Report endpoint — live replacement for the legacy by_clients.xlsx.

URL: GET /api/v1/export/clients-report/

Read-only, 60s cached. Page-level access (analytics.clients) is enforced by the
frontend ProtectedRoute + seeded RolePagePermission, consistent with how the
other analytics pages gate. Server-side we require an authenticated user.
"""
import logging

from django.core.cache import cache
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.seasons import get_active_season
from apps.export.services.clients_report import build_clients_report

logger = logging.getLogger(__name__)

_CACHE_TTL = 60  # seconds — matches frontend staleTime of 60_000 ms


class ClientsReportViewSet(viewsets.ViewSet):
    """Read-only clients dispatch report for the active season."""

    permission_classes = [IsAuthenticated]

    def list(self, request: Request) -> Response:
        """Return the clients report for the active season.

        GET /api/v1/export/clients-report/
        """
        season = get_active_season()
        cache_key = f'clients_report:{season.id if season else "none"}'

        data = cache.get(cache_key)
        if data is None:
            data = build_clients_report(season)
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)
