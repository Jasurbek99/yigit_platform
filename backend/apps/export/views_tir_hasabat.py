"""Tır Takip Hasabat endpoint — the sera-design report tab, from live data.

URL: GET /api/v1/export/tir-hasabat/[?season=<id>]

Read-only, 60s cached per season. Gated server-side on the
`tir_takip.hasabat` + `analytics.clients` page codes (`CanViewTirHasabat`).
"""
from django.core.cache import cache
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.seasons import resolve_season
from apps.export.permissions import CanViewTirHasabat
from apps.export.services.tir_hasabat import build_tir_hasabat

_CACHE_TTL = 60  # seconds — matches the frontend staleTime


class TirHasabatViewSet(viewsets.ViewSet):
    """Aggregated truck report for the resolved season."""

    permission_classes = [CanViewTirHasabat]

    def list(self, request: Request) -> Response:
        season = resolve_season(request)
        cache_key = f'tir_hasabat:{season.id if season else "none"}'

        data = cache.get(cache_key)
        if data is None:
            data = build_tir_hasabat(season)
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)
