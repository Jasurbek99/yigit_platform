"""Views for the harvest-forecast pool endpoints.

GET  /api/v1/export/harvest-forecast/remaining/?date=YYYY-MM-DD
    → pool of remaining kg per block for that date (export_manager, loading_dept_head,
      greenhouse_manager, admin, director may read).

POST /api/v1/export/harvest-forecast/
    → upsert forecast_value on HarvestDayEntry for each (block, date) entry.
      Restricted to roles in HARVEST_DAY_WRITE (admin, greenhouse_manager,
      loading_dept_head). After a successful submit, creates a forecast_handoff
      Notification to all loading_dept_head users.

Dependency note: greenhouse models/services are lazy-imported inside functions
(never at module level) to preserve the export→greenhouse import direction.
"""
import datetime
import logging
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers as drf_serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.roles import HARVEST_DAY_WRITE

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Input serializer for the POST endpoint
# ---------------------------------------------------------------------------

class ForecastEntryInputSerializer(drf_serializers.Serializer):
    """One (block, forecast_kg) row in a bulk-forecast submission."""

    block_id = drf_serializers.IntegerField(min_value=1)
    forecast_kg = drf_serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0')
    )


class ForecastSubmitSerializer(drf_serializers.Serializer):
    """Request body for POST /api/v1/export/harvest-forecast/.

    date: The harvest date this forecast covers (today or tomorrow).
    entries: One or more per-block forecast rows.
    """

    date = drf_serializers.DateField()
    entries = ForecastEntryInputSerializer(many=True, allow_empty=False)

    def validate_entries(self, value: list) -> list:
        """Enforce no duplicate block_ids within a single submission."""
        block_ids = [row['block_id'] for row in value]
        if len(block_ids) != len(set(block_ids)):
            raise drf_serializers.ValidationError(
                'Duplicate block_id entries are not allowed in a single submission.'
            )
        return value


# ---------------------------------------------------------------------------
# APIView
# ---------------------------------------------------------------------------

class HarvestForecastView(APIView):
    """Harvest-forecast pool read + upsert.

    GET  /api/v1/export/harvest-forecast/remaining/?date=YYYY-MM-DD
    POST /api/v1/export/harvest-forecast/
    """

    permission_classes = [IsAuthenticated]

    # ------------------------------------------------------------------ GET --

    def get(self, request: Request) -> Response:
        """Return remaining harvest pool per block for the requested date.

        Query parameter:
            date (required): YYYY-MM-DD

        Response 200:
            [
                {
                    "block_id": 1,
                    "block_code": "A",
                    "forecast_kg": "40000.00",
                    "allocated_kg": "18500.00",
                    "remaining_kg": "21500.00"
                },
                ...
            ]
        Response 400: { "error": "date parameter is required (YYYY-MM-DD)." }
        """
        date_str = request.query_params.get('date')
        if not date_str:
            return Response(
                {'error': 'date parameter is required (YYYY-MM-DD).'},
                status=400,
            )

        try:
            target_date = datetime.date.fromisoformat(date_str)
        except ValueError:
            return Response(
                {'error': f'Invalid date format: {date_str!r}. Use YYYY-MM-DD.'},
                status=400,
            )

        from apps.export.services.harvest_forecast import get_remaining_for_date

        rows = get_remaining_for_date(target_date)

        # Serialise Decimal to str with 2 decimal places for consistent JSON output.
        two = Decimal('0.01')
        result = [
            {
                'block_id':     row['block_id'],
                'block_code':   row['block_code'],
                'forecast_kg':  str(row['forecast_kg'].quantize(two)),
                'allocated_kg': str(row['allocated_kg'].quantize(two)),
                'remaining_kg': str(row['remaining_kg'].quantize(two)),
            }
            for row in rows
        ]
        return Response(result)

    # ----------------------------------------------------------------- POST --

    def post(self, request: Request) -> Response:
        """Upsert forecast_value for each (block, date) entry and notify loading dept.

        Only roles in HARVEST_DAY_WRITE (admin, greenhouse_manager,
        loading_dept_head) may call this endpoint.

        Request body:
            {
                "date": "2026-05-22",
                "entries": [
                    { "block_id": 1, "forecast_kg": "40000.00" },
                    { "block_id": 2, "forecast_kg": "25000.00" }
                ]
            }

        Response 200:
            {
                "saved": 2,
                "date": "2026-05-22",
                "entries": [
                    { "block_id": 1, "block_code": "A", "forecast_kg": "40000.00" },
                    ...
                ]
            }

        Errors:
            400: Validation failure (bad date, duplicate blocks, invalid forecast_kg).
            403: Role not in HARVEST_DAY_WRITE.
            400: PermissionError from set_forecast_value (e.g. window closed, wrong
                 block assignment). Returned as {"error": "...message..."}.
        """
        user_role = getattr(request.user, 'role', None)
        if user_role not in HARVEST_DAY_WRITE:
            return Response(
                {
                    'error': (
                        f"Role '{user_role}' is not allowed to submit forecasts. "
                        f"Allowed: {sorted(HARVEST_DAY_WRITE)}"
                    )
                },
                status=403,
            )

        input_serializer = ForecastSubmitSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        target_date: datetime.date = data['date']
        entries: list[dict] = data['entries']

        # Lazy-import greenhouse models/services.
        from apps.core.models import GreenhouseBlock, Season
        from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan
        from apps.greenhouse.services.harvest_day_service import set_forecast_value

        # Resolve the active season once.
        season = Season.objects.filter(is_active=True).first()
        if season is None:
            return Response(
                {'error': 'No active season found. Cannot upsert forecast.'},
                status=400,
            )

        # Resolve block IDs upfront to detect invalid ones early.
        block_ids = [e['block_id'] for e in entries]
        blocks_qs = GreenhouseBlock.objects.filter(id__in=block_ids).in_bulk()
        missing = [bid for bid in block_ids if bid not in blocks_qs]
        if missing:
            return Response(
                {'error': f'Unknown block_id(s): {missing}'},
                status=400,
            )

        iso_year, iso_week, _ = target_date.isocalendar()
        weekday = target_date.weekday()  # 0=Mon … 6=Sun

        saved_entries: list[dict] = []
        errors: list[str] = []

        for entry in entries:
            block_id = entry['block_id']
            forecast_kg: Decimal = entry['forecast_kg']
            block = blocks_qs[block_id]

            try:
                with transaction.atomic():
                    # Get-or-create the WeeklyHarvestPlan container for this week.
                    plan, _ = WeeklyHarvestPlan.objects.get_or_create(
                        season=season,
                        block=block,
                        week_number=iso_week,
                        year=iso_year,
                        defaults={'entered_by': request.user},
                    )

                    # Get-or-create the daily entry row.
                    day_entry, _ = HarvestDayEntry.objects.get_or_create(
                        weekly_plan=plan,
                        entry_date=target_date,
                        defaults={
                            'season': season,
                            'block': block,
                            'weekday': weekday,
                        },
                    )

                    # Delegate to the canonical service — handles window checks,
                    # revision tracking, and AuditLog.
                    set_forecast_value(day_entry, forecast_kg, request.user)

            except (PermissionError, ValueError) as exc:
                errors.append(f'Block {block.code}: {exc}')
                continue

            saved_entries.append({
                'block_id':    block_id,
                'block_code':  block.code,
                'forecast_kg': str(forecast_kg),
            })

        if errors and not saved_entries:
            # Every entry failed.
            return Response({'error': '; '.join(errors)}, status=400)

        # Notify all loading_dept_head users that the forecast is ready.
        _notify_forecast_handoff(request.user, target_date, len(saved_entries))

        response_data = {
            'saved': len(saved_entries),
            'date': str(target_date),
            'entries': saved_entries,
        }
        if errors:
            response_data['errors'] = errors

        return Response(response_data)


# ---------------------------------------------------------------------------
# Notification helper
# ---------------------------------------------------------------------------

def _notify_forecast_handoff(submitter, target_date: datetime.date, block_count: int) -> None:
    """Create forecast_handoff Notifications for all active loading_dept_head users.

    Mirrors the pattern of _notify_action_required() in services/shipment.py:
    lazy User import, filter by role, bulk_create with batch_size=500.

    Args:
        submitter: User who submitted the forecast.
        target_date: The date the forecast covers.
        block_count: Number of blocks whose forecast was saved.
    """
    from apps.core.models import User
    from apps.export.models import Notification

    submitter_name = (
        f'{submitter.first_name} {submitter.last_name}'.strip() or submitter.username
    )
    message = (
        f'{submitter_name} submitted forecast for {target_date.isoformat()} '
        f'({block_count} block(s)). Build drafts now.'
    )
    link = f'/export/drafts?date={target_date.isoformat()}'

    user_ids = list(
        User.objects.filter(role='loading_dept_head', is_active=True)
        .exclude(id=submitter.id)  # don't notify the submitter about their own action
        .values_list('id', flat=True)
    )
    if not user_ids:
        logger.debug(
            'forecast_handoff notification skipped — no active loading_dept_head users.'
        )
        return

    Notification.objects.bulk_create(
        [
            Notification(
                user_id=uid,
                kind='forecast_handoff',
                message=message,
                link=link,
            )
            for uid in user_ids
        ],
        batch_size=500,
    )
    logger.info(
        'Created %d forecast_handoff notifications for %s submitted by %s',
        len(user_ids),
        target_date.isoformat(),
        submitter.username,
    )
