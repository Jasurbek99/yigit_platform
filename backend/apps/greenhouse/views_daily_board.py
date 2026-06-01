"""Daily harvest board endpoint — backs the *Ýük plan we galyndy* page.

GET  /api/v1/greenhouse/daily-plan/?date=YYYY-MM-DD
    One row per active block for the given date (default: today). Blocks with
    no entry yet return null values so the whole block list always renders.

POST /api/v1/greenhouse/daily-plan/
    Upsert one block/date cell. Body: {block, date, today_plan?, yesterday_rest?, note?}.
    Only the keys present are written. Any authenticated user with page access
    may write — there are no role/window gates (see services.daily_board).
"""
from decimal import Decimal

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.core.models import GreenhouseBlock
from apps.greenhouse.models import HarvestDayEntry
from apps.greenhouse.services.daily_board import (
    UNSET,
    get_active_season,
    upsert_daily_board,
)


def _kg_str(value: Decimal | None) -> str | None:
    """Serialise a Decimal kg value to a plain string (or None)."""
    return None if value is None else str(value)


def _entered_by_name(entry: HarvestDayEntry) -> str | None:
    user = entry.daily_entered_by
    if user is None:
        return None
    full_name = f'{user.first_name} {user.last_name}'.strip()
    return full_name or user.username


def _build_row(block: GreenhouseBlock, entry: HarvestDayEntry | None, entry_date) -> dict:
    """Assemble a single board row for a block (entry may be None = no data yet)."""
    rest = entry.yesterday_rest_value if entry else None
    plan = entry.forecast_value if entry else None

    total: Decimal | None = None
    if rest is not None or plan is not None:
        total = (rest or Decimal('0')) + (plan or Decimal('0'))

    return {
        'block': block.id,
        'block_code': block.code,
        'block_name': block.name,
        'entry_id': entry.id if entry else None,
        'entry_date': entry_date.isoformat(),
        'yesterday_rest': _kg_str(rest),
        'today_plan': _kg_str(plan),
        'total': _kg_str(total),
        'note': entry.daily_note if entry else '',
        'entered_at': entry.daily_entered_at.isoformat() if entry and entry.daily_entered_at else None,
        'entered_by_name': _entered_by_name(entry) if entry else None,
    }


class DailyHarvestBoardViewSet(ViewSet):
    """Per-block daily harvest board (yesterday's rest + today's plan)."""

    permission_classes = [IsAuthenticated]

    def list(self, request):
        date_str = request.query_params.get('date')
        entry_date = parse_date(date_str) if date_str else timezone.localdate()
        if entry_date is None:
            return Response(
                {'error': 'Invalid date — expected YYYY-MM-DD.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        season = get_active_season()
        blocks = list(GreenhouseBlock.objects.filter(is_active=True).order_by('code'))

        entries: dict[int, HarvestDayEntry] = {}
        if season is not None:
            qs = HarvestDayEntry.objects.filter(
                season=season, entry_date=entry_date,
            ).select_related('daily_entered_by')
            entries = {e.block_id: e for e in qs}

        results = [_build_row(b, entries.get(b.id), entry_date) for b in blocks]

        return Response({
            'date': entry_date.isoformat(),
            'season': {'id': season.id, 'name': season.name} if season else None,
            'results': results,
        })

    def create(self, request):
        data = request.data

        block_id = data.get('block')
        if not block_id:
            return Response(
                {'error': 'block is required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        date_str = data.get('date')
        entry_date = parse_date(date_str) if date_str else timezone.localdate()
        if entry_date is None:
            return Response(
                {'error': 'Invalid date — expected YYYY-MM-DD.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        # Field presence (not value) decides whether each column is written.
        kwargs = {
            'today_plan': data['today_plan'] if 'today_plan' in data else UNSET,
            'yesterday_rest': data['yesterday_rest'] if 'yesterday_rest' in data else UNSET,
            'note': data['note'] if 'note' in data else UNSET,
        }
        if all(v is UNSET for v in kwargs.values()):
            return Response(
                {'error': 'Provide at least one of: today_plan, yesterday_rest, note.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            entry = upsert_daily_board(
                block_id=int(block_id),
                entry_date=entry_date,
                user=request.user,
                **kwargs,
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response(_build_row(entry.block, entry, entry_date))
