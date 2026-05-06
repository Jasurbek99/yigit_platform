"""Boss Dashboard analytics endpoints.

All 13 actions are read-only, gated by IsBossOrDirector, and cached for 60s.
No new models are created — all data is aggregated from existing tables.

URL prefix: /api/v1/export/boss/<action>/
"""
import logging
from datetime import date

from django.core.cache import cache
from django.http import HttpResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.core.permissions import IsBossOrDirector
from apps.export.exports import build_excel, build_pdf
from apps.export.services.boss_analytics import (
    period_to_range,
    _aggregate_summary,
    _aggregate_revenue,
    _aggregate_route_pnl,
    _aggregate_quota_grid,
    _aggregate_blocks_heatmap,
    _aggregate_top_customers,
    _aggregate_compliance,
    _aggregate_ops_pulse,
    _aggregate_risk_matrix,
    _aggregate_production,
    _aggregate_export_market,
    _aggregate_alerts,
    _aggregate_task_throughput,
    _placeholder_debt,
)

logger = logging.getLogger(__name__)

_CACHE_TTL = 60  # seconds — matches frontend staleTime of 60_000 ms


def _parse_period_params(request: Request) -> tuple[str, date, date]:
    """Extract and validate period + optional from/to params from query string.

    Returns:
        Tuple (period_slug, from_date, to_date).
    """
    period = request.query_params.get('period', 'month')
    valid_periods = {'today', 'week', 'month', 'season', 'years5'}
    if period not in valid_periods:
        period = 'month'

    try:
        from_date, to_date = period_to_range(period)
    except ValueError:
        from_date, to_date = period_to_range('month')

    # Optional manual overrides
    raw_from = request.query_params.get('from')
    raw_to = request.query_params.get('to')
    if raw_from:
        try:
            from_date = date.fromisoformat(raw_from)
        except ValueError:
            pass
    if raw_to:
        try:
            to_date = date.fromisoformat(raw_to)
        except ValueError:
            pass

    return period, from_date, to_date


def _cache_key(action_name: str, period: str, from_date: date, to_date: date, extra: str = '') -> str:
    return f'boss:{action_name}:{period}:{from_date}:{to_date}:{extra}'


class BossAnalyticsViewSet(viewsets.ViewSet):
    """Read-only analytics viewset for the Boss Dashboard.

    Access: role=boss OR role=director only.
    All endpoints accept ?period=today|week|month|season|years5 (default: month)
    plus optional ?from=YYYY-MM-DD and ?to=YYYY-MM-DD overrides.
    Responses are cached for 60 seconds per (action, period, from, to) key.
    """

    permission_classes = [IsAuthenticated, IsBossOrDirector]

    # ------------------------------------------------------------------
    # summary — 6 hero KPI cards
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request: Request) -> Response:
        """Return 6 hero KPI cards: revenue, margin, debt, today_loaded,
        in_transit, quota_used — each with a 12-week sparkline array.

        GET /api/v1/export/boss/summary/?period=month
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('summary', period, from_date, to_date)

        def _build():
            kpis = _aggregate_summary(from_date, to_date)
            return {
                'period': period,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                'kpis': kpis,
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # revenue — 2-season weekly overlay
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='revenue')
    def revenue(self, request: Request) -> Response:
        """Return two weekly revenue arrays for the overlay chart.

        GET /api/v1/export/boss/revenue/?period=month

        Response shape:
          {current_season: [{week_start, total_usd}, ...],
           previous_season: [{week_start, total_usd}, ...]}
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('revenue', period, from_date, to_date)

        def _build():
            return {
                'period': period,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                **_aggregate_revenue(from_date, to_date),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # debt — placeholder (P4 Contracts not yet built)
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='debt')
    def debt(self, request: Request) -> Response:
        """Return debt aging by firm — placeholder until P4 Contracts ships.

        GET /api/v1/export/boss/debt/

        Response includes is_placeholder: true badge data.
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('debt', period, from_date, to_date)

        def _build():
            placeholder = _placeholder_debt()
            return {
                'period': period,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                'is_placeholder': True,
                'rows': placeholder['rows'],
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # route_pnl — per country+city P&L
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='route_pnl')
    def route_pnl(self, request: Request) -> Response:
        """Return per-route (country + city) revenue, cost, margin.

        GET /api/v1/export/boss/route_pnl/?period=month
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('route_pnl', period, from_date, to_date)

        def _build():
            return {
                'period': period,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                'rows': _aggregate_route_pnl(from_date, to_date),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # compliance — 3 compliance metrics
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='compliance')
    def compliance(self, request: Request) -> Response:
        """Return 3 compliance metrics: reports_overdue, quota_1_to_10, docs_by_13.

        GET /api/v1/export/boss/compliance/?period=month
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('compliance', period, from_date, to_date)

        def _build():
            return {
                'period': period,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                **_aggregate_compliance(from_date, to_date),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # ops_pulse — live operational counts
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='ops_pulse')
    def ops_pulse(self, request: Request) -> Response:
        """Return live shipment counts by operational zone.

        GET /api/v1/export/boss/ops_pulse/

        Counts are live (not period-filtered — always shows current state).
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('ops_pulse', period, from_date, to_date)

        def _build():
            return {
                'period': period,
                **_aggregate_ops_pulse(from_date, to_date),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # quota_grid — all firms quota usage
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='quota_grid')
    def quota_grid(self, request: Request) -> Response:
        """Return quota usage % per active export firm.

        GET /api/v1/export/boss/quota_grid/

        Each row: {firm_id, firm_name, used_pct, level: 'ok'|'warn'|'alert'}
        Thresholds: <=80% ok, 80-95% warn, >=95% alert.
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('quota_grid', period, from_date, to_date)

        def _build():
            return {
                'period': period,
                'rows': _aggregate_quota_grid(),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # blocks_heatmap — plan vs actual per block
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='blocks_heatmap')
    def blocks_heatmap(self, request: Request) -> Response:
        """Return plan vs actual per greenhouse block for the period.

        GET /api/v1/export/boss/blocks_heatmap/?period=week

        Each row: {block_code, plan_kg, actual_kg, pct, color_band}
        color_band: excellent|good|ok|warn|alert based on % of plan.
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('blocks_heatmap', period, from_date, to_date)

        def _build():
            return {
                'period': period,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                'rows': _aggregate_blocks_heatmap(from_date, to_date),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # top_customers — top 5 + rest aggregate
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='top_customers')
    def top_customers(self, request: Request) -> Response:
        """Return top 5 customers by revenue plus a 'rest' aggregate.

        GET /api/v1/export/boss/top_customers/?period=month

        Each top item: {customer_id, customer_name, country_name,
                        trucks, revenue_usd, yoy_pct}
        rest: {trucks, revenue_usd, customer_count}
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('top_customers', period, from_date, to_date)

        def _build():
            result = _aggregate_top_customers(from_date, to_date)
            return {
                'period': period,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                **result,
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # risk_matrix — per-firm risk assessment
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='risk_matrix')
    def risk_matrix(self, request: Request) -> Response:
        """Return per-firm risk assessment.

        GET /api/v1/export/boss/risk_matrix/

        Each row: {firm_id, firm_name, debt_usd (placeholder),
                   bank_credit_usd (placeholder), quota_pct (real),
                   risk_level: 'low'|'med'|'high'}
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('risk_matrix', period, from_date, to_date)

        def _build():
            return {
                'period': period,
                'rows': _aggregate_risk_matrix(),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # alerts — 7 most recent unread notifications
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='alerts')
    def alerts(self, request: Request) -> Response:
        """Return 7 most recent unread notifications for the boss context.

        GET /api/v1/export/boss/alerts/

        Each item: {id, level: 'high'|'med'|'low', icon, title, body,
                    time_ago, link}
        """
        # Alerts are per-user, short cache to stay near-live
        user = request.user
        cache_key = _cache_key('alerts', 'live', date.today(), date.today(), str(user.id))

        def _build():
            return {
                'rows': _aggregate_alerts(user=user),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # production — daily or seasonal plan vs actual per block
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='production')
    def production(self, request: Request) -> Response:
        """Return plan vs actual per block for daily or seasonal scope.

        GET /api/v1/export/boss/production/?scope=daily|seasonal&period=season

        Each row: {block_code, plan_kg, actual_kg, pct,
                   monthly_plan_kg, monthly_actual_kg, monthly_pct}
        """
        scope = request.query_params.get('scope', 'daily')
        if scope not in ('daily', 'seasonal'):
            scope = 'daily'

        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('production', period, from_date, to_date, scope)

        def _build():
            return {
                'period': period,
                'scope': scope,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                'rows': _aggregate_production(scope, from_date, to_date),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # export_market — export kg and % share per block
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='export_market')
    def export_market(self, request: Request) -> Response:
        """Return exported kg and % share per block for the period.

        GET /api/v1/export/boss/export_market/?period=month

        Each row: {block_code, export_kg, export_pct}

        NOTE: Içerki Bazar (domestic) and Sowgatlyk (gift) fields are
        intentionally absent from this endpoint per v1 scope decision.
        They will be added in a later phase.
        """
        period, from_date, to_date = _parse_period_params(request)
        cache_key = _cache_key('export_market', period, from_date, to_date)

        def _build():
            return {
                'period': period,
                'from': from_date.isoformat(),
                'to': to_date.isoformat(),
                'rows': _aggregate_export_market(from_date, to_date),
            }

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    # ------------------------------------------------------------------
    # export_excel — download .xlsx for any of the 6 report sections
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='export_excel')
    def export_excel(self, request: Request) -> HttpResponse:
        """Download an Excel workbook for the requested report section.

        GET /api/v1/export/boss/export_excel/?section=monthly|firms|routes|
                                              blocks|seasons_compare|audit
        """
        section = request.query_params.get('section', 'monthly')
        period, from_date, to_date = _parse_period_params(request)

        try:
            payload = build_excel(section, from_date, to_date)
        except ValueError:
            return Response({'error': f'Unknown section: {section!r}'}, status=400)

        filename = f'boss_{section}_{from_date.isoformat()}_{to_date.isoformat()}.xlsx'
        resp = HttpResponse(
            payload,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        resp['Content-Disposition'] = f'attachment; filename="{filename}"'
        return resp

    # ------------------------------------------------------------------
    # export_pdf — download PDF for any of the 6 report sections
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='task_throughput')
    def task_throughput(self, request: Request) -> Response:
        """Return task-derived throughput KPIs: closed, created, on_time_rate.

        GET /api/v1/export/boss/task_throughput/?window_days=7

        Cached for 60 seconds. Wraps kpi_throughput() + kpi_on_time_rate().
        Optional ?window_days=<N> param (default 7).
        """
        try:
            window_days = int(request.query_params.get('window_days', 7))
        except (TypeError, ValueError):
            window_days = 7

        cache_key = _cache_key('task_throughput', f'w{window_days}', '', '', '')

        def _build():
            return _aggregate_task_throughput(window_days=window_days)

        data = cache.get(cache_key)
        if data is None:
            data = _build()
            cache.set(cache_key, data, _CACHE_TTL)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='export_pdf')
    def export_pdf(self, request: Request) -> HttpResponse:
        """Download a PDF document for the requested report section.

        GET /api/v1/export/boss/export_pdf/?section=...
        """
        section = request.query_params.get('section', 'monthly')
        period, from_date, to_date = _parse_period_params(request)

        try:
            payload = build_pdf(section, from_date, to_date)
        except ValueError:
            return Response({'error': f'Unknown section: {section!r}'}, status=400)

        filename = f'boss_{section}_{from_date.isoformat()}_{to_date.isoformat()}.pdf'
        resp = HttpResponse(payload, content_type='application/pdf')
        resp['Content-Disposition'] = f'attachment; filename="{filename}"'
        return resp
