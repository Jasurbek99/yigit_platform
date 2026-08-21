"""Pomidor Dükany — production analysis endpoint.

GET /api/v1/export/production-analysis/?date_from=&date_to=&blocks=

Returns planned-vs-achieved production per greenhouse block for an inclusive
date range, plus kg/m² and the domestic/export split. The caller owns the range:
the page derives it from its weekly / monthly / seasonal / cumulative-to-a-day
mode, so all four modes hit one query shape.

Read-only. Gated to management roles — this exposes every block's performance
against plan across the whole operation, which is a supervisory view, not an
operator one.
"""
import logging
from datetime import date, datetime

from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.roles import PRIVILEGED_ROLES

logger = logging.getLogger(__name__)

# admin / export_manager / director (PRIVILEGED_ROLES) + boss. Widened at the
# call site rather than in the shared constant, matching /assign and /join —
# see docs/obsidian/processes/permissions-system.md.
ANALYSIS_VIEW_ROLES = PRIVILEGED_ROLES | {'boss'}

# A page-size guard on the RANGE, not the row count: rows are bounded by the
# block table (~15), but an unbounded range would scan every HarvestDayEntry
# ever written. Two seasons is more than any screen mode asks for.
MAX_RANGE_DAYS = 800


class ProductionAnalysisView(APIView):
    """Planned vs achieved production per block over a date range."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        """Return the analysis payload.

        Query params:
            date_from (required): ISO date, inclusive range start.
            date_to   (required): ISO date, inclusive range end.
            blocks    (optional): comma-separated top-level block ids.

        Returns:
            200 with {date_from, date_to, rows: [...], totals: {...}}.
            400 on a missing/unparseable date, an inverted range, an
                over-long range, or a non-integer block id.
            403 when the caller's role is not in ANALYSIS_VIEW_ROLES.
        """
        user = request.user
        is_super = getattr(user, 'is_superuser', False)
        role = getattr(user, 'role', None)
        if not is_super and role not in ANALYSIS_VIEW_ROLES:
            return Response(
                {'error': f"Role '{role}' cannot view the production analysis."},
                status=403,
            )

        params = request.query_params
        errors: dict[str, str] = {}

        date_from = self._parse_date(params.get('date_from'), 'date_from', errors)
        date_to = self._parse_date(params.get('date_to'), 'date_to', errors)

        block_ids: list[int] | None = None
        raw_blocks = (params.get('blocks') or '').strip()
        if raw_blocks:
            try:
                block_ids = [int(part) for part in raw_blocks.split(',') if part.strip()]
            except ValueError:
                errors['blocks'] = 'Must be a comma-separated list of integer block ids.'

        if not errors:
            if date_from > date_to:
                errors['date_to'] = 'date_to must not be earlier than date_from.'
            elif (date_to - date_from).days > MAX_RANGE_DAYS:
                errors['date_to'] = f'Range must not exceed {MAX_RANGE_DAYS} days.'

        if errors:
            return Response(errors, status=400)

        from apps.export.services.pomidor_dukany import build_production_analysis

        payload = build_production_analysis(date_from, date_to, block_ids=block_ids)
        return Response(payload)

    @staticmethod
    def _parse_date(raw: str | None, field: str, errors: dict) -> date | None:
        """Parse an ISO date, recording a field error instead of raising."""
        if not raw:
            errors[field] = 'This field is required.'
            return None
        try:
            return datetime.strptime(raw, '%Y-%m-%d').date()
        except ValueError:
            errors[field] = 'Enter a valid ISO date (YYYY-MM-DD).'
            return None
