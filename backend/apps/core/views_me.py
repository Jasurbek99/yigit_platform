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

from apps.core.roles import task_roles_for
from apps.core.seasons import resolve_season, season_scope_q

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
        ?assignee_role=warehouse_chief — supervisors only; silently ignored for
            every other role, which stays locked to its own. Unknown role → 400.
        ?season=<id> — the read scope, same contract as every scoped list.

    Season scoping (spec §4.8) mirrors `TaskViewSet` exactly: the anchor is
    `shipment__season` and `include_null_link` keeps weekly-plan /
    local-sell-plan tasks (which carry no shipment) on the board under an open
    season. This is the endpoint the My Tasks screen actually lists from — the
    viewset was scoped during the original build but is never called by the UI,
    so switching seasons left this screen unchanged until now.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.db.models import Q

        from apps.core.pagination import TaskBoardPagination
        from apps.export.models import Task, TaskState
        from apps.export.serializers import TaskListSerializer
        from apps.export.services import (
            resolve_weekly_plan_tasks_for_user,
            resolve_local_sell_plan_tasks,
        )

        role = getattr(request.user, 'role', None)
        is_supervisor = getattr(request.user, 'is_superuser', False) or role in _SUPERVISOR_ROLES

        # Lazily auto-resolve the caller's weekly_plan tasks before listing — the
        # plan-save path lives in greenhouse and may not call back into export
        # (dependency direction), so resolution happens here on read.
        resolve_weekly_plan_tasks_for_user(request.user)
        # local_sell_plan tasks are role-wide (no assignee_user), so resolution
        # is global rather than per-user — the open set is tiny (one per week).
        resolve_local_sell_plan_tasks()

        qs = Task.objects.select_related(
            'shipment__status', 'rule', 'assignee_user', 'scope_block',
        ).all()

        # Hide tasks whose shipment was soft-deleted — they are not live work.
        # Non-shipment tasks (weekly_plan / local_sell_plan, shipment is null)
        # are kept.
        qs = qs.filter(
            Q(shipment__isnull=True) | Q(shipment__deleted_at__isnull=True)
        )

        # Season read scope (§4.8). Kept as its own .filter() rather than folded
        # into the soft-delete clause above: OR-ing the two would let a
        # soft-deleted row back in through the null-anchor branch.
        # resolve_season() raises NotFound/PermissionDenied for a bad or
        # forbidden ?season=, matching every other scoped list.
        season = resolve_season(request)
        if season is None:
            # D7 fail closed — during the close→open gap show nothing, never
            # every season's tasks at once.
            qs = qs.none()
        else:
            qs = qs.filter(season_scope_q(season, 'shipment__season', include_null_link=True))

        if not is_supervisor:
            # Regular users: their role's shipment tasks (assignee_user null) plus
            # any task personally assigned to them (e.g. their own weekly_plan task).
            # task_roles_for() expands to operationally-equivalent roles (a deputy
            # sees their head's tasks); roles with no equivalent map to themselves.
            # NOTE: ?assignee_role= is deliberately ignored here — a regular user
            # must never be able to widen their view to another role's work.
            qs = qs.filter(assignee_role__in=task_roles_for(role)).filter(
                Q(assignee_user__isnull=True) | Q(assignee_user=request.user)
            )
        else:
            # Supervisors see every role by default; ?assignee_role= narrows to one.
            # Fetching the role as its own query makes the result complete, rather
            # than a slice of the all-roles payload (which exceeds page_size).
            #
            # Deliberately NO assignee_user clause: unlike a regular user of role X
            # — who also filters assignee_user IS NULL OR = self — a supervisor sees
            # role-X tasks another user has personally picked up. That is the
            # oversight semantic ("what is this role sitting on?"), and it makes
            # this view a superset of that role's own screen.
            role_param = request.query_params.get('assignee_role')
            if role_param:
                from apps.core.models.user import ROLE_CHOICES

                if role_param not in {code for code, _ in ROLE_CHOICES}:
                    return Response({'error': f'Unknown role: {role_param}'}, status=400)
                # Equivalence applies here too, so picking either half of the
                # loading department shows that department's work — and the KPI
                # tiles (which use the same helper) always agree with the columns.
                qs = qs.filter(assignee_role__in=task_roles_for(role_param))

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

        paginator = TaskBoardPagination()
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

    Deliberately NOT season-scoped, unlike the task list above (§4.8). This is a
    "what did this role get done today" productivity tile, not a view onto a
    season's archive. A closed season's tasks cannot be completed at all — the
    write freeze (D1) blocks the transition — so every task counted here was
    necessarily completed under the open season, and adding a season filter
    would only blank the tile while a user browses a closed season, hiding work
    they really did do today. The cache key is therefore left season-free too.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        role = self._effective_role(request)
        cache_key = f'me:kpi-today:{request.user.id}:{role}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        result = self._compute_kpi(request.user, role)
        cache.set(cache_key, result, _KPI_CACHE_TTL)
        return Response(result)

    @staticmethod
    def _effective_role(request) -> str | None:
        """Role whose KPI to report.

        Supervisors may pass ?assignee_role= to follow the role they are viewing
        on the My tasks page; everyone else always gets their own. Mirrors the
        gate in MeTaskListView so the tiles and the columns below them always
        describe the same role.
        """
        user_role = getattr(request.user, 'role', None)
        is_supervisor = (
            getattr(request.user, 'is_superuser', False)
            or user_role in _SUPERVISOR_ROLES
        )
        if not is_supervisor:
            return user_role
        return request.query_params.get('assignee_role') or user_role

    @staticmethod
    def _compute_kpi(user, role: str | None = None) -> dict:
        """Compute today's KPI metrics from completed tasks.

        All tasks must have been completed at or after today's local midnight.

        Args:
            user: the requesting user.
            role: role to report on; defaults to the user's own role.

        Returns a dict with:
            done_count: number of tasks completed today
            avg_duration_seconds: mean(completed_at - started_at) in seconds;
                0 if no started_at data
            on_time_rate: fraction of tasks with deadline where completed_at
                <= deadline; None if no such tasks
        """
        from apps.export.models import Task, TaskState

        if role is None:
            role = getattr(user, 'role', None)

        midnight = _today_midnight_utc()
        today_tasks = list(
            Task.objects.filter(
                # Same helper as the task list, so the tiles and the columns
                # below them always count the same set — a deputy's "Done today"
                # must include the head's tasks they actually completed.
                assignee_role__in=task_roles_for(role),
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
