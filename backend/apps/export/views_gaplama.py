"""GET /api/v1/export/gaplama/board/ — the Gaplama board (see services/gaplama.py)."""
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.seasons import resolve_season
from apps.export.permissions import CanViewTirGaplama
from apps.export.services.gaplama import build_gaplama_board

MAX_WINDOW_DAYS = 31

_DAY_DECIMAL_FIELDS = ('plan_kg', 'loaded_kg', 'carried_in_kg', 'available_kg', 'over_kg')


def _stringify_decimals(board: dict) -> dict:
    """Coerce Decimal weights to str for JSON output (api-contract: decimals as strings).

    DRF's default JSONEncoder renders Decimal as a JSON number (float(obj)), not a
    string — verified empirically, not an assumption. build_gaplama_board() returns raw
    Decimal values (it has no serializer of its own), so this view stringifies them at
    the boundary, matching the existing str(...) pattern in views_harvest_forecast.py.
    Does not touch services/gaplama.py.
    """
    for day in board['days']:
        for field in _DAY_DECIMAL_FIELDS:
            day[field] = str(day[field])
    for truck in board['trucks']:
        for source in truck['block_sources']:
            source['weight_kg'] = str(source['weight_kg'])
    return board


class GaplamaBoardView(APIView):
    """GET /api/v1/export/gaplama/board/?from_date=&to_date=[&season=]

    Response 200: {"days": [...], "trucks": [...]} — see build_gaplama_board's docstring.
    Response 400: bad/missing/inverted dates, or a window over 31 days.
    Response 403: missing tir_takip.gaplama or export.plan.
    Response 404: unknown season id.
    """

    permission_classes = [IsAuthenticated, CanViewTirGaplama]

    def get(self, request: Request) -> Response:
        from_str = request.query_params.get('from_date')
        to_str = request.query_params.get('to_date')
        if not from_str or not to_str:
            return Response(
                {'error': 'from_date and to_date are required (YYYY-MM-DD).'}, status=400,
            )

        from datetime import date as _date
        try:
            from_date = _date.fromisoformat(from_str)
            to_date = _date.fromisoformat(to_str)
        except ValueError:
            return Response({'error': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)

        if from_date > to_date:
            return Response({'error': 'from_date must not be after to_date.'}, status=400)
        if (to_date - from_date).days > MAX_WINDOW_DAYS:
            return Response(
                {'error': f'Window may not exceed {MAX_WINDOW_DAYS} days.'}, status=400,
            )

        # resolve_season() itself raises NotFound (unknown season id) or
        # PermissionDenied (closed season without closed_season.can_view) — DRF's
        # default exception handler converts those to 404/403 automatically, so
        # nothing extra is needed here. It returns None only during the
        # close→open gap (no active season and no ?season= given).
        season = resolve_season(request)
        if season is None:
            return Response({'days': [], 'trucks': []})

        # Clamp to the season — "a default window is not a bound" (api-contract).
        clamped_from = max(from_date, season.start_date)
        clamped_to = min(to_date, season.end_date)
        if clamped_from > clamped_to:
            return Response({'days': [], 'trucks': []})

        board = build_gaplama_board(clamped_from, clamped_to, season)
        return Response(_stringify_decimals(board))
