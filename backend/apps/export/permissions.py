"""Export-app-specific DRF permission classes.

The core permission infrastructure (DynamicResourcePermission, write_permission,
IsBossOrDirector, etc.) lives in apps.core.permissions. This module holds
export-domain permissions that reference export models.
"""
from rest_framework.permissions import BasePermission
from apps.core.roles import EXPORT_MANAGER_LIKE

# Roles that can act on ANY task, regardless of assignee_role.
# Mirrors the "supervisor" concept from the B-api plan.
_SUPERVISOR_ROLES = frozenset({'boss', 'admin', 'director'}) | EXPORT_MANAGER_LIKE

# Only these roles may cancel a task (hard delete of work-in-flight is sensitive).
_CANCEL_ROLES = frozenset({'admin', 'director'})


class IsTaskActor(BasePermission):
    """Allow task state-change actions to the task's assignee role or supervisors.

    Rules:
      - Superusers: always allowed.
      - cancel action: only _CANCEL_ROLES (admin / director).
      - All other actions: user.role == task.assignee_role  OR
        user.role in _SUPERVISOR_ROLES.

    Object-level check (has_object_permission) is used by the TaskViewSet actions
    after retrieving the Task instance. This class does NOT override
    has_permission — the viewset sets IsAuthenticated for the list-level gate.
    """

    def has_permission(self, request, view) -> bool:
        """Allow authenticated users through the list-level gate.

        Object-level checks happen in has_object_permission.
        """
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False

        if getattr(request.user, 'is_superuser', False):
            return True

        role = getattr(request.user, 'role', None)
        action = getattr(view, 'action', None)

        if action == 'cancel':
            return role in _CANCEL_ROLES

        # For all other mutating actions: assignee_role match or supervisor.
        # task_roles_for() expands to operationally-equivalent roles, so a deputy
        # can act on their head's tasks — seeing a card without being able to
        # touch it would be worse than not seeing it. Same helper as the task
        # list and KPI, so visibility and permission cannot drift apart.
        from apps.core.roles import task_roles_for

        return obj.assignee_role in task_roles_for(role) or role in _SUPERVISOR_ROLES


class CanViewTaskRules(BasePermission):
    """Read gate for the Task Rules reference endpoint.

    Gated on the ``export.task_rules`` page row — the same row the nav entry and
    the route guard read, so hiding the page in the admin matrix also closes the
    endpoint behind it. Seeded visible for admin / director / export_manager /
    document_team / boss; every other role gets a hidden row an admin can flip
    without a deploy.
    """

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser:
            return True
        role = getattr(user, 'role', None)
        if not role:
            return False
        from apps.core.permissions import get_page_permissions
        return get_page_permissions(role).get('export.task_rules', False)


class CanViewTirHasabat(BasePermission):
    """Read gate for the Tır Takip Hasabat report.

    Needs BOTH page codes. `tir_takip.hasabat` is the tab itself and is granted
    to every role; `analytics.clients` is the audience of the per-customer /
    per-firm kg this report exposes. The tab body on the frontend checks the
    same pair (`TirTakip.tsx` TAB_BODIES), so revoking either in the matrix
    closes both the tab and this endpoint. Both sides resolve codes the same
    way — role rows via `get_page_permissions`, all-true for superusers — as
    `/auth/me/`'s `page_permissions` does (`views_auth.py`).
    """

    PAGE_CODES = ('tir_takip.hasabat', 'analytics.clients')

    def has_permission(self, request, view) -> bool:
        from apps.core.permissions import get_page_permissions

        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser:
            return True
        role = getattr(user, 'role', None)
        if not role:
            return False
        pages = get_page_permissions(role)
        return all(pages.get(code, False) for code in self.PAGE_CODES)


class CanViewTirGaplama(BasePermission):
    """Read gate for the Gaplama board — tab and standalone page alike.

    Needs BOTH page codes, mirroring CanViewTirHasabat: `tir_takip.gaplama` is the
    entry point's own code (tab + standalone page, per the design's D7/D10 — they
    share one code), `export.plan` is the audience of the Weekly Plan data this
    board is a read of.
    """

    PAGE_CODES = ('tir_takip.gaplama', 'export.plan')

    def has_permission(self, request, view) -> bool:
        from apps.core.permissions import get_page_permissions

        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser:
            return True
        role = getattr(user, 'role', None)
        if not role:
            return False
        pages = get_page_permissions(role)
        return all(pages.get(code, False) for code in self.PAGE_CODES)
