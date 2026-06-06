"""Worklog REST endpoints.

Locked decision: visibility is **radical transparency** — every authenticated
user can pull anyone's daily totals. No admin gate. Filter is intentionally
permissive to keep the endpoint cheap to maintain.

GET /api/v1/core/worklog/?user=<id>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
GET /api/v1/core/worklog/me/?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
GET /api/v1/core/worklog/team/?date=<YYYY-MM-DD>
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from django.db.models import F, Sum
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import User, WorkSession, WorkSessionDaily


# ── Serializers ──────────────────────────────────────────────────────────


class WorklogDaySerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    role = serializers.CharField(source='user.role', read_only=True)
    active_seconds = serializers.IntegerField(source='active_seconds_total', read_only=True)

    class Meta:
        model = WorkSessionDaily
        fields = [
            'id',
            'user_id',
            'user_name',
            'role',
            'work_date',
            'active_seconds',
            'first_seen',
            'last_seen',
        ]

    def get_user_name(self, obj: WorkSessionDaily) -> str:
        u = obj.user
        full = ' '.join(p for p in [(u.first_name or '').strip(), (u.last_name or '').strip()] if p)
        return full or u.username


class TeamWorklogRowSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    user_name = serializers.CharField()
    role = serializers.CharField()
    active_seconds = serializers.IntegerField()


# ── Helpers ──────────────────────────────────────────────────────────────


def _parse_date(value: str | None, default: date) -> date:
    if not value:
        return default
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError as exc:
        raise serializers.ValidationError({'date': str(exc)}) from exc


def _today() -> date:
    return datetime.now(timezone.utc).date()


# ── Views ────────────────────────────────────────────────────────────────


class WorklogListView(APIView):
    """Per-day rows for one or every user across a date range."""

    permission_classes = [IsAuthenticated]

    def get(self, request) -> Response:
        date_from = _parse_date(request.query_params.get('from'), _today() - timedelta(days=6))
        date_to = _parse_date(request.query_params.get('to'), _today())
        user_id = request.query_params.get('user')

        qs = (
            WorkSessionDaily.objects
            .select_related('user')
            .filter(work_date__gte=date_from, work_date__lte=date_to)
            .order_by('-work_date', 'user_id')
        )
        if user_id:
            qs = qs.filter(user_id=user_id)
        data = WorklogDaySerializer(qs, many=True).data
        return Response({
            'date_from': date_from.isoformat(),
            'date_to': date_to.isoformat(),
            'results': data,
        })


class WorklogMeView(APIView):
    """Same as the list view, scoped to request.user."""

    permission_classes = [IsAuthenticated]

    def get(self, request) -> Response:
        date_from = _parse_date(request.query_params.get('from'), _today() - timedelta(days=6))
        date_to = _parse_date(request.query_params.get('to'), _today())
        qs = (
            WorkSessionDaily.objects
            .select_related('user')
            .filter(user_id=request.user.id, work_date__gte=date_from, work_date__lte=date_to)
            .order_by('-work_date')
        )
        rows = WorklogDaySerializer(qs, many=True).data
        total = sum(int(r['active_seconds'] or 0) for r in rows)
        today_row = next((r for r in rows if r['work_date'] == _today().isoformat()), None)
        return Response({
            'date_from': date_from.isoformat(),
            'date_to': date_to.isoformat(),
            'results': rows,
            'total_active_seconds': total,
            'today_active_seconds': int(today_row['active_seconds']) if today_row else 0,
        })


class WorklogTeamView(APIView):
    """One row per user for a single date — the worklog page's main table.

    Includes users with zero activity so the page can show the full roster.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request) -> Response:
        day = _parse_date(request.query_params.get('date'), _today())
        rows = (
            WorkSessionDaily.objects
            .filter(work_date=day)
            .values('user_id')
            .annotate(active_seconds=Sum('active_seconds_total'))
        )
        by_user = {r['user_id']: int(r['active_seconds'] or 0) for r in rows}

        users = User.objects.filter(is_active=True).order_by('first_name', 'username').values(
            'id', 'username', 'first_name', 'last_name', 'role',
        )
        payload = []
        for u in users:
            full = ' '.join(p for p in [(u['first_name'] or '').strip(), (u['last_name'] or '').strip()] if p)
            payload.append({
                'user_id': u['id'],
                'user_name': full or u['username'],
                'role': u['role'],
                'active_seconds': by_user.get(u['id'], 0),
            })
        # Sort: most-active first, then alphabetical.
        payload.sort(key=lambda r: (-r['active_seconds'], r['user_name']))
        return Response({'date': day.isoformat(), 'results': payload})
