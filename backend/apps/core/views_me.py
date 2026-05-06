"""Me-scoped endpoints: tasks for the current user and today's KPI snapshot.

These views are intentionally placed in apps.core because they aggregate
data across the export domain without being shipment-specific. The
dependency direction (core ← export) means we import from export lazily
inside the view methods.
"""
import logging
from datetime import datetime, time

from django.core.cache import cache
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

# Cache TTL for /me/kpi-today/ in seconds.
_KPI_CACHE_TTL = 60

# Supervisor roles see all tasks, not just their own role's tasks.
_SUPERVISOR_ROLES = frozenset({'export_manager', 'boss', 'admin', 'director'})


def _today_midnight_utc() -> datetime:
    """Return today midnight in Asia/Ashgabat converted to UTC-aware datetime.

    KPI resets at local midnight so operators in TM see the correct window.
    """
    from zoneinfo import ZoneInfo

    tm_tz = ZoneInfo('Asia/Ashgabat')
    now_local = timezone.now().astimezone(tm_tz)
    midnight_local = datetime.combine(now_local.date(), time.min, tzinfo=tm_tz)
    return midnight_local


class MeTaskListView(APIView):
    """GET /api/v1/me/tasks/

    Returns a paginated list of tasks belonging to the current user's role.
    Supervisors (export_manager, boss, admin, director) see all tasks.

    Supports the same filters as the main TaskViewSet:
        ?state=open
        ?step=yuklenme
        ?overdue=true
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.core.pagination import StandardPagination
        from apps.export.models import Task, TaskState
        from apps.export.serializers import TaskListSerializer

        role = getattr(request.user, 'role', None)
        is_supervisor = getattr(request.user, 'is_superuser', False) or role in _SUPERVISOR_ROLES

        qs = Task.objects.select_related('shipment', 'rule', 'assignee_user').all()

        if not is_supervisor:
            # Regular users: filter to their own role only
            qs = qs.filter(assignee_role=role)

        # Apply optional filters from query params
        state_param = request.query_params.get('state')
        if state_param:
            qs = qs.filter(state=state_param)

        step_param = request.query_params.get('step')
        if step_param:
            qs = qs.filter(step=step_param)

        if request.query_params.get('overdue') == 'true':
            qs = qs.filter(
                deadline__lt=timezone.now(),
            ).exclude(state__in=[TaskState.DONE, TaskState.CANCELLED])

        qs = qs.order_by('deadline', 'created_at')

        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            serializer = TaskListSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)

        serializer = TaskListSerializer(qs, many=True)
        return Response(serializer.data)


class MeKpiTodayView(APIView):
    """GET /api/v1/me/kpi-today/

    Returns the current user's task KPIs for today (since local midnight
    in Asia/Ashgabat timezone). Result is cached for 60 seconds per user.

    Response:
        {
            "done_count": int,
            "avg_duration_seconds": int,
            "on_time_rate": float | null
        }

    `on_time_rate` is null when no tasks with a deadline were completed today.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        cache_key = f'me:kpi-today:{request.user.id}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        result = self._compute_kpi(request.user)
        cache.set(cache_key, result, _KPI_CACHE_TTL)
        return Response(result)

    @staticmethod
    def _compute_kpi(user) -> dict:
        """Compute today's KPI metrics from completed tasks.

        All tasks must have been completed at or after today's local midnight.

        Returns a dict with:
            done_count: number of tasks completed today
            avg_duration_seconds: mean(completed_at - started_at) in seconds;
                0 if no started_at data
            on_time_rate: fraction of tasks with deadline where completed_at
                <= deadline; None if no such tasks
        """
        from apps.export.models import Task, TaskState

        midnight = _today_midnight_utc()
        today_tasks = list(
            Task.objects.filter(
                assignee_role=getattr(user, 'role', None),
                state=TaskState.DONE,
                completed_at__gte=midnight,
            ).only('started_at', 'completed_at', 'deadline')
        )

        done_count = len(today_tasks)

        if done_count == 0:
            return {'done_count': 0, 'avg_duration_seconds': 0, 'on_time_rate': None}

        # Average duration: only include tasks that have started_at set
        durations = [
            (t.completed_at - t.started_at).total_seconds()
            for t in today_tasks
            if t.started_at and t.completed_at
        ]
        avg_duration = int(sum(durations) / len(durations)) if durations else 0

        # On-time rate: tasks with a deadline where completed_at <= deadline
        tasks_with_deadline = [t for t in today_tasks if t.deadline]
        if not tasks_with_deadline:
            on_time_rate = None
        else:
            on_time_count = sum(
                1 for t in tasks_with_deadline
                if t.completed_at and t.completed_at <= t.deadline
            )
            on_time_rate = round(on_time_count / len(tasks_with_deadline), 4)

        return {
            'done_count': done_count,
            'avg_duration_seconds': avg_duration,
            'on_time_rate': on_time_rate,
        }
